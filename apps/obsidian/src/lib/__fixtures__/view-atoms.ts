// The view services a test host leaves unread, so its registry context is
// whole. Each member dies when called.
import { Effect, FileSystem, Layer } from "effect";
import type { Context } from "effect";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { Notifier } from "@/lib/notifier";
import { ObsidianEnv } from "@/lib/obsidian-env";
import { FileManager } from "@/lib/obsidian-file-manager";
import { makeViewRegistry } from "@/lib/view-atoms";
import type { ViewServices } from "@/lib/view-atoms";
import { CapabilityNotices } from "@/services/annotation-repository/notices";
import { AnnotationRepository } from "@/services/annotation-repository/service";
import { CitationLookup } from "@/services/citation-index/lookup-service";
import { CitationText } from "@/services/citation-text/service";
import { CitekeyEditor } from "@/services/citekey-editor/service";
import { BibliographyRender } from "@/services/pandoc/render-cache";
import { PandocEngine } from "@/services/pandoc/service";
import { CitationParse } from "@/services/citation-parse/service";
import { CitationIndex } from "@/services/citation-index/service";
import { ExcerptDisplays } from "@/services/excerpt-image/display";
import type { ExcerptDisplayService } from "@/services/excerpt-image/display";
import { ItemLookup } from "@/services/item-lookup/service";
import { QueryService } from "@/services/item-query/service";
import { LibraryScope } from "@/services/library-scope/service";
import { LocalServer } from "@/services/local-server/service";
import { NoteFeature } from "@/services/note-feature/service";
import { AnnotationNoteActions } from "@/services/note-feature/view-actions";
import { NoteIndex } from "@/services/note-index/service";
import { Profile } from "@/services/profile/service";
import { QueryClients } from "@/services/query-client/service";
import { Release } from "@/services/release/service";
import { PluginSettings } from "@/services/settings/service";
import { TemplateDataReads } from "@/services/template-workbench/data-reads";
import { TemplateMigration } from "@/services/template/migration";
import { Template } from "@/services/template/service";
import { UseLedger } from "@/services/use-ledger/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

/**
 * Every view service outside the Obsidian host tags, as an empty mock. Merge
 * it first: a service the test reads, merged after it, takes its place.
 */
export const layerUnreadViewServices = Layer.mergeAll(
  Layer.mock(CitationParse, {}),
  Layer.mock(PandocEngine, {}),
  Layer.mock(BibliographyRender, {}),
  Layer.mock(CitekeyEditor, {}),
  Layer.mock(CitationText, {}),
  Layer.mock(
    ExcerptDisplays,
    stubService<ExcerptDisplayService>("ExcerptDisplays", {}),
  ),
  Layer.mock(AnnotationNoteActions, {}),
  Layer.mock(CapabilityNotices, {}),
  Layer.mock(AnnotationRepository, {}),
  Layer.mock(LocalServer, {}),
  Layer.mock(CitationIndex, {}),
  Layer.mock(CitationLookup, {}),
  Layer.mock(FileManager, {}),
  Layer.succeed(
    FileSystem.FileSystem,
    stubService<FileSystem.FileSystem>("FileSystem", {}),
  ),
  Layer.mock(
    ObsidianEnv,
    stubService<ObsidianEnv["Service"]>("ObsidianEnv", {}),
  ),
  Layer.mock(ItemLookup, {}),
  Layer.mock(NoteIndex, {}),
  Layer.mock(NoteFeature, {}),
  Layer.mock(Profile, {}),
  Layer.mock(Template, {}),
  Layer.mock(Notifier, {}),
  Layer.mock(QueryService, {}),
  Layer.mock(LibraryScope, {}),
  Layer.mock(UseLedger, {}),
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
