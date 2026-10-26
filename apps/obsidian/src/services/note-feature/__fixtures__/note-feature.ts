// The Note Feature's layer over a test's plain deps, and the edge handle a test drives.
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Context, Effect, Layer } from "effect";
import type { ManagedRuntime } from "effect";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { effectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";
import { layerFileManagerFrom } from "@/lib/obsidian-file-manager";
import type {
  FileManager,
  FileManagerSource,
} from "@/lib/obsidian-file-manager";
import {
  layerMetadataCacheFrom,
  MetadataCache,
} from "@/lib/obsidian-metadata-cache";
import type { MetadataCacheSource } from "@/lib/obsidian-metadata-cache";
import { layerVaultFrom, Vault } from "@/lib/obsidian-vault";
import type { VaultSource } from "@/lib/obsidian-vault";
import { layerWorkspaceFrom } from "@/lib/obsidian-workspace";
import type { Workspace, WorkspaceSource } from "@/lib/obsidian-workspace";
import { AttachmentImport } from "@/services/attachment-import/service";
import { ExcerptImages } from "@/services/excerpt-image/layer";
import {
  ExcerptPreparation,
  layerExcerptPreparation,
} from "@/services/excerpt-image/prepare";
import type {
  NoteExcerptOptions,
  PreparedExcerpts,
} from "@/services/excerpt-image/prepare";
import type { QueryService } from "@/services/item-query/service";
import { PluginSettings } from "@/services/settings/service";
import { snapshotAt } from "@/services/attachment-import/__fixtures__";
import type { PlainTemplate } from "@/services/template/plain";
import { Template } from "@/services/template/service";
import { ZoteroPref } from "@/services/zotero-pref/service";

import type { NoteCitations } from "@/services/note-feature/citations-handle";
import { bindNoteFeature } from "@/services/note-feature/handle";
import type { NoteCreation } from "@/services/note-feature/creation-handle";
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
  attachmentImport: Pick<AttachmentImport["Service"], "prepare">;
  /** A fake excerpt preparation for each note write. */
  excerptImages?: (options: NoteExcerptOptions) => PreparedExcerpts;
  /**
   * The Excerpt Image resolver of the real preparation, which writes into
   * `app`'s vault on disk. Without it or `excerptImages`, a note write
   * prepares no excerpt and its image helpers give `null`.
   */
  excerptResolver?: Pick<ExcerptImages["Service"], "operation" | "resolve">;
}

/** A note write's excerpts when the test gives no preparation: none. */
const noExcerpts = (): PreparedExcerpts => ({
  annotationImageLink: () => null,
  prepare: Effect.void,
  summary: () => ({ zotero: 0, unchecked: 0, unavailable: 0 }),
});

/**
 * The preparation `sources` give when a write runs: their fake, the real
 * preparation over their resolver and `host`, or none.
 */
function layerExcerptPreparationOver(
  sources: NoteFeatureSources,
  host: Layer.Layer<
    | Vault
    | MetadataCache
    | Workspace
    | FileManager
  >,
  pref: Context.Context<ZoteroPref>,
): Layer.Layer<ExcerptPreparation> {
  const real = layerExcerptPreparation.pipe(
    Layer.provide(
      Layer.mergeAll(
        host,
        NodeFileSystem.layer,
        Layer.succeedContext(pref),
        Layer.succeed(
          ExcerptImages,
          stubService<ExcerptImages["Service"]>("ExcerptImages", {
            operation: (options) => sources.excerptResolver!.operation(options),
            resolve: (request, signal) =>
              sources.excerptResolver!.resolve(request, signal),
          }),
        ),
      ),
    ),
  );
  return Layer.effect(
    ExcerptPreparation,
    Effect.gen(function* () {
      const preparation = yield* ExcerptPreparation;
      // A stubbed `sources` may leave the optional members out.
      const given = <K extends "excerptImages" | "excerptResolver">(key: K) =>
        key in sources ? sources[key] : undefined;
      return ExcerptPreparation.of({
        forNote: (options) => {
          const fake = given("excerptImages");
          if (fake) return Effect.sync(() => fake(options));
          return given("excerptResolver")
            ? preparation.forNote(options)
            : Effect.sync(noExcerpts);
        },
        forCard: (options) => preparation.forCard(options),
      });
    }),
  ).pipe(Layer.provide(real));
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
  );
  return Layer.mergeAll(
    host,
    Layer.mock(AttachmentImport, {
      prepare: (notePath, options) =>
        Effect.suspend(() =>
          sources.attachmentImport.prepare(notePath, options),
        ),
    }),
    Layer.succeedContext(Context.merge(planning, plain)),
    layerExcerptPreparationOver(sources, host, plain.pipe(Context.pick(ZoteroPref))),
  );
}

/**
 * The Note Feature's edge handle over its layer, built on `sources` and held
 * by `stack`, the runtime the layer runs on, and the service itself for the
 * operations no edge handle serves. Its note writes read
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
  service: NoteFeature["Service"];
} {
  const runtime = buildRuntime(
    layerNoteFeature.pipe(
      Layer.provideMerge(noteFeatureServices(sources, options.query)),
    ),
    stack,
  );
  const service = runtime.runSync(NoteFeature);
  const handle = bindNoteFeature(
    effectBridge(runtime),
    service,
    stubService<NoteCitations & NoteCreation>("NoteFeatureEdges", {
      ...options.citations,
    }),
  );
  return { handle, runtime, service };
}
