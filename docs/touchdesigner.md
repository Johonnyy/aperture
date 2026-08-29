# TouchDesigner

Aperture opens TouchDesigner projects and forwards commands to a **Web Server DAT**
running inside one. That is all it does.

It does not know what a scene is, what `ps5` means, or what switching one does. Those
live in a Python callback inside your `.toe`, which you write once and can change any
time without touching this repo. Adding a capability is a few lines in TouchDesigner, not
a pull request and a release — that is the whole point of the design, and it is why the
protocol below is deliberately tiny.

## The protocol

One request shape, two response shapes. `POST http://127.0.0.1:<port>/`:

```json
{ "command": "switch_scene", "args": { "scene": "ps5" } }
```

```json
{ "status": "ok", "result": {} }
```

```json
{ "status": "error", "message": "no scene called drop" }
```

**Answer a project-level failure with HTTP 200 and an error envelope**, as the reference
callback does. That is what lets Aperture tell *"the project said no"* from *"nothing
answered"* without reading status codes — the two need completely different responses
from whoever is listening, and a body that is not this envelope is treated as transport
failure whatever the status says. A 502 from something else on that port is not
TouchDesigner speaking.

### Reserved commands

None are required. Implementing them buys you things:

| Command | Result | What it unlocks |
|---|---|---|
| `list_scenes` | `{ "scenes": ["ambient", "ps5"] }` | Amber knows your scene names, and the Devices panel draws a button per scene |
| `switch_scene` | anything | `switch_scene` works |
| `status` | `{ "current_scene": "ps5", "running": true }` | **Test connection** in Settings reports what is showing |

Everything else is free-form. A command called `set_crop_region` or `pulse_to_beat` is
forwarded exactly as given through `send_command`, and whatever it returns comes back
untouched — Aperture never validates or knows the shape.

## Setting it up

1. **Settings → This device → Extensions**: grant TouchDesigner both permissions. They
   are separate on purpose — *process* covers opening and closing the application,
   *network* covers talking to the project. Neither is on by default.
2. **Settings → This device → TouchDesigner**: set the bridge port, add a project, and
   press **Copy the callback**.
3. In your project: add a Web Server DAT, set its port to match, and point its Callbacks
   DAT at a Text DAT holding what you copied.
4. Edit `SCENES` and `_activate` to match your own network.
5. Back in Settings, press **Test connection**.

The exact snippet Aperture hands you lives in
[`src/shared/touchdesigner-callback.ts`](../src/shared/touchdesigner-callback.ts) — it is
a constant rather than a code fence here so `verify:touchdesigner` can assert it still
matches the protocol. It is not duplicated in this file for the same reason.

## How Amber learns your scene names

Nothing about your rig lives in Amber's source or Aperture's. The chain is:

1. `list_scenes` runs — after a project opens, when Amber asks, or when you press Test
   connection — and the result is cached in `touchdesigner.json`.
2. That cached list is spliced into the announced `switch_scene` schema as an `enum`
   (`withChoices` in `src/shared/extensions.ts`), and the machine re-announces.
3. Amber renders the enum into her system prompt, so *"what scenes can the rig do?"* is
   answered without a tool call.
4. The same `input_schema` rides back out to every other client on `device_list`, which
   is why your phone can draw the desktop's scene buttons without knowing what a scene is.

Scenes are read on an occasion, never polled, so the list can be one action out of date.
That is the deliberate trade: querying the project while composing a prompt would put an
HTTP round trip in front of every first spoken word. `list_scenes` stays callable so Amber
can refresh when a name is rejected.

## The security boundary, stated plainly

`send_command` is an arbitrary-command passthrough, gated only by the `network` grant. A
prompt-injected model can call anything your project implements.

**So the `.toe`'s command table is the authorization surface.** The reference callback
dispatches through an explicit `COMMANDS` dict and refuses anything not in it, rather than
`getattr`-ing into the network — which would make every operator in your project reachable
from a sentence. Keep it that way, and only put things in that dict you would be content
to have run by asking.

The extension permission model is honest about its own limits: it is a declared and
displayed scope, not a sandbox. See `src/shared/extensions.ts`.

## Launching

`process.launch` takes a **project configured in Settings**, not a path — so Amber cannot
invent one.

If an executable path is set, the project opens with `spawn(exe, [path])`, detached. If it
is not, the `.toe` opens through its OS file association. The second is simpler and works,
but cannot choose *which* TouchDesigner build opens it, because `shell.openPath` accepts no
arguments. That is the only reason the executable field exists.

## Testing without a rig

`scripts/td-stub.mjs` answers the protocol so the whole path is exercisable before any
`.toe` work:

```
node scripts/td-stub.mjs 9980 ambient spotify ps5
```

It is not part of `npm run verify` on purpose — the envelope handling is covered there
without a socket, and a stub written from the same understanding as the client would only
confirm that understanding back to itself.
