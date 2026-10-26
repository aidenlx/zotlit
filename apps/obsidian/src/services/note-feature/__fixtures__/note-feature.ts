// The Note Feature's layer over a test's plain deps, and the edge handle a test drives.
import { Context, Effect, Layer } from "effect";
import type { ManagedRuntime } from "effect";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { effectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";
import { layerFileManagerFrom } from "@/lib/obsidian-file-manager";
import type { FileManagerSource } from "@/lib/obsidian-file-manager";
import {
  layerMetadataCacheFrom,
  MetadataCache,
} from "@/lib/obsidian-metadata-cache";
import type { MetadataCacheSource } from "@/lib/obsidian-metadata-cache";
import { layerVaultFrom, Vault } from "@/lib/obsidian-vault";
import type { VaultSource } from "@/lib/obsidian-vault";
import { layerWorkspaceFrom } from "@/lib/obsidian-workspace";
import type { WorkspaceSource } from "@/lib/obsidian-workspace";
import type { AttachmentImportHandle } from "@/services/attachment-import/handle";
import { AttachmentImport } from "@/services/attachment-import/service";
import type { ExcerptPreparation } from "@/services/excerpt-image/prepare";
import type { QueryService } from "@/services/item-query/service";
import { PluginSettings } from "@/services/settings/service";
import { snapshotAt } from "@/services/attachment-import/__fixtures__";
import type { PlainTemplate } from "@/services/template/plain";
import { Template } from "@/services/template/service";
import { ZoteroPref } from "@/services/zotero-pref/service";

import type { NoteCitations } from "@/services/note-feature/citations-handle";
import { bindNoteFeature } from "@/services/note-feature/handle";
import type { NoteFeatureHandle } from "@/services/note-feature/operations";
import { layerNoteFeature, NoteFeature } from "@/services/note-feature/service";
import type { NoteFeatureServices } from "@/services/note-feature/service";

import { planningContext } from "./planning-context";
import type { PlanningSources } from "./planning-context";

/** The vault, file manager, metadata cache and workspace the note writes touch. */
export interface NoteFeatureApp {
  vault: VaultSource;
  fileManager: FileManagerSource;
  metadataCache: MetadataCacheSource;
  workspace: WorkspaceSource;
}

/** The plain deps the Note Feature's services read, as a Note Feature test holds them. */
export interface NoteFeatureSources extends Omit<
  PlanningSources,
  "template" | "app"
> {
  template: PlanningSources["template"] &
    Pick<PlainTemplate, "render" | "renderManagedContent">;
  app: NoteFeatureApp;
  settings: Pick<PluginSettings["Service"], "current" | "update">;
  zoteroPref: { dataDir: string; baseAttachmentPath: string | null };
  attachmentImport: Pick<AttachmentImportHandle, "prepare">;
  excerptImages?: ExcerptPreparation;
}

/**
 * The Note Feature's services over `sources`. The Profile, Note Index,
 * Zotero reads, Template, settings, Zotero location and Attachment Import
 * read `sources` when they run, so a test may replace one after it builds
 * the layer. The capability tags run over `sources.app` as it is now.
 */
export function noteFeatureServices(
  sources: NoteFeatureSources,
  query?: QueryService["Service"],
): Layer.Layer<NoteFeatureServices> {
  const { app } = sources;
  const vault = layerVaultFrom(app.vault);
  const host = Layer.mergeAll(
    vault,
    layerFileManagerFrom(app.fileManager).pipe(Layer.provide(vault)),
    layerMetadataCacheFrom(app.metadataCache),
    layerWorkspaceFrom(app.workspace),
  );
  const planning = planningContext(sources, query).pipe(
    Context.omit(Vault, MetadataCache, Template),
  );
  const plain = Context.make(
    Template,
    stubService<Template["Service"]>("Template", {
      render: (name, data) =>
        Effect.sync(() => sources.template.render(name, data)),
      renderManagedContent: (data) =>
        Effect.sync(() => sources.template.renderManagedContent(data)),
      renderFilename: (data) =>
        Effect.sync(() => sources.template.renderFilename(data)),
      getLiteratureNoteTemplate: (reference) =>
        Effect.sync(() =>
          sources.template.getLiteratureNoteTemplate(reference),
        ),
      frontmatterFields: Effect.sync(() => sources.template.frontmatterFields),
    }),
  ).pipe(
    Context.add(
      PluginSettings,
      stubService<PluginSettings["Service"]>("PluginSettings", {
        current: Effect.suspend(() => sources.settings.current),
        update: (patch) => Effect.suspend(() => sources.settings.update(patch)),
      }),
    ),
    Context.add(
      ZoteroPref,
      stubService<ZoteroPref["Service"]>("ZoteroPref", {
        current: Effect.sync(() => snapshotAt(sources.zoteroPref)),
      }),
    ),
    Context.add(
      AttachmentImport,
      stubService<AttachmentImport["Service"]>("AttachmentImport", {
        prepare: (notePath, options) =>
          Effect.promise(() =>
            sources.attachmentImport.prepare(notePath, options),
          ).pipe(
            Effect.map((batch) => ({
              decide: batch.decide,
              resolveLink: batch.resolveLink,
              flush: Effect.promise(() => batch.flush()),
              discard: Effect.sync(() => batch.discard()),
            })),
          ),
      }),
    ),
  );
  return Layer.mergeAll(
    host,
    Layer.succeedContext(Context.merge(planning, plain)),
  );
}

/**
 * The Note Feature's edge handle over its layer, built on `sources` and held
 * by `stack`, and the runtime the layer runs on. Its note writes call
 * `sources.excerptImages` as it is when they run. The citation members fail
 * the test unless `citations` gives them.
 */
export function noteFeatureHandle(
  sources: NoteFeatureSources,
  stack: AsyncDisposableStack,
  options: {
    citations?: NoteCitations;
    query?: QueryService["Service"];
  } = {},
): {
  handle: NoteFeatureHandle;
  runtime: ManagedRuntime.ManagedRuntime<NoteFeature, never>;
} {
  const runtime = buildRuntime(
    layerNoteFeature({
      get excerptImages() {
        // A stubbed `sources` may leave the optional port out.
        return "excerptImages" in sources ? sources.excerptImages : undefined;
      },
    }).pipe(Layer.provideMerge(noteFeatureServices(sources, options.query))),
    stack,
  );
  const handle = bindNoteFeature(
    effectBridge(runtime),
    runtime.runSync(NoteFeature),
    options.citations ?? stubService<NoteCitations>("NoteCitations", {}),
  );
  return { handle, runtime };
}
