// The Citation Suggester's render: the Citation Template under one Citation Variant.
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe, expect, vi } from "vitest";

import {
  citekeysToCiteTemplateData,
  itemBaseFields,
  resolveVenue,
} from "@zotlit/db";
import type { CiteRef, Item } from "@zotlit/db";
import { rowInstant } from "@zotlit/db/test-utils";
import { inlineCitation } from "@zotlit/templates";
import { TemplateFacade } from "@zotlit/templates/facade";
import type { ItemFields } from "@zotlit/zotero-types";

import { Profile } from "@/services/profile/service";
import { CITATION_TEMPLATE_SOURCE } from "@/services/template/defaults";
import { Template } from "@/services/template/service";

import { renderCitation } from "./citation";

/** The Template and Profile tags, with `renderCitation` over `render`. */
function citationLayer(
  render: (refs: readonly CiteRef[], variant: "main" | "alt") => string,
  loaded: { template?: boolean; profile?: boolean } = {},
) {
  return Layer.mergeAll(
    Layer.mock(Template, {
      loaded: Effect.succeed(loaded.template ?? true),
      renderCitation: (refs, variant) =>
        Effect.sync(() => render(refs, variant)),
    }),
    Layer.mock(Profile, { loaded: Effect.succeed(loaded.profile ?? true) }),
  );
}

/** A `renderCitation` backed by the real engine over one Citation Template source. */
function citationTemplate(source = CITATION_TEMPLATE_SOURCE) {
  const facade = new TemplateFacade();
  facade.define("citation", source, "liquid");
  return (refs: readonly CiteRef[], variant: "main" | "alt") =>
    inlineCitation(
      facade.render("citation", citekeysToCiteTemplateData(refs, variant)),
    );
}

describe("renderCitation", () => {
  // renderCitation runs inside selectSuggestion/onChooseSuggestion, which
  // can't await the Template; the `loaded` gate answers null so a cold-start
  // citation insert shows "still loading" instead of a failure.
  it.effect.each([
    ["the template", { template: false }],
    ["the Profiles", { profile: false }],
  ] as const)("answers null while %s are not loaded", ([, loaded]) =>
    Effect.gen(function* () {
      const render = vi.fn(() => "");
      const result = yield* renderCitation(
        [{ citationKey: "root2024" }],
        "main",
      ).pipe(Effect.provide(citationLayer(render, loaded)));
      expect(result).toBeNull();
      expect(render).not.toHaveBeenCalled();
    }),
  );

  it.effect("renders the alternate variant from the same document", () =>
    // One Citation Template answers both gestures: Shift+Enter and a trailing
    // slash arrive as the alt variant, which the built-in source maps to an
    // Author-in-text Citation.
    Effect.gen(function* () {
      const result = yield* renderCitation(
        [{ citationKey: "smith2024" }],
        "alt",
      ).pipe(Effect.provide(citationLayer(citationTemplate())));
      expect(result).toBe("@smith2024");
    }),
  );

  it.effect("hands the variant to a document that branches on zt.variant", () =>
    // The variant names the gesture only: a custom document decides what each
    // one renders, so a vault can map alt to anything it likes.
    Effect.gen(function* () {
      const layer = citationLayer(
        citationTemplate(
          "{% if zt.variant == 'alt' %}~{{ zt.citations[0].item.citationKey }}~" +
            "{% else %}<{{ zt.citations[0].item.citationKey }}>{% endif %}",
        ),
      );
      const render = (variant: "main" | "alt") =>
        renderCitation([{ citationKey: "smith2024" }], variant).pipe(
          Effect.provide(layer),
        );
      expect(yield* render("main")).toBe("<smith2024>");
      expect(yield* render("alt")).toBe("~smith2024~");
    }),
  );

  it.effect(
    "carries the selected item's full narrowed data through to the Citation Template (9.2-CSL #03)",
    () =>
      // Citation-suggest passes the selected search hit's full item alongside
      // its citationKey; a data-driven (author-year) Citation Template should
      // see the item's title/date, not just a citekey-only stub.
      Effect.gen(function* () {
        const result = yield* renderCitation(
          [{ citationKey: "root2024", item: statedChoiceMethods() }],
          "main",
        ).pipe(
          Effect.provide(
            citationLayer((refs) =>
              citekeysToCiteTemplateData(refs, "main")
                .citations.map((c) => c.item.title)
                .join("; "),
            ),
          ),
        );
        expect(result).toBe("Stated choice methods");
      }),
  );
});

function statedChoiceMethods(): Item {
  const fields = {
    itemType: "journalArticle",
    title: "Stated choice methods",
    citationKey: "root2024",
  } as ItemFields;
  const baseFields = itemBaseFields(fields);
  return {
    itemID: 1,
    libraryID: 1,
    key: "RTKEY234",
    indexedKey: "RTKEY234",
    dateAdded: rowInstant("2024-01-15T10:00:00Z"),
    dateModified: rowInstant("2024-01-15T10:00:00Z"),
    creators: [],
    primaryCreatorType: "author",
    customFields: new Map(),
    groupID: null,
    fields,
    baseFields,
    venue: resolveVenue(baseFields),
  };
}
