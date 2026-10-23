// The plugin's services that live in the Effect Layer graph, converted or bridged.
import type { Plugin } from "obsidian";

import { Layer } from "@/lib/effect";
import { ObsidianApp } from "@/lib/obsidian-app";

import { layerChineseSegmenter } from "./chinese-segmenter/service";
import type { ChineseSegmenter } from "./chinese-segmenter/service";
import { layerCitationLookup } from "./citation-index/lookup-service";
import type { CitationLookup } from "./citation-index/lookup-service";
import { layerCitationParse } from "./citation-parse/service";
import type { CitationParse } from "./citation-parse/service";
import { layerLibraryScope } from "./library-scope/service";
import type { LibraryScope } from "./library-scope/service";
import { layerLogging, layerLogOutput } from "./log/service";
import { layerManagedBinaryPlatform } from "./managed-binary/service";
import { layerNoteIndex } from "./note-index/service";
import type { NoteIndex } from "./note-index/service";
import { layerPandocEngine } from "./pandoc/service";
import type { PandocEngine } from "./pandoc/service";
import { layerProfile } from "./profile/service";
import type { Profile } from "./profile/service";
import { layerQueryClients } from "./query-client/service";
import type { QueryClients } from "./query-client/service";
import { layerPluginSettings } from "./settings/service";
import type { PluginSettings } from "./settings/service";
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
 * from the Effect Clock, which a test replaces.
 */
export function pluginLayer(
  plugin: Plugin,
  migration: TemplateMigrationOptions,
): Layer.Layer<
  | CitationLookup
  | Profile
  | LibraryScope
  | ZoteroReads
  | PluginSettings
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
  return layerCitationLookup.pipe(
    Layer.provideMerge(Layer.mergeAll(layerLibraryScope, layerProfile)),
    Layer.provideMerge(layerZoteroReads(workerClient())),
    Layer.provideMerge(
      Layer.mergeAll(
        layerUseLedger,
        layerTemplateMigration(migration).pipe(
          Layer.provideMerge(layerTemplate),
        ),
        layerZoteroPref.pipe(Layer.provide(layerZoteroPrefFiles)),
        Layer.mergeAll(layerChineseSegmenter, layerPandocEngine).pipe(
          Layer.provide(layerManagedBinaryPlatform),
        ),
        layerNoteIndex,
        layerCitationParse,
        layerQueryClients,
      ),
    ),
    Layer.provide(Layer.succeed(ObsidianApp, plugin.app)),
    Layer.provideMerge(
      layerLogging.pipe(Layer.provide(layerLogOutput(plugin))),
    ),
    Layer.provideMerge(layerPluginSettings(plugin)),
  );
}
