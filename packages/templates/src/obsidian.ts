/** Wraps the auto-generated ("managed") region of a literature note body. */
export const MARKER_START = "%%zt-managed%%";
export const MARKER_END = "%%/zt-managed%%";

export function formatManagedRegion(content: string): string {
  return `${MARKER_START}\n${content.trim()}\n${MARKER_END}`;
}

/**
 * Build a {@link TemplateEngine} `transformRender` that wraps the content
 * template's output in Obsidian managed-region markers. The engine applies it
 * to every named `render()`/`include()`, so the content template wraps
 * identically by either path and every other name passes through. The template
 * name is the host's vault convention, not something this package knows — a
 * consumer that omits `transformRender` (the playground) renders verbatim.
 *
 * @param contentTemplate name of the template whose output gets wrapped
 * @returns a `transformRender` callback for {@link TemplateEngineOptions}
 */
export const managedRegionTransform =
  (contentTemplate: string) =>
  (name: string, output: string): string =>
    name === contentTemplate ? formatManagedRegion(output) : output;

const MANAGED_REGION = new RegExp(
  `${RegExp.escape(MARKER_START)}[\\s\\S]*?${RegExp.escape(MARKER_END)}`,
);
const MANAGED_REGION_GLOBAL = new RegExp(MANAGED_REGION, "g");

export interface ManagedRegionReplacement {
  /** `content` with its first managed region replaced; unchanged when none is present. */
  content: string;
  /** Whether a managed region was found and replaced. */
  replaced: boolean;
  /** Managed regions beyond the first; `0` when at most one is present. */
  duplicateCount: number;
}

/** Whether `content` holds at least one `%%zt-managed%%` region. */
export function hasManagedRegion(content: string): boolean {
  return MANAGED_REGION.test(content);
}

/**
 * Replace the first `%%zt-managed%%` region in `content` with `region`.
 *
 * Uses a function replacer so `$` sequences in `region` (e.g. `$$…$$` display
 * math, `$&`, `$'`) are inserted verbatim instead of being interpreted as
 * `String.prototype.replace` substitution patterns.
 */
export function replaceManagedRegion(
  content: string,
  region: string,
): ManagedRegionReplacement {
  const matches = content.match(MANAGED_REGION_GLOBAL) ?? [];
  const duplicateCount = Math.max(0, matches.length - 1);
  if (matches.length === 0) return { content, replaced: false, duplicateCount };
  return {
    content: content.replace(MANAGED_REGION, () => region),
    replaced: true,
    duplicateCount,
  };
}
