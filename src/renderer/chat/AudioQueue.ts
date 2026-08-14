/**
 * Ordered playback of Amber's synthesized sentences.
 *
 * Ported from the vanilla web dev client, which got this right: one `<audio>`
 * element per sentence played strictly in sequence, with the object URL revoked on
 * both `ended` and `error` so a failed decode can't leak. Plain elements rather
 * than the Web Audio API — there's no mixing or processing to do, and `mp3` decode
 * is the browser's job.
 *
 * `stop()` is the interrupt/barge-in semantic: drop everything queued and silence
 * what's playing right now.
 */
export class AudioQueue {
  private queue: Array<{ blob: Blob }> = []
  private current: HTMLAudioElement | null = null
  private currentUrl: string | null = null
  private playing = false

  constructor(private readonly onStateChange?: (playing: boolean) => void) {}

  get isActive(): boolean {
    return this.playing || this.queue.length > 0
  }

  push(buffer: ArrayBuffer, format = 'mp3'): void {
    this.queue.push({ blob: new Blob([buffer], { type: `audio/${format}` }) })
    if (!this.playing) void this.pump()
  }

  stop(): void {
    this.queue = []
    this.releaseCurrent()
    this.setPlaying(false)
  }

  private pump(): void {
    const next = this.queue.shift()
    if (!next) {
      this.setPlaying(false)
      return
    }

    this.setPlaying(true)
    const url = URL.createObjectURL(next.blob)
    const audio = new Audio(url)
    this.current = audio
    this.currentUrl = url

    const advance = (): void => {
      // Guard against a late event from an element we already tore down in stop().
      if (this.current !== audio) return
      this.releaseCurrent()
      this.pump()
    }

    audio.addEventListener('ended', advance, { once: true })
    audio.addEventListener('error', advance, { once: true })

    void audio.play().catch(() => advance())
  }

  private releaseCurrent(): void {
    if (this.current) {
      this.current.pause()
      this.current.src = ''
      this.current = null
    }
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl)
      this.currentUrl = null
    }
  }

  private setPlaying(playing: boolean): void {
    if (this.playing === playing) return
    this.playing = playing
    this.onStateChange?.(playing)
  }
}
