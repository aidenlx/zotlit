// The ZotLit lockup of docs/brand.md: the two-ink mark and the wordmark, in
// the brand's inks for the theme. The mark is the 16-unit cut of
// `assets/logo/zotlit-mark-16.svg`, drawn 1:1 so every edge sits on a whole
// pixel; the glyphs are the outlined Archivo SemiBold paths of
// `assets/logo/zotlit-wordmark.svg`, scaled to a 12px cap height on a baseline
// at y=14. That keeps the lockup's proportions: the 14px mark stands about 1.2
// cap heights, overshooting the caps by 1px each side, and the gap to the Z is
// 0.28 of its width. The viewBox starts at the mark's ink, so the SVG's start
// edge is the mark's.

import { cn } from "@/lib/utils";

/** The wordmark's scale: a 686-unit cap height to 12px. */
const GLYPH_SCALE = 12 / 686;
/** The Z's ink starts 29 units in; it lands 4px after the mark's ink at x=15. */
const GLYPH_X = 19 - 29 * GLYPH_SCALE;

export function ZotLitLockup({ className }: { className?: string }) {
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
      <g className="zt:fill-(--zt-brand-ink)">
        <path d="M1.69 1 H12 V4 L5.97 12 H15 V15 H1.78 A0.78 0.78 0 0 1 1 14.22 V12.55 A1.65 1.65 0 0 1 1.33 11.56 L7.03 4 H1.21 A0.21 0.21 0 0 1 1 3.79 V1.69 A0.69 0.69 0 0 1 1.69 1 Z" />
        <g transform={`translate(${GLYPH_X} 14) scale(${GLYPH_SCALE})`}>
          <path d="M597 0L29 0L29-62L395-575L55-575L55-686L588-686L588-623L222-111L597-111L597 0Z" />
          <path d="M933 12L933 12Q847 12 789-17.5Q731-47 702-108Q673-169 673-263L673-263Q673-358 702-418.5Q731-479 789-508.5Q847-538 933-538L933-538Q1020-538 1077.5-508.5Q1135-479 1164-418.5Q1193-358 1193-263L1193-263Q1193-169 1164-108Q1135-47 1077.5-17.5Q1020 12 933 12ZM933-88L933-88Q981-88 1010.5-106.5Q1040-125 1053.5-162.5Q1067-200 1067-256L1067-256L1067-270Q1067-326 1053.5-363.5Q1040-401 1010.5-419.5Q981-438 933-438L933-438Q885-438 855.5-419.5Q826-401 812.5-363.5Q799-326 799-270L799-270L799-256Q799-200 812.5-162.5Q826-125 855.5-106.5Q885-88 933-88Z" />
          <path d="M1436 12L1436 12Q1387 12 1359-7.5Q1331-27 1319.5-57.5Q1308-88 1308-120L1308-120L1308-426L1245-426L1245-526L1311-526L1333-673L1430-673L1430-526L1521-526L1521-426L1430-426L1430-132Q1430-111 1441-99.5Q1452-88 1474-88L1474-88L1521-88L1521-4Q1511 0 1496.5 3.5Q1482 7 1466 9.5Q1450 12 1436 12Z" />
        </g>
      </g>
      <g className="zt:fill-(--zt-brand-accent)">
        <path d="M12 1 H15 V12 L13.5 10.5 L12 12 Z" />
        <g transform={`translate(${GLYPH_X} 14) scale(${GLYPH_SCALE})`}>
          <path d="M2096 0L1622 0L1622-686L1752-686L1752-113L2096-113L2096 0Z" />
          <path d="M2303-607L2181-607L2181-723L2303-723L2303-607ZM2303 0L2181 0L2181-526L2303-526L2303 0Z" />
          <path d="M2572 12L2572 12Q2523 12 2495-7.5Q2467-27 2455.5-57.5Q2444-88 2444-120L2444-120L2444-426L2381-426L2381-526L2447-526L2469-673L2566-673L2566-526L2657-526L2657-426L2566-426L2566-132Q2566-111 2577-99.5Q2588-88 2610-88L2610-88L2657-88L2657-4Q2647 0 2632.5 3.5Q2618 7 2602 9.5Q2586 12 2572 12Z" />
        </g>
      </g>
    </svg>
  );
}
