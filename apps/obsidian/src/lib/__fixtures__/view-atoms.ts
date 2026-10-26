// The view services a test host leaves unread, so its registry context is
// whole. Each member dies when called.
import { Layer } from "effect";

import { stubService } from "@/lib/__fixtures__/service-stub";
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
