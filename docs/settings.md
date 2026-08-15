# Settings

Settings is a rail of pages on the left and one page at a time on the right, with a
single draft shared across all of them. It used to be one 900-line scrolling column;
the voice controls alone are four inputs and three explanatory paragraphs, and every
new knob made every old knob harder to find.

## The shape

```
src/renderer/settings/
  tree.ts          the tree's types and every pure function that walks it
  registry.tsx     every page there is — the file you edit to add one
  context.ts       what a page gets: the draft, the saved settings, navigation
  parts.tsx        Field / Toggle / Note / Divider / Subhead / the input class
  SettingsView.tsx the shell — title, blurb, breadcrumb, scroll, save bar
  SettingsNav.tsx  the rail — filter box, section headings, nested rows
  pages/*.tsx      one component per page, controls only
```

`tree.ts` imports no React at runtime, so it bundles for `npm run verify:settings`,
which checks the walking logic against a fixture and the registry against its own
source (unique ids, every `Content` imported, every page carrying a blurb and
keywords).

## Adding a page

Two steps, both small.

**1. Write the component.** It renders controls and nothing else — no heading, no save
button, no scroll container. The shell draws all of that.

```tsx
// pages/Notifications.tsx
import { useSettings } from '../context'
import { Toggle } from '../parts'

export function Notifications(): React.JSX.Element {
  const { draft, set } = useSettings()
  return (
    <Toggle
      label="Notify on completion"
      hint="Raise a desktop notification when a long operation finishes."
      checked={draft.notifyOnDone}
      onChange={(notifyOnDone) => set({ notifyOnDone })}
    />
  )
}
```

**2. Declare it** in `registry.tsx`, in the section it belongs to:

```tsx
{
  id: 'notifications',
  label: 'Notifications',
  blurb: 'When the app is allowed to interrupt you.',
  keywords: ['toast', 'desktop', 'alert', 'sound'],
  Content: Notifications,
}
```

That's it. The rail row, the title, the blurb, the filter entry, the "where you were"
memory and the save bar all follow from the declaration.

A new *setting* also needs a field on `Settings` and a default in `DEFAULT_SETTINGS`
(`src/shared/types.ts`) — that part is unchanged.

## The rules the registry follows

- **Sections group by what you are configuring, not by which module implements it.**
  Amber's voice and Amber's brain belong together even though one is a TTS request and
  the other is a model keyword. The terminal's typing prediction belongs with Servers
  even though the renderer draws it.
- **A page is a page when it has its own explanation.** If a control needs a paragraph
  before you can safely touch it, it is not a row on somebody else's page.
- **A child page is for state with a different commit rule or a different owner.**
  Keywords hangs off Brain because it is shared with the whole ecosystem through the
  sync store and saves itself on blur, which the save bar cannot express — and a block
  that ignores the save bar sitting under blocks that obey it was the most misleading
  thing about the old page.
- **`keywords` carry the words you would actually type when hunting**: the env var, the
  protocol, the unit. `wss`, `bearer`, `openrouter`, `tab`. Labels are for reading;
  keywords are for finding. `verify:settings` fails a page without them.

## One draft, one save bar

`Save` writes the whole `Settings` object in a single IPC call, exactly as the old
single-column page did. Splitting the screen into pages must not split that: change the
voice, wander over to Terminal, change a threshold, save both. The bar appears when
`draft` differs from what is saved and spans the pane rather than sitting at the end of
a page, because the draft spans the pane too.

`Save & reconnect` appears only when the URL or the token moved — those are read when
the socket dials, so they are the only two settings a save alone does not apply.

Two things deliberately escape the draft:

- **Theme** applies on click. It is pure presentation with no side effects, and the
  preview *is* the decision. `commit()` writes through and moves the draft with it, so
  `dirty` stays honest.
- **The keyword map** applies on blur, because it is not this machine's state at all —
  it lives in Amber's database and is pushed to the sync store. There is nothing local
  to stage.

## Visibility

A page can hide itself:

```tsx
{ id: 'bloom', label: 'Bloom', visible: (ctx) => ctx.bloomLinked, ... }
```

The predicate takes a `SettingsCtx` — a plain snapshot the shell builds from the store,
not a hook, because visibility is evaluated while *walking* the tree and a hook per node
would tie hook order to a filtered, collapsed, user-driven traversal. Add a field to
`SettingsCtx` and one selector in `SettingsView` when a new page needs one.

It is answered from the **saved** settings, never the draft, so a page cannot appear and
disappear under the cursor while a toggle is staged. A hidden parent takes its children
with it, and a section left empty disappears rather than showing a heading with nothing
under it.
