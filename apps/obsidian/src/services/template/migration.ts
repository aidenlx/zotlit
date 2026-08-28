import { join } from "node:path/posix";
import type { FileManager, Vault, Workspace } from "obsidian";

import { getIndexedItemIDsByLibrary, getItemDisplayRefByID } from "@zotlit/db";
import {
  CONVERTED_DEFAULT_PROFILE_DOCUMENT,
  LegacyTemplateConversionError,
} from "@zotlit/templates/facade";

import { getLogger } from "@/lib/log";
import type { DatabaseService } from "@/services/database/service";
import type { LibraryScopeService } from "@/services/library-scope/service";
import type { NoteIndex } from "@/services/note-index/service";
import { Service } from "@/services/service-base";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";
import { loadTemplateData } from "@/services/template-workbench/data";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import { templateFileFromPath } from "./defaults";
import type { ConvertedLegacyProfileDocument } from "./service";
import type { TemplateService } from "./service";

const logger = getLogger(["template", "migration"]);

interface MigrationSettings {
  loaded: Promise<
    Readonly<
      Pick<
        Settings,
        | "note.default-profile"
        | "note.template-conversion-pending"
        | "template.folder"
      >
    >
  >;
  update(patch: Partial<Settings>): void;
  flush(): Promise<void>;
  setDefaultLiteratureNoteProfileDocument(reference: string | null): void;
}

interface MigrationTemplateService {
  ready: Promise<void>;
  getLegacyLiteratureNoteTemplateFiles(): readonly string[];
  convertLegacyLiteratureNoteTemplates(data: {
    readonly note: object;
    readonly filename: object;
    readonly annotation?: object;
  }): Promise<Pick<ConvertedLegacyProfileDocument, "source" | "legacyFiles">>;
}

interface MigrationApp {
  vault: Pick<Vault, "getFileByPath" | "create">;
  fileManager: Pick<FileManager, "trashFile">;
  workspace: Pick<Workspace, "onLayoutReady">;
}

export interface LiteratureNoteTemplateMigrationOptions {
  app: MigrationApp;
  settings: MigrationSettings;
  template: MigrationTemplateService;
  loadVerificationData: (options: { annotation: boolean }) => Promise<{
    readonly note: object;
    readonly filename: object;
    readonly annotation: object | null;
  } | null>;
  openPrompt: () => void | Promise<void>;
}

export interface LiteratureNoteTemplateMigrationDataDeps {
  app: Parameters<typeof loadTemplateData>[0]["app"];
  db: DatabaseService;
  libraryScope: Pick<LibraryScopeService, "ready" | "resolveWith">;
  noteIndex: NoteIndex;
  settings: SettingsService;
  templates: TemplateService;
  zoteroPref: ZoteroPrefService;
}

/** Load one real in-scope Zotero item through the Workbench's inert render seam. */
export async function loadLiteratureNoteTemplateMigrationData(
  deps: LiteratureNoteTemplateMigrationDataDeps,
  options: { annotation: boolean },
): Promise<{
  note: object;
  filename: object;
  annotation: object | null;
} | null> {
  await deps.libraryScope.ready;
  using lease = await deps.db.acquireRead();
  const scope = deps.libraryScope.resolveWith(lease.client);
  const indexedKeys: string[] = [];
  for (const library of scope.available) {
    for (const itemID of getIndexedItemIDsByLibrary(
      lease.client,
      library.libraryID,
    )) {
      const indexedKey = getItemDisplayRefByID(
        lease.client,
        itemID,
      )?.indexedKey;
      if (indexedKey) indexedKeys.push(indexedKey);
    }
  }

  const dataDeps = {
    app: deps.app,
    db: deps.db,
    noteIndex: deps.noteIndex,
    settings: deps.settings,
    templates: deps.templates,
    zoteroPref: deps.zoteroPref,
  };
  let verificationBase:
    | { note: object; filename: object; annotation: null }
    | undefined;
  for (const indexedKey of indexedKeys) {
    const [note, filename] = await Promise.all([
      loadTemplateData(dataDeps, indexedKey, "note"),
      loadTemplateData(dataDeps, indexedKey, "filename"),
    ]);
    if (note.kind !== "data" || filename.kind !== "data") continue;
    if (!options.annotation) {
      return { note: note.data, filename: filename.data, annotation: null };
    }
    verificationBase ??= {
      note: note.data,
      filename: filename.data,
      annotation: null,
    };
    const annotationKey = firstAnnotationIndexedKey(note.data);
    if (!annotationKey) continue;
    const annotation = await loadTemplateData(
      dataDeps,
      annotationKey,
      "annotation",
    );
    if (annotation.kind !== "data") continue;
    return {
      note: note.data,
      filename: filename.data,
      annotation: annotation.data,
    };
  }
  return verificationBase ?? null;
}

function firstAnnotationIndexedKey(data: object): string | undefined {
  if (!("annotations" in data) || !Array.isArray(data.annotations)) {
    return undefined;
  }
  for (const annotation of data.annotations) {
    if (
      annotation !== null &&
      typeof annotation === "object" &&
      "indexedKey" in annotation &&
      typeof annotation.indexedKey === "string"
    ) {
      return annotation.indexedKey;
    }
  }
  return undefined;
}

