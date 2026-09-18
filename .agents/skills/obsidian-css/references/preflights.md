# Elements fully styled by Obsidian

Obsidian applies comprehensive styles to bare HTML elements via its global stylesheet. A plain `<button>` or `<input type="text">` already looks like an Obsidian control with no extra classes.

- `<button>`: `inline-flex`, themed bg/color/radius/shadow, height `--input-height`, hover/focus/disabled states. Modifier classes: `mod-cta`, `mod-warning`, `mod-destructive`, `mod-loading`.
- `<input type="text/search/email/password/number">`: themed bg/border/padding/radius, focus ring, placeholder color, height `--input-height`.
- `<input type="date/datetime-local">`: same as text inputs.
- `<textarea>`: same as text inputs, plus `--textarea-radius`, `--textarea-padding`.
- `<select>`: themed bg/border/radius, custom dropdown arrow via background-image, hover/focus states. Modifier class: `.dropdown`.
- `<input type="range">`: custom thumb/track via `-webkit-slider-`*, themed colors. Modifier class: `.slider`.
- `<input type="color">`: custom swatch sizing/radius, themed shadow.
- `<input type="checkbox">`: fully custom appearance, SVG checkmark via mask-image, accent-color theming, `:checked`/`:indeterminate` states.
- `<input type="radio">`: same as checkbox but circular, dot indicator on `:checked`.
- `.checkbox-container` (Toggle): CSS-driven slide toggle with thumb animation, `--toggle-*` variables, small/large sizes. Modifier classes: `is-enabled`, `is-disabled`, `mod-small`.

## Obsidian's unlayered bare-element rules

These are what the `.zt-root` scoped preflight leaves standing: unlayered beats `@layer base`, so each rule below survives inside a plugin root. Neutralize the ones you don't want with a utility, an inline style, or a plain `<div>`.

**Structural:** `<hr>` (`border-top: var(--hr-thickness)` + `margin: 2rem 0` — `.markdown-rendered hr` re-declares only the border, so the 2rem survives there too); `<h1>`–`<h6>` (per-level themed size/weight/color/font/line-height + `var(--p-spacing)` margin-block); `<ol>` (`list-style-type: var(--list-numbered-style)` → numbering survives); nested `ul ul, ol ul` (`list-style-type: disc`) — a **top-level** bare `<ul>` has no rule, so preflight strips its markers; `ul > li, ol > li` (`text-align: start`) and their `::marker` color.

**Inline:** `a` / `a:hover` (accent color, underline, link weight/cursor — this beats preflight's `a { color: inherit }`, so links stay Obsidian-styled); `b`/`strong`; `i`/`em`; `kbd` (mono font, background, padding, radius).

**Global:** `button` (the full Obsidian button box), `iframe`, `audio`, `*` (`box-sizing: border-box`), `:focus { outline: none }` — a focus ring reaches a bare element only through a rule that declares one, e.g. `button:focus-visible`.

Everything else (`<p>`, `<blockquote>`, `<code>`, `<pre>`, `<table>`/`<th>`/`<td>`, `<img>`, `<video>`, `<mark>`, `<sub>`/`<sup>`, `<fieldset>`, a top-level `<ul>`, …) has no bare Obsidian rule — pure Chrome UA, so preflight fully governs it.

## Without `.zt-root`

Outside a scoped root there is no preflight: a width utility sets only width, `border-style` stays `none` (so `zt:border` alone is invisible) and unset sides fall back to UA `medium`, making `zt:border-l-2 zt:border-solid` a full box. Add `zt:border-solid`, set the border inline, or render a `<div>` with the matching ARIA role (`role="blockquote"`, `role="paragraph"`, `role="list"` + child `role="listitem"`, `role="heading"` + `aria-level`, `role="separator"`). Adding `zt-root` is simpler and keeps real semantics.
