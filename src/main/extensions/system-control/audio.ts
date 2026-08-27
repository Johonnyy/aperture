/**
 * Reading and changing this machine's volume, per platform.
 *
 * Pure, like `commands.ts`, so `verify:devices` can check all three platforms from one.
 *
 * ## Windows has no built-in volume CLI, and that is the whole difficulty
 *
 * There is no `volume.exe`. Every approach is a workaround, and the two common ones are
 * both bad: `SendKeys` of the media keys moves in coarse steps and cannot read the
 * current value, and shipping `nircmd.exe` means vendoring an unsigned third-party binary
 * into a signed app. So this uses PowerShell to `Add-Type` a small C# interop against
 * `IAudioEndpointVolume`, which is the actual OS API and returns a real number.
 *
 * The script is a **module constant**. Nothing is ever interpolated into it — the level
 * travels in an environment variable the script reads, which keeps the "no built command
 * strings" rule intact even though this is the one action that has to carry a value. A
 * quoting mistake here would be a quoting mistake in something running with the user's
 * full privileges.
 *
 * macOS and Linux both have first-class commands, so they are one line each. The macOS
 * one does interpolate a number — but a number *we* produced by clamping to an integer in
 * `0..100`, never a value passed through from the model. That distinction is the rule:
 * no shell, and nothing interpolated that we did not construct ourselves.
 */

import type { TargetPlatform } from '../../../shared/extensions'
import { UnsupportedPlatformError, type Command } from './commands'

/** The env var the Windows script reads its target level out of. */
export const VOLUME_ENV = 'APERTURE_VOLUME'
/** The env var the Windows script reads its mute state out of (`1` / `0`). */
export const MUTE_ENV = 'APERTURE_MUTE'

/**
 * One C# interop, three entry points, selected by which env vars are set.
 *
 * Kept as a single constant rather than three near-identical ones: the `Add-Type` block
 * is the bulk of it and duplicating it three times is how two of the copies eventually
 * drift.
 */
const WINDOWS_AUDIO_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, System.Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref System.Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
public class Audio {
  static IAudioEndpointVolume Vol() {
    IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
    IMMDevice dev = null;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out dev));
    IAudioEndpointVolume epv = null;
    var guid = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(dev.Activate(ref guid, 23, 0, out epv));
    return epv;
  }
  public static float Get() { float v; Marshal.ThrowExceptionForHR(Vol().GetMasterVolumeLevelScalar(out v)); return v; }
  public static void Set(float v) { Marshal.ThrowExceptionForHR(Vol().SetMasterVolumeLevelScalar(v, System.Guid.Empty)); }
  public static bool GetMute() { bool m; Marshal.ThrowExceptionForHR(Vol().GetMute(out m)); return m; }
  public static void SetMute(bool m) { Marshal.ThrowExceptionForHR(Vol().SetMute(m, System.Guid.Empty)); }
}
'@
if ($env:${MUTE_ENV}) { [Audio]::SetMute($env:${MUTE_ENV} -eq '1') }
if ($env:${VOLUME_ENV}) { [Audio]::Set([int]$env:${VOLUME_ENV} / 100.0) }
[int][math]::Round([Audio]::Get() * 100)
`.trim()

const POWERSHELL_ARGS = ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_AUDIO_SCRIPT]

/** Clamp to an integer percentage. The only value we ever put into a command. */
export function clampVolume(value: unknown): number {
  const asNumber = Math.round(Number(value))
  if (!Number.isFinite(asNumber)) return 0
  return Math.min(100, Math.max(0, asNumber))
}

/**
 * Read the current volume. `env` carries nothing, so the Windows script only reports.
 */
export function getVolumeCommand(platform: TargetPlatform): Command & { env?: Record<string, string> } {
  switch (platform) {
    case 'win32':
      return { file: 'powershell.exe', args: POWERSHELL_ARGS }
    case 'darwin':
      return { file: 'osascript', args: ['-e', 'output volume of (get volume settings)'] }
    case 'linux':
      return { file: 'pactl', args: ['get-sink-volume', '@DEFAULT_SINK@'] }
    default:
      throw new UnsupportedPlatformError('get volume', platform)
  }
}

export function setVolumeCommand(
  platform: TargetPlatform,
  level: number,
): Command & { env?: Record<string, string> } {
  const clamped = clampVolume(level)
  switch (platform) {
    case 'win32':
      // The level rides in the environment rather than in the script, so the script
      // stays a constant and there is nothing to quote.
      return {
        file: 'powershell.exe',
        args: POWERSHELL_ARGS,
        env: { [VOLUME_ENV]: String(clamped) },
      }
    case 'darwin':
      return { file: 'osascript', args: ['-e', `set volume output volume ${clamped}`] }
    case 'linux':
      return { file: 'pactl', args: ['set-sink-volume', '@DEFAULT_SINK@', `${clamped}%`] }
    default:
      throw new UnsupportedPlatformError('set volume', platform)
  }
}

export function muteCommand(
  platform: TargetPlatform,
  muted: boolean,
): Command & { env?: Record<string, string> } {
  switch (platform) {
    case 'win32':
      return {
        file: 'powershell.exe',
        args: POWERSHELL_ARGS,
        env: { [MUTE_ENV]: muted ? '1' : '0' },
      }
    case 'darwin':
      return {
        file: 'osascript',
        args: ['-e', `set volume ${muted ? 'with' : 'without'} output muted`],
      }
    case 'linux':
      return { file: 'pactl', args: ['set-sink-mute', '@DEFAULT_SINK@', muted ? '1' : '0'] }
    default:
      throw new UnsupportedPlatformError('mute', platform)
  }
}

/**
 * Pull a percentage out of whatever the platform printed.
 *
 * Windows and macOS print a bare number; `pactl` prints a whole line with the level
 * appearing twice (left and right channel). Taking the **first** percentage is right for
 * all three, and returning `null` rather than a guess matters — a wrong number reported
 * confidently is worse than "couldn't read it".
 */
export function parseVolume(output: string): number | null {
  const match = output.match(/(\d{1,3})\s*%/) ?? output.match(/^\s*(\d{1,3})\s*$/m)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null
}
