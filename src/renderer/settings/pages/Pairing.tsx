import { useEffect, useMemo, useState } from 'react'
import QRCode from 'react-qr-code'

import { isLoopback, pairingPayload, withHost } from '../../../shared/pairing'
import type { LanAddress } from '../../../shared/types'
import { useStore } from '../../store'
import { useSettings } from '../context'
import { Divider, Field, Note, Subhead, field } from '../parts'

/**
 * Pair a phone by pointing it at a square.
 *
 * Aperture mobile needs two things this machine already has: Amber's address and the
 * token. Both are miserable to type on a phone — a LAN address and a shared secret,
 * with no room for a typo — so this hands them over in one scan.
 *
 * ## The address is rewritten, and that is the whole reason this page exists
 *
 * The default here is `ws://localhost:8000/ws`, and on a phone `localhost` *is* the
 * phone. A QR code carrying it would be a pairing that cannot possibly work, failing
 * as "Amber is down" — a symptom pointing nowhere near the cause. So the host is
 * replaced with a real interface address, picked from what this machine actually has.
 *
 * The mobile client refuses a loopback pairing with an explanation rather than storing
 * it, so the two halves agree; this page is what stops it ever coming up.
 *
 * ## The token is hidden until asked for
 *
 * The QR *is* the secret in visual form, and settings screens get shown to people and
 * screen-shared. Hiding it behind a click costs nothing and means the credential is
 * never sitting on screen next to a URL by default.
 */
export function Pairing(): React.JSX.Element {
  const { saved } = useSettings()
  const connState = useStore((s) => s.connection.state)

  const [addresses, setAddresses] = useState<LanAddress[] | null>(null)
  const [host, setHost] = useState<string>('')
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    void window.aperture.devices.lanAddresses().then((found) => {
      setAddresses(found)
      // Best first — `lanAddresses` already sorts private ranges ahead of the rest.
      setHost((current) => current || (found[0]?.address ?? ''))
    })
  }, [])

  const loopback = isLoopback(saved.amberUrl)
  const url = useMemo(
    // Only rewrite what needs it. An address already pointing at a real host is what
    // this machine is genuinely using, and second-guessing it would be worse.
    () => (loopback && host ? withHost(saved.amberUrl, host) : saved.amberUrl),
    [saved.amberUrl, host, loopback],
  )

  const payload = useMemo(() => pairingPayload(url, saved.authToken), [url, saved.authToken])

  const noAddresses = addresses !== null && addresses.length === 0

  return (
    <>
      <Subhead
        title="Pair a phone"
        blurb="Open Aperture on your phone, go to Settings, and scan this."
      />

      {loopback && (
        <Field
          label="Address to hand over"
          hint={
            <>
              This app connects to <code>{saved.amberUrl}</code>, which on a phone means the
              phone. Pick the network address this machine answers on instead.
            </>
          }
        >
          <select
            className={field}
            value={host}
            onChange={(e) => setHost(e.target.value)}
            disabled={noAddresses}
          >
            {addresses?.map((a) => (
              <option key={`${a.iface}-${a.address}`} value={a.address}>
                {a.address} — {a.iface}
                {a.private ? '' : ' (not a home network address)'}
              </option>
            ))}
            {noAddresses && <option value="">No network address found</option>}
          </select>
        </Field>
      )}

      {noAddresses ? (
        <Note>
          This machine has no non-loopback IPv4 address, so nothing can reach it. Connect to a
          network and reopen this page.
        </Note>
      ) : !url ? (
        <Note>Set Amber&rsquo;s URL on the Connection page first — there is nothing to pair with yet.</Note>
      ) : revealed ? (
        <>
          {/* White quiet zone regardless of theme: a scanner reads dark-on-light, and a
              QR rendered in theme colours on a dark ground fails on some cameras. */}
          <div className="w-fit rounded-panel bg-white p-4">
            <QRCode value={payload} size={196} level="M" />
          </div>
          <Note>
            Hands over <code>{url}</code>
            {saved.authToken ? ' and the auth token' : ' (no token — Amber is running open)'}.
          </Note>
          <button
            type="button"
            className="w-fit text-xs text-muted underline underline-offset-2 hover:text-ink"
            onClick={() => setRevealed(false)}
          >
            Hide
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="w-fit rounded-control border border-accent-deep bg-accent px-3 py-2 text-sm font-medium text-ground"
            onClick={() => setRevealed(true)}
          >
            Show pairing code
          </button>
          <Note>
            The code carries the auth token, so it is the credential in visual form — worth not
            leaving on screen while someone is looking.
          </Note>
        </>
      )}

      <Divider />

      <Note>
        Amber must be listening on <code>0.0.0.0</code> rather than <code>127.0.0.1</code> for a
        phone to reach her at all. That is a separate mistake with the same symptom as a wrong
        address, so check it first if a scanned pairing will not connect.
        {connState !== 'open' && ' This app is not connected right now either.'}
      </Note>
    </>
  )
}
