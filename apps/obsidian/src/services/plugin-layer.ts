// The plugin's services that live in the Effect Layer graph, converted or bridged.
import type { Plugin } from "obsidian";

import type { CliHost } from "@/lib/cli-command";
import { Layer } from "@/lib/effect";
import { ObsidianApp } from "@/lib/obsidian-app";
import { PluginHost } from "@/lib/plugin-host";
import { openLibraryView } from "@/views/library/register";

import { layerChineseSegmenter } from "./chinese-segmenter/service";
import type { ChineseSegmenter } from "./chinese-segmenter/service";
import { layerCitationsCli } from "./citation-index/cli/register";
import { layerCitationLookup } from "./citation-index/lookup-service";
import type { CitationLookup } from "./citation-index/lookup-service";
import { layerCitationIndex } from "./citation-index/service";
import type { CitationIndex } from "./citation-index/service";
import { layerCitationParse } from "./citation-parse/service";
import type { CitationParse } from "./citation-parse/service";
import { layerCitationText } from "./citation-text/service";
import type { CitationText } from "./citation-text/service";
import { layerDatabaseActions } from "./database/actions";
import { layerLibraryScopeCli } from "./library-scope/cli";
import { layerLibraryScopeNotices } from "./library-scope/notices";
import { layerLibraryScope } from "./library-scope/service";
import type { LibraryScope } from "./library-scope/service";
import { layerLogging, layerLogOutput } from "./log/service";
import { layerManagedBinaryPlatform } from "./managed-binary/service";
import { layerNoteIndex } from "./note-index/service";
import type { NoteIndex } from "./note-index/service";
import { layerCitationStyleNotice } from "./pandoc/notices";
import { layerPandocResolve } from "./pandoc/register";
import { layerBibliographyRender } from "./pandoc/render-cache";
import type { BibliographyRender } from "./pandoc/render-cache";
import { layerPandocEngine } from "./pandoc/service";
import type { PandocEngine } from "./pandoc/service";
import { layerProfile } from "./profile/service";
import type { Profile } from "./profile/service";
import { layerQueryClients } from "./query-client/service";
import type { QueryClients } from "./query-client/service";
import { layerReleaseActions } from "./release/actions";
import { layerRelease } from "./release/service";
import type { Release } from "./release/service";
import { layerPluginSettings } from "./settings/service";
import type { PluginSettings } from "./settings/service";
import { startingAs } from "./startup-failure";
import { layerCitationTemplateActions } from "./template/actions";
import { layerTemplateMigration } from "./template/migration";
import type {
  TemplateMigration,
  TemplateMigrationOptions,
} from "./template/migration";
import { layerTemplate } from "./template/service";
import type { Template } from "./template/service";
import { layerUseLedger } from "./use-ledger/service";
import type { UseLedger } from "./use-ledger/service";
import { layerZoteroPref, layerZoteroPrefFiles } from "./zotero-pref/service";
import type { ZoteroPref } from "./zotero-pref/service";
import { layerZoteroReads } from "./zotero-reads/service";
import type { ZoteroReads } from "./zotero-reads/service";
import { workerClient } from "./zotero-reads/worker-client";

/**
 * The graph `buildServices` builds before the container over `plugin`:
 * converted services, and the legacy services bridged into it with
 * `serviceLayer`. Settings and logging build first, so every other service
 * logs from its first line and closes before them. Every service reads time
 * from the Effect Clock, which a test replaces. Each layer starts under its
 * service's name, so a defect during acquisition names what failed.
 *
 * Above the services sit the layers that register a service's notices and
 * commands on `plugin`. They hold no service of their own, so unloading the
 * plugin releases them before the services they read.
 */
export function pluginLayer(
  plugin: Plugin & CliHost,
  migration: TemplateMigrationOptions,
): Layer.Layer<
  | CitationText
  | CitationIndex
  | BibliographyRender
  | CitationLookup
  | Profile
  | LibraryScope
  | ZoteroReads
  | PluginSettings
  | Release
  | UseLedger
  | QueryClients
  | CitationParse
  | ZoteroPref
  | ChineseSegmenter
  | PandocEngine
  | NoteIndex
  | Template
  | TemplateMigration
> {
  const services = layerCitationText().pipe(
    startingAs("CitationText"),
    Layer.provideMerge(layerCitationIndex().pipe(startingAs("CitationIndex"))),
    Layer.provideMerge(
      Layer.mergeAll(
        layerBibliographyRender.pipe(startingAs("BibliographyRender")),
        layerCitationLookup.pipe(startingAs("CitationLookup")),
      ),
    ),
    Layer.provideMerge(
      Layer.mergeAll(
        layerLibraryScope.pipe(startingAs("LibraryScope")),
        layerProfile.pipe(startingAs("Profile")),
      ),
    ),
    Layer.provideMerge(
      layerZoteroReads(workerClient()).pipe(startingAs("ZoteroReads")),
    ),
    Layer.provideMerge(
      Layer.mergeAll(
        layerUseLedger.pipe(startingAs("UseLedger")),
        layerRelease({
          version: plugin.manifest.version,
          // A first install or an update opens the Library View, in place of
          // the empty tab or beside the open note.
          openFirstScreen: async () => {
            await openLibraryView(plugin.app, { pane: "first-screen" });
          },
        }).pipe(startingAs("Release")),
        layerTemplateMigration(migration).pipe(
          startingAs("TemplateMigration"),
          Layer.provideMerge(layerTemplate.pipe(startingAs("Template"))),
        ),
        layerZoteroPref.pipe(
          Layer.provide(layerZoteroPrefFiles),
          startingAs("ZoteroPref"),
        ),
        Layer.mergeAll(
          layerChineseSegmenter.pipe(startingAs("ChineseSegmenter")),
          layerPandocEngine.pipe(startingAs("PandocEngine")),
        ).pipe(Layer.provide(layerManagedBinaryPlatform)),
        layerNoteIndex.pipe(startingAs("NoteIndex")),
        layerCitationParse.pipe(startingAs("CitationParse")),
        layerQueryClients.pipe(startingAs("QueryClients")),
      ),
    ),
    Layer.provide(Layer.succeed(ObsidianApp, plugin.app)),
    Layer.provideMerge(
      layerLogging.pipe(
        Layer.provide(layerLogOutput(plugin)),
        startingAs("Logging"),
      ),
    ),
    Layer.provideMerge(
      layerPluginSettings(plugin).pipe(startingAs("PluginSettings")),
    ),
  );
  const registrations = Layer.mergeAll(
    layerCitationsCli.pipe(startingAs("CitationsCli")),
    layerCitationStyleNotice.pipe(startingAs("CitationStyleNotice")),
    layerCitationTemplateActions.pipe(startingAs("CitationTemplateActions")),
    layerDatabaseActions.pipe(startingAs("DatabaseActions")),
    layerLibraryScopeCli.pipe(startingAs("LibraryScopeCli")),
    layerLibraryScopeNotices.pipe(startingAs("LibraryScopeNotices")),
    layerPandocResolve.pipe(startingAs("PandocResolve")),
    layerReleaseActions.pipe(startingAs("ReleaseActions")),
  ).pipe(Layer.provide(Layer.succeed(PluginHost, plugin)));
  return registrations.pipe(Layer.provideMerge(services));
}
