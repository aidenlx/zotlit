# Obsidian editor hover behavior

Research for Template field hover, 2026-09-05. The requested web behavior uses
shadcn with Base UI, a 500 ms opening delay, and a portable semantic resolver.
This report records source observations; it does not claim a runtime test.

## Sources and version

The `obsidian` package resolved from `apps/obsidian` reports **1.13.1**. The
existing formatted **1.13.7** runtime was reused, a patch substitution within
the same minor version. No archive was extracted. Runtime source is
`node_modules/.ob-rev-1.13.7/app.js`; public signatures come from
`packages/obsidian-api/obsidian.d.ts`.

| Symbol | Verified meaning | Source |
| --- | --- | --- |
| `U$` | Public `HoverPopover` | [export table](../../node_modules/.ob-rev-1.13.7/app.js#L14996) |
| `Zg` | Public `setTooltip` | [export table](../../node_modules/.ob-rev-1.13.7/app.js#L15119) |
| `oJ` | Internal file-preview subclass of `HoverPopover` | [factory](../../node_modules/.ob-rev-1.13.7/app.js#L130685) |
| `yee` | Page Preview core plugin | [plugin](../../node_modules/.ob-rev-1.13.7/app.js#L179174) |

## Native editor detection

The editor delegates `mouseover` for `.cm-link`, `.cm-hmd-internal-link`, and
`.cm-footref`. It checks whether the pointer entered from outside the target,
then resolves the clickable token at the mouse position. Internal links and
footnote references emit `hover-link` with the event, source `editor`, owner,
target element, link text, and source path. Detection does not use the caret.
See [registration](../../node_modules/.ob-rev-1.13.7/app.js#L132186),
[handler](../../node_modules/.ob-rev-1.13.7/app.js#L132814), and
[boundary check](../../node_modules/.ob-rev-1.13.7/app.js#L38818).

This is link-preview detection, not a public generic field-hover provider.
Template field detection must resolve its own source range under the pointer.

## HoverPopover lifecycle

The public constructor accepts `(parent, targetEl, waitTime?, staticPos?)`.
`HoverParent` owns one nullable `hoverPopover`; `HoverPopover` exposes its
`hoverEl` and state and extends `Component`. See
[public declarations](../../packages/obsidian-api/obsidian.d.ts#L3464).

The runtime defaults `waitTime` to **300 ms** and starts the show timer in the
constructor. Entering the popup updates its own hover state. It stays open
while the pointer is over the target or popup, while it has explicit focus or
contains the focused element, or while a nested popup must stay open. Leaving
before opening cancels it. Leaving after opening starts a hide timer with the
same `waitTime`; returning cancels that timer. See
[constructor and transition](../../node_modules/.ob-rev-1.13.7/app.js#L124155).

`show()` rejects a detached target, positions the popup, loads the component,
and records it as the parent's current popup. `onShow()` closes the previous
popup for that parent and dismisses the ordinary tooltip. `hide()` clears the
timer, detaches the element, removes target listeners, handles child popups,
clears the parent's reference, and unloads the component. See
[show/hide](../../node_modules/.ob-rev-1.13.7/app.js#L124247).

Outside click and context menu cancel pending popups and close shown popups
unless the click is in the popup or a child popup, or the popup has explicit
focus. A shared 500 ms position-detection interval also checks target/popup
membership. That interval is separate from the opening delay. The generic
class has no Escape binding in the inspected implementation. See
[global handlers](../../node_modules/.ob-rev-1.13.7/app.js#L124102).

Positioning uses the target rectangle or an explicit point, appends to the
appropriate document body, and uses a 10 px gap with overlap prevention.
The class supports resize observation. See
[positioning](../../node_modules/.ob-rev-1.13.7/app.js#L124289).

**API limit:** `hide()`, `position()`, and the hover-transition methods exist
in this runtime but are absent from the public `HoverPopover` declaration.
Inherited `Component.unload()` is public, but its runtime hover override only
disconnects the resize observer; it does not replace `hide()` cleanup. A
native adapter that forces dismissal on editor changes needs one isolated,
version-checked internal `hide()` call. See
[public Component](../../packages/obsidian-api/obsidian.d.ts#L1835) and
[hover unload override](../../node_modules/.ob-rev-1.13.7/app.js#L124350).

## Page Preview and ordinary tooltips

Page Preview listens for `hover-link`. Its per-source settings can require
the Mod key; it can wait for that key while the pointer remains on the target.
It avoids duplicating an already open preview on that target. Its factory
creates a `HoverPopover` subclass and loads a file embed shortly before the
show deadline. Editable preview behavior adds further focus and click rules.
See [event policy](../../node_modules/.ob-rev-1.13.7/app.js#L179211),
[preview creation](../../node_modules/.ob-rev-1.13.7/app.js#L179277), and
[embed lifecycle](../../node_modules/.ob-rev-1.13.7/app.js#L130685).

Ordinary label tooltips use a different system: `setTooltip` sets `aria-label`
and data attributes. Delegated pointer events show a text-only `.tooltip`.
The normal delay is 1000 ms with a recently-closed shortcut; pointer exit and
pointer-up dismiss it. Its API accepts a text string, not structured field
content. See [tooltip events and delay](../../node_modules/.ob-rev-1.13.7/app.js#L54622),
[setter](../../node_modules/.ob-rev-1.13.7/app.js#L54767), and
[public signature](../../packages/obsidian-api/obsidian.d.ts#L6711).

## Portable adapter recommendation

Keep semantic resolution independent of editor views and popup libraries:
source text, pointer offset, root/scope, contract, and sample data produce a
field range plus its path, type, description, and value. Reuse the completion
contract traversal. Hover resolution should identify the actual field under
the pointer directly, with no dependency on completion ranking or insertion.

The web adapter should map pointer coordinates to a source offset, anchor a
shadcn/Base UI hover surface to that field, and open after **500 ms**. Preserve
editor selection and allow movement into the popup. Cancel pending work and
close stale content on source changes, editor teardown, Escape, and outside
interaction. The popup library owns positioning and pointer transitions;
CodeMirror supplies editor events and coordinates. The requested web path
uses no CodeMirror `hoverTooltip`.

The later native adapter can use `new HoverPopover(parent, targetEl, 500)`
and render the same field facts into `hoverEl`. A precise field target is
preferable to the whole editor: the native lifecycle treats the full target
as hover-active. A virtual source range therefore needs a narrow native DOM
anchor or adapter-owned range tracking. Passing 500 also sets native hide
delay to 500; that is observed behavior, not an independent API setting.
Keep the internal dismissal call inside this adapter. Use direct generic
hover presentation for field facts; `hover-link` is reserved for file previews.

## Web implementation

The [web adapter](../../apps/docs/src/lib/workbench/hover.tsx) calls the shared
`hoverHint(source, position, config)` resolver and renders its result with
shadcn's [Base UI Hover Card](https://ui.shadcn.com/docs/components/base/hover-card)
primitive, `PreviewCard`. CodeMirror supplies pointer offsets and field
rectangles. The adapter opens after 500 ms on the same field, and allows
300 ms to cross into the card before closing. Base UI positions the card.
Editor changes, scrolling, keys, and teardown cancel pending or visible
previews. Event observers run even when completion consumes the key.

The native adapter remains future work. It can reuse the same resolver and
scope configuration while supplying Obsidian's popup lifecycle and content
renderer. The shared core imports neither React nor Obsidian for hover facts.
