# ZotLit Brand

Visual identity for ZotLit v2, decided 2026-07-16. Assets live in [`assets/logo/`](../assets/logo/).

## Principles

- **Independent identity.** The mark stands on its own, without borrowing from Zotero (red Z) or Obsidian (purple gem). Any new asset must pass a squint test against both.
- **One geometry, every size.** All cuts derive from the same ZL ligature construction; sizes differ only in grid resolution and bar weight, never in shape language.
- **Two flat colors.** Navy carries the structure, orange carries the "Lit" accent. Solid fills, square corners, no gradients, no shadows, no rounded letterforms.
- **The fusion is the message.** Z and L share a foot and touch along the top bar — source material and literature notes joined as one unit.

## The mark

A ZL ligature: a filled navy Z whose baseline extends right to become the L's foot, with a full-height orange stem abutting the top bar. The stem terminates in a bookmark-style V-notch (45° half-angle, depth = half the stem width) evoking a page marker. The diagonal drops from directly under the navy/orange joint and lands flush in the bottom-left corner, closing a triangular counter between diagonal, foot, and stem.

| Asset | Grid | Use at |
| --- | --- | --- |
| [`zotlit-mark.svg`](../assets/logo/zotlit-mark.svg) | 24-unit, 3.5-unit bars | ≥ 24 px |
| [`zotlit-mark-16.svg`](../assets/logo/zotlit-mark-16.svg) | 16-unit integer, 3-unit bars | 16–20 px (ribbon icon, plugin list) |
| [`zotlit-tile.svg`](../assets/logo/zotlit-tile.svg) | 24-unit rounded tile, knockout mark at 0.78 (~23% padding) | contexts that need a self-contained background at generous sizes (app icon, README badge, social avatar) |
| [`zotlit-tile-16.svg`](../assets/logo/zotlit-tile-16.svg) | 16-unit rounded tile, 16-cut knockout at 0.85 (~13% padding) | favicon / browser tabs (16–32 px) |

The 16 px cut is a separate drawing, not a scaled master: every edge sits on a whole pixel and bars are exactly 3 device pixels, so the mark stays crisp where the master would anti-alias to grey. Use the master above ~24 px and the small cut at 16–20 px.

`zotlit-mark-dark.svg` and `zotlit-mark-16-dark.svg` are the same drawings with the dark-theme inks from the palette below, for UIs that swap image assets per theme (e.g. the docs navbar).

**Tile padding.** The tile owns its background, so the knockout mark needs breathing room from the tile edge — but how much depends on render size. The master tile keeps ~23% padding (comfortable at app-icon sizes, where OS grids expect an inset glyph); the favicon cut tightens to ~13% so the mark stays legible at 16 px. A favicon is always a tile, never the bare mark: navy on a transparent ground disappears on dark tab bars, while the tile is theme-invariant.

**Single-color contexts** (Obsidian ribbon icons inherit `currentColor`, print, engraving): fill both paths with one ink. The triangular counter keeps the fused glyph legible without the color split.

### Master geometry

24-unit viewBox; reproduce exactly, then scale:

```svg
<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 3.5 H17 V7 L8.75 16.5 H20.5 V20 H4 V16.5 L12.25 7 H4 Z" fill="#1E3A5F"/>
  <path d="M17 3.5 H20.5 V16.5 L18.75 14.75 L17 16.5 Z" fill="#E8622C"/>
</svg>
```

Bar weight 3.5; diagonal ≈ 3.5 perpendicular. The orange stem ends in a V-notch: from the bottom corners (17, 16.5) and (20.5, 16.5) up to the apex (18.75, 14.75), giving a notch depth of 1.75 (= half the stem width, 45° V). The 16 px cut uses the same 45° angle with depth 1.5 on its 3-unit bar. The left side is a flush vertical edge — corners stay square everywhere.

## Wordmark

"ZotLit" set in **Archivo SemiBold** (SIL Open Font License — free for commercial use, no restriction on logo usage; alternate face: Manrope, also OFL). "Zot" in ink, "Lit" in accent — both take the palette below, giving the wordmark a light and a dark rendering.

Two rendering routes:

- **Outlined SVG lockups** — for contexts we don't control (README, badges, external sites). Glyphs are outlined paths generated with opentype.js from Google Fonts' static SemiBold instance, kerning applied, so they render identically everywhere with no font dependency:
  - [`zotlit-wordmark.svg`](../assets/logo/zotlit-wordmark.svg) — light backgrounds.
  - [`zotlit-wordmark-dark.svg`](../assets/logo/zotlit-wordmark-dark.svg) — dark backgrounds.
- **Live text** — for UI we control (the docs site): render "ZotLit" as text in Archivo SemiBold, colored with the ink/accent theme tokens so light/dark follows the page theme automatically. Ship a character-subset woff2 (the five `ZotLi` glyphs, ~1 KB — Google Fonts CSS2 `text=` subsetting, or `pyftsubset`) rather than the full family; surrounding UI text stays in the site's body face. The brand depends on Archivo only for the string "ZotLit".

### Lockup layout

Shared proportions (the SVG lockups follow these; reuse them for any new lockup rather than re-eyeballing):

- Mark stands **1.2× cap height**, optically centered on the caps — it overshoots ~0.1 cap height above the cap line and below the baseline.
- Gap between mark and the Z: **0.28× mark width**.
- Tracking −1%, line-height 1. The mark reads as the first "letter" of the word; the gap is wider than the letter spacing but narrow enough that mark and word scan as one unit.

CSS recipe at wordmark font-size `1em` (Archivo cap height ≈ 0.73 em): mark `0.875em` square, gap `0.25em`, flex row with centered items and `line-height: 1`. At navbar scale (18 px text) the mark lands on 16 px — exactly the pixel-fit 16 cut.

## Palette

| Token | Light | Dark |
| --- | --- | --- |
| Ink (structure) | `#1E3A5F` navy · `oklch(34.62% 0.0736 256.04)` | `#D8E2F0` · `oklch(90.94% 0.0220 256.73)` |
| Accent ("Lit", stem) | `#E8622C` orange · `oklch(65.74% 0.1789 40.45)` | `#F0793F` · `oklch(70.36% 0.1630 44.66)` |
| Tile knockout | `#F5F2EA` · `oklch(96.13% 0.0111 89.72)` | same (tile is navy in both themes) |

OKLCH values computed from the hex sources via sRGB → linear → OKLab → OKLCH (Björn Ottosson's reference matrices); regenerate with any OKLCH conversion tool (e.g. `culori`) if the hex sources change.

The tile is theme-invariant: it carries its own navy ground, so one file serves light and dark UIs.
