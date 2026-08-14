# Aperture

Amber's desktop client. Chat with her, watch a turn unfold frame by frame, and let
her run commands on your servers over SSH.

Aperture is a **client**, not a service. All the intelligence lives in
[Amber](../amber_v2); this app records, plays, renders, and — because it runs on your
machine and holds your SSH keys — executes.

## Why it exists

Amber has no UI of its own. Before this, every interaction went through a smoke-test
script or a stale browser page, and a turn was a black box: you got a final answer and
guessed at what happened in between. Aperture makes the whole turn visible, and gives
Amber a pair of hands on your own machine.

## Running it

```bash
npm install
npm run dev          # electron-vite dev, hot-reloads the renderer
```

Point it at Amber in **Settings** — `ws://localhost:8000/ws` for a local backend
(`uvicorn app.main:app --reload` from the Amber repo), or your deployed instance over
`wss://`. The auth token is Amber's `AMBER_AUTH_SECRET`; leave it empty if Amber runs
without one.

```bash
npm run typecheck    # tsc over main + renderer, no emit
npm run build        # production bundles into out/
```

## How it's put together

The WebSocket client lives in the **main** process, not the renderer. Three reasons:
only Node can set an `Authorization` header on the handshake, only Node can run `ssh2`
(and the tool bridge sits between the socket and SSH), and keeping it in main means
reloading the UI during development doesn't drop the session.

The cost is that audio crosses IPC in both directions — mic bytes out, synthesized
sentences back. Both are `ArrayBuffer`s of a few tens of KB, so it's a non-issue.

```
┌─ MAIN ─────────────────────────────────┐      ┌─ RENDERER ──────────────┐
│ AmberConnection (ws)  ←→ Amber backend │      │ Zustand store           │
│   ↓ frames                             │ IPC  │   ↓                     │
│ ToolBridge ──→ SshClient (ssh2)        │ ←──→ │ ChatView / StatusPanel  │
│ KeyStore (safeStorage)                 │      │ Terminal (xterm.js)     │
│ JsonStore (settings/servers/audit)     │      │ MicRecorder / AudioQueue│
└────────────────────────────────────────┘      └─────────────────────────┘
```

`src/shared/protocol.ts` mirrors Amber's `app/protocol.py` and is the contract both
sides speak. Amber evolves it additively — new optional fields, new frame types — so
unknown frames are logged and ignored rather than treated as errors.

## The SSH bridge

Amber's side of this was already built (`register_tools` / `tool_call` / `tool_result`
in her protocol), so Aperture needed no backend changes for it. Aperture declares a
`run_command` tool on connect; when Amber calls it, the tool bridge runs the command
over `ssh2` and returns the output.

Private keys live only in an Electron `safeStorage`-encrypted vault, referenced by id
from the plaintext server list. Host keys are pinned on first connect and mismatches
are refused.

**Amber can only run commands while Aperture is open and connected.** That's inherent
— this device holds the keys. If you later want her to run commands with your laptop
closed, that's Amber holding her own keys server-side: a different feature, not an
extension of this one.

By default every Amber-initiated command waits for your approval in the Status Panel.
Approved or not, all of them are logged with timestamp, server, command, and outcome.

## Known limits

- **Amber's own tool calls are invisible.** Her brain streams text deltas; server-side
  tool round-trips happen inside the agent runtime and never reach the wire. The live
  trace shows Aperture's tool calls in full and Amber's not at all. Surfacing them
  needs a new additive frame on her side.
- **Keys are machine-bound.** `safeStorage` uses DPAPI on Windows, tied to your
  Windows account — the vault won't survive a profile migration.
- **No acknowledgment for `interrupt`.** Amber cancels the turn silently, and a
  cancelled turn never sends `turn_complete` — only `thinking: false`. Aperture treats
  that as the reliable end-of-turn signal.
