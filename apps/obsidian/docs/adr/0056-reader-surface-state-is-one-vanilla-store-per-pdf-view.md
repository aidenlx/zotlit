# Reader Surface State is one vanilla store per PDF view

The surfaces ZotLit puts inside Obsidian's PDF reader draw from one Reader Surface State per bound PDF view: a zustand vanilla store with `subscribeWithSelector`, created by the binding and disposed with it. It holds plain data: the armed tool, mark visibility, every tool's colour, the Editing Capability, and the clock a cooldown is read against. The renderers stay vanilla DOM on Obsidian's primitives, and [ADR 0042](0042-the-surfaces-inside-the-pdf-reader-are-vanilla-dom-on-obsidians-popover.md) stays in force: the store is state, not a rendering framework, and no Preact root enters the reader.

A press on a Creation Toolbar button moved focus into the PDF view, the focus refresh probed Zotero, and the probe announced a capability change. The Creation Toolbar, Mark Creation, Mark Selection, and the binding each heard that announcement on their own subscription, and each redrew in full. The node under the pointer was gone before the pointer came up, so the click never fired.

## Considered Options

- **Guards at each subscriber** (rejected): each of the three modules compares what it heard against what it last drew. The comparison is written three times, and the next signal adds a fourth.
- **A Preact root with signals or a store hook** (rejected): the diff it brings is the fix, but it reverses ADR 0042 for five flat controls and a popup row, and it brings a component tree into Obsidian's toolbar.
- **One vanilla store per view, with selectors and structural equality** (chosen): the annot-view and note-preview stores already use this shape. A selector composes the existing model functions, a structural equality decides whether the model changed, and a renderer draws only on a real change.

## Consequences

- The binding is the one adapter from external signals to state. It hears `capability-changed` once, reads the Attachment's capability, and ingests it with the current instant. A capability with the same meaning — the same `capabilityReason` and, for a cooldown, the same deadline — keeps the held object, so no subscriber fires.
- Reducers are exported free functions that call `setState`: arm a tool, set a tool colour (which also writes the settings-backed tool colour store), toggle marks, ingest a capability, tick the clock. Selectors are exported pure functions over the state.
- The Creation Toolbar subscribes to its selector with a structural equality over its flat control records. Its renderer builds its nodes once and patches icon, tooltip, colour, pressed state, and disabled state in place, so a real change during a press still lands the click. A press reads the disabled gate from the last model drawn.
- The capability affordance subscribes to its own selector. The binding's cooldown interval runs only while the capability is a cooldown, and each tick re-reads the capability, because a cooldown lapses without an announcement. The toolbar reads its copy against the instant the capability was ingested, so the tick moves the affordance alone.
- Mark Creation and Mark Selection subscribe to the capability slice with the capability equality, and refresh their popups on a real change only. A comment being typed survives an announcement that changed nothing.
- The popup inputs keyed to the selected Annotation, the floating-surface union, and the repository's selection-keyed events stay outside the store for now.
