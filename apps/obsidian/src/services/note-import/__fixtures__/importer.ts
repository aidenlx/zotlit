// The real note importer layer over a test's Profile, Note Index, Template,
// Zotero paths, Obsidian host and excerpt preparation.
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Context, Effect, Layer, Stream } from "effect";
import type { TFile } from "obsidian";

import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import { stubService } from "@/lib/__fixtures__/service-stub";
import type { FileManagerSource } from "@/lib/obsidian-file-manager";
import type { MetadataCacheSource } from "@/lib/obsidian-metadata-cache";
import type { VaultSource } from "@/lib/obsidian-vault";
import type { WorkspaceSource } from "@/lib/obsidian-workspace";
import { layerAttachmentImportOver } from "@/services/attachment-import/__fixtures__";
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
import { layerNoteImporter, NoteImporter } from "@/services/note-import/service";
import { NoteIndex } from "@/services/note-index/service";
import { Profile } from "@/services/profile/service";
import type { ProfileReader } from "@/services/profile/service";
import { Template } from "@/services/template/service";
import type { TemplateOperations } from "@/services/template/service";
import type { Settings } from "@/services/settings/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";

/**
 * The real Attachment Import over the importer's vault, with these settings,
 * the file manager's links, and the vault on disk at `basePath`.
 */
export interface RealAttachmentImport {
  readonly settings: Pick<
    Settings,
    "attachment.import" | "attachment.folder-path"
  >;
  readonly fileManager: FileManagerSource;
  readonly basePath: string;
}

/**
 * The real excerpt preparation over the importer's vault and workspace, with
 * this resolver, the file manager's links and the metadata cache.
 */
export interface RealExcerptPreparation {
  readonly resolver: Pick<ExcerptImages["Service"], "operation" | "resolve">;
  readonly fileManager: FileManagerSource;
  readonly metadataCache?: MetadataCacheSource;
}

/** What a test gives the importer, in the plain shapes it states them in. */
export interface ImporterFakes {
  /**
   * The excerpt preparation's `forNote`, faked, or the real preparation.
   * Without it a note write prepares no excerpt.
   */
  readonly excerptImages?:
    | ((options: NoteExcerptOptions) => PreparedExcerpts)
    | RealExcerptPreparation;
  /** Attachment Import's `prepare`, faked, or the real layer. */
  readonly attachmentImport:
    | Pick<AttachmentImport["Service"], "prepare">
    | RealAttachmentImport;
  readonly vault: VaultSource;
  readonly workspace?: WorkspaceSource;
  readonly profile: Pick<ProfileReader, "resolveProfile" | "profileOf">;
  readonly noteIndex: {
    getImportedNoteByNoteKey(noteKey: string): TFile[];
    getNotesByItemKey(indexedKey: string): TFile[];
  };
  readonly template: Pick<
    TemplateOperations,
    "render" | "renderCitation" | "renderProfileAnnotation"
  >;
  readonly zoteroPref: Pick<
    ZoteroPrefSnapshot,
    "dataDir" | "baseAttachmentPath"
  >;
}

/** {@link layerNoteImporter} over `fakes`, with the tags it reads. */
export function layerNoteImporterOver(
  fakes: ImporterFakes,
): Layer.Layer<NoteImporter> {
  const current = Effect.sync(() =>
    stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", {
      dataDir: fakes.zoteroPref.dataDir,
      baseAttachmentPath: fakes.zoteroPref.baseAttachmentPath,
    }),
  );
  const attachments = fakes.attachmentImport;
  return layerNoteImporter.pipe(
    Layer.provide(
      Layer.mergeAll(
        layerExcerptPreparationOver(fakes, current),
        "prepare" in attachments
          ? Layer.mock(AttachmentImport, { prepare: attachments.prepare })
          : layerAttachmentImportOver({
              settings: attachments.settings,
              pref: { current, changes: Stream.empty },
              host: { vault: fakes.vault, fileManager: attachments.fileManager },
              basePath: attachments.basePath,
            }),
        layerHost({ vault: fakes.vault, workspace: fakes.workspace }),
        Layer.mock(Profile, {
          resolveProfile: (selector) =>
            Effect.sync(() => fakes.profile.resolveProfile(selector)),
          profileOf: (file) => Effect.sync(() => fakes.profile.profileOf(file)),
        }),
        Layer.mock(NoteIndex, {
          getImportedNoteByNoteKey: (noteKey) =>
            Effect.sync(() => fakes.noteIndex.getImportedNoteByNoteKey(noteKey)),
          getNotesByItemKey: (indexedKey) =>
            Effect.sync(() => fakes.noteIndex.getNotesByItemKey(indexedKey)),
        }),
        Layer.mock(Template, {
          render: (name, data) =>
            Effect.sync(() => fakes.template.render(name, data)),
          renderCitation: (refs, variant) =>
            Effect.sync(() => fakes.template.renderCitation(refs, variant)),
          renderProfileAnnotation: (data, options) =>
            Effect.sync(() =>
              fakes.template.renderProfileAnnotation(data, options),
            ),
        }),
        Layer.mock(ZoteroPref, { current }),
      ),
    ),
  );
}

/** The importer service of {@link layerNoteImporterOver}, for the case's Scope. */
export const noteImporterOver = (fakes: ImporterFakes) =>
  Effect.map(Layer.build(layerNoteImporterOver(fakes)), (context) =>
    Context.get(context, NoteImporter),
  );

/** {@link ImporterFakes.excerptImages} as the preparation tag. */
function layerExcerptPreparationOver(
  fakes: ImporterFakes,
  current: Effect.Effect<ZoteroPrefSnapshot>,
): Layer.Layer<ExcerptPreparation> {
  const excerpts = fakes.excerptImages;
  if (excerpts === undefined || typeof excerpts === "function")
    return Layer.mock(ExcerptPreparation, {
      forNote: (options) =>
        Effect.sync(() =>
          excerpts
            ? excerpts(options)
            : {
                annotationImageLink: () => null,
                prepare: Effect.void,
                summary: () => ({ zotero: 0, unchecked: 0, unavailable: 0 }),
              },
        ),
    });
  return layerExcerptPreparation.pipe(
    Layer.provide(
      Layer.mergeAll(
        layerHost({
          vault: fakes.vault,
          workspace: fakes.workspace,
          fileManager: excerpts.fileManager,
          metadataCache: excerpts.metadataCache,
        }),
        NodeFileSystem.layer,
        Layer.mock(ZoteroPref, { current }),
        Layer.succeed(
          ExcerptImages,
          stubService<ExcerptImages["Service"]>("ExcerptImages", {
          operation: (options) => excerpts.resolver.operation(options),
          resolve: (request, signal) =>
            excerpts.resolver.resolve(request, signal),
          }),
        ),
      ),
    ),
  );
}
