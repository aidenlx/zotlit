// Template data as one tag, for the views: a view atom reads it without the
// whole set of services the data is built from.
import { Context, Effect, Layer } from "effect";

import type { CitationVariant, ContractRoot } from "@zotlit/db";

import { readCitationData, readTemplateData } from "./data";
import type {
  CitationDataLoadResult,
  CitationSelector,
  TemplateDataError,
  TemplateDataLoadResult,
  TemplateDataServices,
} from "./data";

export class TemplateDataReads extends Context.Service<
  TemplateDataReads,
  {
    /** {@link readTemplateData}: one root for the object an Indexed Key names. */
    read(
      indexedKey: string,
      root: ContractRoot,
    ): Effect.Effect<TemplateDataLoadResult, TemplateDataError>;
    /** {@link readCitationData}: a Citation set under one Variant. */
    readCitation(
      selector: CitationSelector,
      variant: CitationVariant,
    ): Effect.Effect<CitationDataLoadResult, TemplateDataError>;
  }
>()("zotlit/template-workbench/TemplateDataReads") {}

export const layerTemplateDataReads: Layer.Layer<
  TemplateDataReads,
  never,
  TemplateDataServices
> = Layer.effect(
  TemplateDataReads,
  Effect.gen(function* () {
    const context = yield* Effect.context<TemplateDataServices>();
    return {
      read: Effect.fn("TemplateDataReads.read")((indexedKey, root) =>
        readTemplateData(indexedKey, root).pipe(Effect.provideContext(context)),
      ),
      readCitation: Effect.fn("TemplateDataReads.readCitation")(
        (selector, variant) =>
          readCitationData(selector, variant).pipe(
            Effect.provideContext(context),
          ),
      ),
    };
  }),
);