export type LiteratureNoteTemplateMigrationDiagnostic =
  | {
      code: "legacy-render-mismatch" | "unsupported-legacy-template";
      message: string;
      difference: string;
      hint: string;
    }
  | {
      code:
        | "no-verification-item"
        | "no-verification-annotation"
        | "converted-document-exists"
        | "no-legacy-templates";
      message: string;
      hint: string;
    };

export type LiteratureNoteTemplateMigrationResult =
  | {
      outcome: "converted";
      document: string;
      trashed: readonly string[];
    }
  | {
      outcome: "refused";
      diagnostic: LiteratureNoteTemplateMigrationDiagnostic;
    };

/** Owns the user-consented, one-shot transition from slot files to one document. */
export class LiteratureNoteTemplateMigrationService extends Service<void> {
  readonly #app;
  readonly #settings;
  readonly #template;
  readonly #loadVerificationData;
  readonly #openPrompt;
  #stopped = false;

  ready: Promise<void>;

  constructor(options: LiteratureNoteTemplateMigrationOptions) {
    super();
    this.#app = options.app;
    this.#settings = options.settings;
    this.#template = options.template;
    this.#loadVerificationData = options.loadVerificationData;
    this.#openPrompt = options.openPrompt;
    this.ready = this.#load();
  }

  async convert(): Promise<LiteratureNoteTemplateMigrationResult> {
    await this.ready;
    const settings = await this.#settings.loaded;
    const legacyFiles = this.#template.getLegacyLiteratureNoteTemplateFiles();
    if (legacyFiles.length === 0) {
      return refused(
        "no-legacy-templates",
        "No legacy Literature Note Template files were found",
        "Keep using the built-in Literature Note Template.",
      );
    }

    const targetPath = join(
      settings["template.folder"],
      CONVERTED_DEFAULT_PROFILE_DOCUMENT,
    );
    if (this.#app.vault.getFileByPath(targetPath)) {
      return refused(
        "converted-document-exists",
        `Converted document already exists at ${targetPath}`,
        "Rename or remove that document, then retry conversion.",
      );
    }

    const foldsAnnotation = legacyFiles.some(
      (path) => templateFileFromPath(path)?.name === "annotation",
    );
    const data = await this.#loadVerificationData({
      annotation: foldsAnnotation,
    });
    if (!data) {
      return refused(
        "no-verification-item",
        "No Zotero item is available for conversion verification",
        "Connect a Zotero database that contains an item, then retry conversion.",
      );
    }
    if (foldsAnnotation && !data.annotation) {
      return refused(
        "no-verification-annotation",
        "No Zotero annotation is available for conversion verification",
        "Add an annotation to a Zotero item, then retry conversion.",
      );
    }

    let converted;
    try {
      converted = await this.#template.convertLegacyLiteratureNoteTemplates({
        note: data.note,
        filename: data.filename,
        ...(data.annotation ? { annotation: data.annotation } : {}),
      });
    } catch (error) {
      if (error instanceof LegacyTemplateConversionError) {
        return {
          outcome: "refused",
          diagnostic: {
            code: error.code,
            difference: error.difference,
            message: error.message,
            hint: error.recovery,
          },
        };
      }
      throw error;
    }

    await this.#app.vault.create(targetPath, converted.source);
    this.#settings.setDefaultLiteratureNoteProfileDocument(
      CONVERTED_DEFAULT_PROFILE_DOCUMENT,
    );
    this.#settings.update({ "note.template-conversion-pending": false });
    await this.#settings.flush();

    const trashed: string[] = [];
    for (const path of converted.legacyFiles) {
      const file = this.#app.vault.getFileByPath(path);
      if (!file) continue;
      await this.#app.fileManager.trashFile(file);
      trashed.push(path);
    }
    logger.info("Converted legacy Literature Note Templates", {
      document: targetPath,
      trashed,
    });
    return {
      outcome: "converted",
      document: CONVERTED_DEFAULT_PROFILE_DOCUMENT,
      trashed,
    };
  }

  async #load(): Promise<void> {
    const [settings] = await Promise.all([
      this.#settings.loaded,
      this.#template.ready,
    ]);
    await using stack = new AsyncDisposableStack();
    stack.defer(() => {
      this.#stopped = true;
    });

    const legacyFiles = this.#template.getLegacyLiteratureNoteTemplateFiles();
    const converted = settings["note.default-profile"].document !== undefined;
    if (converted || legacyFiles.length === 0) {
      if (settings["note.template-conversion-pending"]) {
        this.#settings.update({ "note.template-conversion-pending": false });
        await this.#settings.flush();
      }
      this.commit(stack.move());
      return;
    }

    if (!settings["note.template-conversion-pending"]) {
      this.#settings.update({ "note.template-conversion-pending": true });
      await this.#settings.flush();
      this.#app.workspace.onLayoutReady(() => {
        if (!this.#stopped) void this.#openPrompt();
      });
    }
    this.commit(stack.move());
  }
}

function refused(
  code: Extract<
    LiteratureNoteTemplateMigrationDiagnostic["code"],
    | "no-verification-item"
    | "no-verification-annotation"
    | "converted-document-exists"
    | "no-legacy-templates"
  >,
  message: string,
  hint: string,
): LiteratureNoteTemplateMigrationResult {
  return { outcome: "refused", diagnostic: { code, message, hint } };
}
