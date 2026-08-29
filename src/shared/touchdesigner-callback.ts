/**
 * The reference Web Server DAT callback, as a string.
 *
 * A TypeScript constant rather than a file in `docs/` for two reasons. The Settings page
 * shows it with a Copy button — someone wiring this up is alt-tabbing to TouchDesigner
 * with Aperture open in front of them, and sending them to find a markdown file in a repo
 * they may not have cloned is friction for nothing. And `verify:touchdesigner` asserts it
 * still names every command the extension sends, so the protocol and its documentation
 * cannot drift apart silently — which a code fence in a doc absolutely can.
 *
 * **The dispatch table is the authorization surface**, and that is why the reference
 * implementation uses an explicit dict rather than `getattr(op, command)`. `send_command`
 * is a passthrough: anything the project implements is reachable, so what the project
 * chooses to implement is the whole boundary. A `getattr` here would make every operator
 * in the network callable from a sentence.
 *
 * Project-level failures answer **HTTP 200** carrying `{"status": "error"}`. That is
 * deliberate: it lets Aperture tell "the project said no" from "nothing answered" without
 * reading status codes — the same call `bloom/client.ts` makes when it refuses to read a
 * gateway's 502 as the service speaking.
 */
export const WEB_SERVER_DAT_CALLBACK = `# Aperture bridge — paste into the Callbacks DAT of a Web Server DAT.
#
# Aperture speaks exactly one shape:   {"command": "...", "args": {...}}
# and expects exactly one back:        {"status": "ok", "result": {...}}
#                                or:   {"status": "error", "message": "..."}
#
# Everything past that line is yours. Add a function, add it to COMMANDS, and it is
# immediately callable from Amber with no changes on the Aperture side.

import json

# Your rig. The only place scene names exist.
SCENES = {
    'ambient': 'container_ambient',
    'spotify': 'container_spotify',
    'ps5': 'container_ps5',
}

current_scene = None


def _activate(name):
    """However your network actually switches. This is a placeholder."""
    global current_scene
    for scene, container in SCENES.items():
        op(container).par.display = (scene == name)
    current_scene = name


def list_scenes(args):
    return {'scenes': list(SCENES.keys())}


def switch_scene(args):
    name = args.get('scene')
    if name not in SCENES:
        raise ValueError('no scene called %r' % name)
    _activate(name)
    return {'current_scene': name}


def status(args):
    return {'current_scene': current_scene, 'running': True}


# Everything Aperture may ask for. An explicit table, not getattr: this dict is the
# authorization surface, and anything not named here is refused.
COMMANDS = {
    'list_scenes': list_scenes,
    'switch_scene': switch_scene,
    'status': status,
}


def _reply(response, payload):
    response['statusCode'] = 200
    response['statusReason'] = 'OK'
    response['content-type'] = 'application/json'
    response['data'] = json.dumps(payload)
    return response


def onHTTPRequest(webServerDAT, request, response):
    try:
        body = json.loads(request.get('data') or '{}')
    except Exception:
        return _reply(response, {'status': 'error', 'message': 'body was not JSON'})

    command = body.get('command')
    handler = COMMANDS.get(command)
    if handler is None:
        return _reply(response, {'status': 'error', 'message': 'unknown command %r' % command})

    try:
        return _reply(response, {'status': 'ok', 'result': handler(body.get('args') or {})})
    except Exception as exc:
        return _reply(response, {'status': 'error', 'message': str(exc)})
`
