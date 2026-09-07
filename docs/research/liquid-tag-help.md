# Liquid tag help

Agreed behavior, 2026-09-05:

- Hover and autocomplete show each tag's purpose, syntax, one short example,
  and essential restrictions.
- Coverage includes LiquidJS tags, closing and branch tags, ZotLit's `bq`,
  `endbq`, `render_annotation`, and `suffix`, and the Profile boundaries
  `managed` and `endmanaged`.
- Tag names inside multiline `liquid` blocks receive the same help.
  Comment text and raw content stay inactive. Their boundary tags have help.
- Profile boundaries retain their explicit delimiter syntax and are offered
  outside multiline `liquid` blocks.
- The selected autocomplete item shows the full tag help. Other items retain
  compact labels.

The shared resolver owns tag syntax and examples. The host supplies descriptions
from the message catalog through the generated message facade. A host that
supplies no descriptions receives syntax as the fallback. Existing hover timing,
focus, and selection behavior stays the same.

The test boundaries agreed for this change are `suggestions`, `hoverHint`,
`completionEdit`, and the web editor's rendered hover and completion controls.

Behavior sources: [LiquidJS tags](https://liquidjs.com/tags/overview.html), the
installed LiquidJS tokenizer and tags, ZotLit's
[`liquid.ts`](../../packages/templates/src/liquid.ts),
[`blockquote.ts`](../../packages/templates/src/blockquote.ts), and
[`filename-suffix.ts`](../../packages/templates/src/filename-suffix.ts).
`render_annotation` follows [ADR 0035](../adr/0035-profile-annotation-section.md)
for Profile rendering and uses the named partial outside a Profile.
