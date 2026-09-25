# Shared UI parts are unstyled compositions in `@zotlit/ui`

A tag chip input is needed in three places: the Annotation Card, the Mark Popup, and the Workbench's Match conditions, which the web host and Obsidian both mount. Decided in the Annotation Tags grilling (2026-09-25): `packages/ui`, published in the workspace as `@zotlit/ui`, holds unstyled compositions in the shadcn style. Each part is a component that renders one element, marks it with `data-slot`, and takes `className` and the element's native props. A Root holds the shared state in context. The consumer chooses which parts appear, in what order, and how they look. The package has React as a peer dependency and stays inside the `preact/compat` surface, because Obsidian's runtime is Preact.

The first composition is `TagsInput`: `Root`, `Item`, `ItemText`, `ItemRemove`, and `Input`. Its value is a list of tag names, and its Root takes `value`, `onValueChange`, and `commitKeys`, which defaults to Enter. An exact, case-sensitive duplicate is ignored. Backspace in an empty input removes the last item. `ItemRemove` keeps focus on the input. `Input` takes an `inputRef` prop, because Preact does not forward a `ref` prop through a function component.

Suggestions are not a part. The consumer attaches its own suggester to the input through `inputRef`: Obsidian attaches `AbstractInputSuggest`, and the web host attaches what it already uses. This keeps every popup the host's, as [ADR 0044](0044-workbench-ui-is-headless-and-hosts-own-the-look.md) and the plugin's [ADR 0044](../../apps/obsidian/docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md) require.

## Considered options

- **A subpath of `@zotlit/workbench`** (rejected): the annotation surfaces would import the Workbench, and the Workbench's theme contract is a `data-part` class map supplied through context, not `className` on each part.
- **A subpath of `@zotlit/shared`** (rejected): that package holds app-agnostic utilities with no UI and no React peer.
- **A copy in `apps/obsidian`, with the Workbench keeping `ChipInput`** (rejected): two copies of the key, focus, and duplicate rules drift apart.
- **One monolithic component with props for every variation** (rejected): the Annotation surfaces mark automatic tags and reuse `tagChipVariants`, and the Workbench adds a hint line under each chip. Composition lets each consumer draw its own item without a prop for each case.

## Consequences

- The Workbench's `ChipInput` is rebuilt on `TagsInput`. It passes its `useParts("match")` classes to each part and `commitKeys: ["Enter", ","]`, so its behaviour stays the same. Its `data-part` theme stays the Workbench's contract, placed on top of the parts.
- A later shared part joins `@zotlit/ui` only when two consumers need it.
