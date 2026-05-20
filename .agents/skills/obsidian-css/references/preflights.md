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
