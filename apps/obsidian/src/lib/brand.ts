// The paths of the canonical logo SVGs in `assets/logo/`, read by their two
// inks so a drawing can paint each ink from the theme (docs/brand.md).

/** The light-background fills of the canonical assets, by ink. */
const INKS = { "#1E3A5F": "ink", "#E8622C": "accent" } as const;

type Ink = (typeof INKS)[keyof typeof INKS];

/** A logo's path outlines, by ink, in their order in the SVG. */
export type BrandPaths = Record<Ink, string[]>;

/**
 * The outlines of the `<path>`s under `svg`'s top-level group `group` (the
 * whole SVG where absent), by their canonical fill. A fill the palette does
 * not name throws, so a change to the assets fails here rather than drawing
 * in the wrong ink.
 */
export function brandPaths(svg: string, group?: number): BrandPaths {
  const root = new DOMParser().parseFromString(
    svg,
    "image/svg+xml",
  ).documentElement;
  const scope =
    group === undefined ? root : root.querySelectorAll(":scope > g")[group];
  if (!scope) throw new Error(`The logo has no top-level group ${group}`);
  const paths: BrandPaths = { ink: [], accent: [] };
  for (const path of scope.querySelectorAll("path")) {
    const fill = path.getAttribute("fill")?.toUpperCase() ?? "";
    const ink = fill in INKS ? INKS[fill as keyof typeof INKS] : undefined;
    if (!ink) throw new Error(`The logo has a fill outside its inks: ${fill}`);
    paths[ink].push(path.getAttribute("d") ?? "");
  }
  return paths;
}
