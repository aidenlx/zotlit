// The ZotLit mark as an Obsidian icon: the 16-unit cut of
// `assets/logo/zotlit-mark-16.svg`, scaled into the 100-unit box an icon
// draws in, in one ink, as a ribbon icon takes `currentColor` (docs/brand.md).
import markSvg from "@brand/zotlit-mark-16.svg?raw";

import { brandPaths } from "@/lib/brand";

/** The id the Library View's tab and ribbon icon draw. */
export const ZOTLIT_MARK_ICON = "zotlit-mark";

/** The mark's paths, both inks in `currentColor`, for `addIcon`. */
export function zotlitMarkSvg(): string {
  const { ink, accent } = brandPaths(markSvg);
  const paths = [...ink, ...accent].map((d) => `<path d="${d}"/>`).join("");
  return `<g transform="scale(6.25)" fill="currentColor">${paths}</g>`;
}
