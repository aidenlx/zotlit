// The view services a test host leaves unread, so its registry context is
// whole. Each member dies when called.
import { Effect, Layer } from "effect";
import type { Context } from "effect";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { makeViewRegistry } from "@/lib/view-atoms";
import type { ViewServices } from "@/lib/view-atoms";
import { CitationIndex } from "@/services/citation-index/service";
import { TemplateDataReads } from "@/services/template-workbench/data-reads";
import { ZoteroReads } from "@/services/zotero-reads/service";

/**
 * Every view service outside the Obsidian host tags, as an empty mock. Merge
 * it first: a service the test reads, merged after it, takes its place.
 */
export const layerUnreadViewServices = Layer.mergeAll(
  Layer.mock(CitationIndex, {}),
  Layer.mock(TemplateDataReads, {}),
  Layer.mock(ZoteroReads, {
    reads: stubService<ZoteroReads["Service"]["reads"]>("ZoteroReadsApi", {}),
  }),
);

/**
 * A view registry over `context`, with no idle delay, disposed when the
 * current scope closes, a failed assertion included.
 */
export const scopedViewRegistry = (context: Context.Context<ViewServices>) =>
  Effect.acquireRelease(
    Effect.sync(() => makeViewRegistry(context, { idleTTL: 0 })),
    (registry) => Effect.sync(() => registry.dispose()),
  );
