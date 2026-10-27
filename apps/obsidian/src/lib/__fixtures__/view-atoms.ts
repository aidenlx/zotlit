// The view services a test host leaves unread, so its registry context is
// whole. Each member dies when called.
import { Effect, Layer } from "effect";
import type { Context } from "effect";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { Notifier } from "@/lib/notifier";
import { makeViewRegistry } from "@/lib/view-atoms";
import type { ViewServices } from "@/lib/view-atoms";
import { CitationIndex } from "@/services/citation-index/service";
import { QueryClients } from "@/services/query-client/service";
import { Release } from "@/services/release/service";
import { PluginSettings } from "@/services/settings/service";
import { TemplateDataReads } from "@/services/template-workbench/data-reads";
import { TemplateMigration } from "@/services/template/migration";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

/**
 * Every view service outside the Obsidian host tags, as an empty mock. Merge
 * it first: a service the test reads, merged after it, takes its place.
 */
export const layerUnreadViewServices = Layer.mergeAll(
  Layer.mock(CitationIndex, {}),
  Layer.mock(Notifier, {}),
  Layer.mock(PluginSettings, {}),
  Layer.mock(Release, { version: "" }),
  Layer.mock(QueryClients, {
    client: stubService<QueryClients["Service"]["client"]>("QueryClient", {}),
  }),
  Layer.mock(TemplateMigration, {}),
  Layer.mock(ZoteroPref, {}),
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
