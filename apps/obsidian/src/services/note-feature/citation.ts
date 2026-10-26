// Renders the Citation Template for the citation suggester; null until the template loads.
import type { CitationVariant, CiteRef } from "@zotlit/db";

import type { NoteFeatureDeps } from "./context";

/**
 * Render the Citation Template for the given items under one Citation Variant.
 * Synchronous (called from `selectSuggestion`/`onChooseSuggestion` handlers,
 * which can't await), so it returns `null` instead of throwing when the
 * template isn't loaded yet; the caller shows a "still loading" notice then.
 *
 * @param variant - the gesture the citation was requested with, which the
 *   Citation Template reads as `zt.variant`.
 * @returns the rendered citation in inline form.
 */
function renderCitation(
  ctx: NoteFeatureDeps,
  items: readonly CiteRef[],
  variant: CitationVariant,
): string | null {
  if (!ctx.template.loaded || !ctx.profile.loaded) return null;
  return ctx.template.renderCitation(items, variant);
}

export { renderCitation };
