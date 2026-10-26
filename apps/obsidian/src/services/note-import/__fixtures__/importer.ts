// The real note importer layer over a test's Profile, Note Index, Template,
// Zotero paths, Obsidian host and legacy ports.
import { Context, Effect, Layer } from "effect";
import type { TFile } from "obsidian";

import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import { stubService } from "@/lib/__fixtures__/service-stub";
import type { VaultSource } from "@/lib/obsidian-vault";
import type { WorkspaceSource } from "@/lib/obsidian-workspace";
import { layerNoteImporter, NoteImporter } from "@/services/note-import/service";
import type { NoteImportPorts } from "@/services/note-import/service";
import { NoteIndex } from "@/services/note-index/service";
import { Profile } from "@/services/profile/service";
import type { ProfileReader } from "@/services/profile/service";
import { Template } from "@/services/template/service";
import type { TemplateOperations } from "@/services/template/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";

/** What a test gives the importer, in the plain shapes it states them in. */
export interface ImporterFakes extends NoteImportPorts {
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
  return layerNoteImporter({
    attachmentImport: fakes.attachmentImport,
    excerptImages: fakes.excerptImages,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
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
        Layer.mock(ZoteroPref, {
          current: Effect.sync(() =>
            stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", {
              dataDir: fakes.zoteroPref.dataDir,
              baseAttachmentPath: fakes.zoteroPref.baseAttachmentPath,
            }),
          ),
        }),
      ),
    ),
  );
}

/** The importer service of {@link layerNoteImporterOver}, for the case's Scope. */
export const noteImporterOver = (fakes: ImporterFakes) =>
  Effect.map(Layer.build(layerNoteImporterOver(fakes)), (context) =>
    Context.get(context, NoteImporter),
  );
