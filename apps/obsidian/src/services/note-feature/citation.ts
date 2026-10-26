// Renders the Citation Template for the citation suggester; null until the template loads.
import { Effect } from "effect";

import type { CitationVariant, CiteRef } from "@zotlit/db";

import { Profile } from "@/services/profile/service";
import { Template } from "@/services/template/service";

/**
 * Render the Citation Template for the given items under one Citation Variant.
 * The editor runs it synchronously (from `selectSuggestion`/
 * `onChooseSuggestion` handlers, which can't await), so it answers `null`
 * instead of failing when the template isn't loaded yet; the caller shows a
 * "still loading" notice then.
 *
 * @param variant - the gesture the citation was requested with, which the
 *   Citation Template reads as `zt.variant`.
 * @returns the rendered citation in inline form.
 */
export const renderCitation = Effect.fn("NoteFeature.renderCitation")(
  function* (items: readonly CiteRef[], variant: CitationVariant) {
    const template = yield* Template;
    if (!(yield* template.loaded) || !(yield* (yield* Profile).loaded))
      return null;
    return yield* template.renderCitation(items, variant);
  },
);
