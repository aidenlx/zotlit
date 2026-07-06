// Inline color-mark HTML (class + data-color + CSS-var style) shared by Zotero
// annotation excerpts and note-editor color spans.

export type ColorMarkKind = "highlight" | "underline" | "text";

interface ColorMarkSpec {
  tag: string;
  className: string;
  cssProp: string;
  cssVar: string;
}

const COLOR_MARK_SPEC: Record<ColorMarkKind, ColorMarkSpec> = {
  highlight: {
    tag: "mark",
    className: "zotlit-hl",
    cssProp: "background-color",
    cssVar: "--zotlit-hl",
  },
  underline: {
    tag: "u",
    className: "zotlit-ul",
    cssProp: "text-decoration-color",
    cssVar: "--zotlit-ul",
  },
  text: {
    tag: "span",
    className: "zotlit-color",
    cssProp: "color",
    cssVar: "--zotlit-color",
  },
};

/**
 * Render an inline color mark as
 * `<tag class="…" [data-color="…" style="prop: var(--zotlit-…-{name}, {raw})"]>text</tag>`.
 * Color resolves to a theme-overridable CSS variable with the raw color as
 * fallback, so it renders standalone yet a snippet can override it without
 * `!important`. An unmapped color (`name` null) falls back to the inline raw
 * color with no variable; a colorless mark (`color` null) keeps just the class.
 *
 * @param color.raw - the source CSS color (`#rrggbb`, `rgb(...)`, or `rgba(...)`),
 *   used as the `var()` fallback.
 * @param color.name - the palette name resolved by the caller
 *   (`annotationColorToName` / `highlightColorToName` / `textColorToName`), or
 *   `null` when the color is outside the palette.
 */
export function renderColorMark(
  kind: ColorMarkKind,
  text: string,
  color: { raw: string; name: string | null } | null,
): string {
  const { tag, className, cssProp, cssVar } = COLOR_MARK_SPEC[kind];
  let attrs = ` class="${className}"`;
  if (color) {
    attrs += color.name
      ? ` data-color="${color.name}" style="${cssProp}: var(${cssVar}-${color.name}, ${color.raw});"`
      : ` style="${cssProp}: ${color.raw};"`;
  }
  return `<${tag}${attrs}>${text}</${tag}>`;
}
