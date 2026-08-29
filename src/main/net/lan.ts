import { networkInterfaces } from 'node:os'

import type { LanAddress } from '../../shared/types'

/**
 * The addresses a phone could actually reach this machine on.
 *
 * This exists because of one specific, guaranteed failure: Aperture's own default is
 * `ws://localhost:8000/ws` (`shared/types.ts`), and on a phone `localhost` is the
 * phone. Pairing by QR without rewriting that would hand the phone an address that
 * cannot work, and the symptom — "Amber is down" — points nowhere near the cause.
 *
 * Amber must also be listening on `0.0.0.0` for any of these to answer. That is a
 * separate mistake with the same symptom, so the pairing page says so rather than
 * letting a correct address look broken.
 */


/** 10/8, 172.16/12, 192.168/16 — the ranges a router assigns on a home LAN. */
function isPrivate(address: string): boolean {
  const [a, b] = address.split('.').map(Number)
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

/**
 * Interfaces likely to be a real LAN, best first.
 *
 * IPv4 only, deliberately. A link-local IPv6 address needs a zone index (`%en0`) that
 * means something different on each machine, and it will not survive being written
 * into a QR code and read on another device.
 *
 * Loopback is excluded rather than ranked last: offering `127.0.0.1` as a pairing
 * address is offering the one answer that is guaranteed wrong.
 */
export function lanAddresses(): LanAddress[] {
  const found: LanAddress[] = []
  for (const [iface, addrs] of Object.entries(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      // Node <18 reports `family` as a string, newer as a number. Accept both rather
      // than pinning to whichever this Electron happens to bundle.
      const v4 = addr.family === 'IPv4' || (addr.family as unknown as number) === 4
      if (!v4 || addr.internal) continue
      // 169.254/16 is what an adapter self-assigns when DHCP failed — it is a symptom,
      // not an address anything can be reached on.
      if (addr.address.startsWith('169.254.')) continue
      found.push({ address: addr.address, iface, private: isPrivate(addr.address) })
    }
  }
  // Private first: a machine with a VPN or a container bridge will also report public
  // or routed addresses, and the home-network one is nearly always the intended answer.
  return found.sort((a, b) => Number(b.private) - Number(a.private))
}
