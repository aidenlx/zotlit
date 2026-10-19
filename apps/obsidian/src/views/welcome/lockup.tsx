// The ZotLit lockup of docs/brand.md: the two-ink mark and the wordmark, in
// the brand's inks for the theme, drawn from the canonical SVGs. The mark is
// `assets/logo/zotlit-mark-16.svg`, the 16-unit cut, drawn 1:1 so every edge
// sits on a whole pixel; the glyphs are the outlined Archivo SemiBold paths
// of `assets/logo/zotlit-wordmark.svg`, scaled to a 12px cap height on a
// baseline at y=14. That keeps the lockup's proportions: the 14px mark stands
// about 1.2 cap heights, overshooting the caps by 1px each side, and the gap
// to the Z is 0.28 of its width. The viewBox starts at the mark's ink, so the
// SVG's start edge is the mark's.

import markSvg from "@brand/zotlit-mark-16.svg?raw";
import wordmarkSvg from "@brand/zotlit-wordmark.svg?raw";

import { brandPaths } from "@/lib/brand";
import type { BrandPaths } from "@/lib/brand";
import { cn } from "@/lib/utils";

/** The wordmark's scale: a 686-unit cap height to 12px. */
const GLYPH_SCALE = 12 / 686;
/** The Z's ink starts 29 units in; it lands 4px after the mark's ink at x=15. */
const GLYPH_X = 19 - 29 * GLYPH_SCALE;

let paths: { mark: BrandPaths; glyphs: BrandPaths } | undefined;

/**
 * The mark's paths and the wordmark's glyphs, the second of its top-level
 * groups after its own 24-unit mark, read once.
 */
function lockupPaths() {
  paths ??= { mark: brandPaths(markSvg), glyphs: brandPaths(wordmarkSvg, 1) };
  return paths;
}

/** The fill of each ink, from the theme's brand variables. */
const INK_FILL = {
  ink: "zt:fill-(--zt-brand-ink)",
  accent: "zt:fill-(--zt-brand-accent)",
};

export function ZotLitLockup({ className }: { className?: string }) {
  const { mark, glyphs } = lockupPaths();
  return (
    <svg
      viewBox="1 0 64 16"
      width={64}
      height={16}
      aria-hidden="true"
      focusable="false"
      data-welcome-lockup=""
      className={cn(
        "zt:block zt:shrink-0 zt:[--zt-brand-accent:#E8622C] zt:[--zt-brand-ink:#1E3A5F] zt:in-[.theme-dark]:[--zt-brand-accent:#F0793F] zt:in-[.theme-dark]:[--zt-brand-ink:#D8E2F0]",
        className,
      )}
    >
      {(["ink", "accent"] as const).map((ink) => (
        <g key={ink} className={INK_FILL[ink]}>
          {mark[ink].map((d) => (
            <path key={d} d={d} />
          ))}
          <g transform={`translate(${GLYPH_X} 14) scale(${GLYPH_SCALE})`}>
            {glyphs[ink].map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
        </g>
      ))}
    </svg>
  );
}
