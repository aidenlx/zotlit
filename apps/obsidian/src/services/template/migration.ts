import { join } from "node:path/posix";
import type { FileManager, Vault, Workspace } from "obsidian";

import {
  getIndexedItemIDsByLibrary,
  getItemDisplayRefByID,
  getItemsByID,
} from "@zotlit/db";
import type { CiteRef } from "@zotlit/db";
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
import type {
  ConvertedLegacyProfileDocument,
  ConvertedLegacyTemplateDocuments,
  LegacyTemplateDocuments,
  TemplateService,
} from "./service";

const logger = getLogger(["template", "migration"]);

interface MigrationSettings {
  readonly current?: Awaited<MigrationSettings["loaded"]> | null;
  loaded: Promise<
    Readonly<
      Pick<
        Settings,
        | "note.default-profile"
        | "note.template-conversion-pending"
        | "note.template-conversion-result"
        | "template.folder"
      >
    >
  >;
  update(patch: Partial<Settings>): void;
  flush(): Promise<void>;
}

interface MigrationTemplateService {
  refresh(): Promise<void>;
  ready: Promise<void>;
  getLegacyLiteratureNoteTemplateFiles(): readonly string[];
  convertLegacyLiteratureNoteTemplates(data: {
    readonly note: object;
    readonly filename: object;
    readonly annotation?: object;
  }): Promise<Pick<ConvertedLegacyProfileDocument, "source" | "legacyFiles">>;
  getLegacyTemplateDocuments(): LegacyTemplateDocuments;
  convertLegacyTemplateDocuments(
    refs: readonly CiteRef[],
  ): Promise<ConvertedLegacyTemplateDocuments>;
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
  loadVerificationData: (options: {
    annotation: boolean;
  }) => Promise<MigrationVerificationData | null>;
  openPrompt: () => void | Promise<void>;
}

/** One real Zotero item, in every shape a conversion verifies against. */
export interface MigrationVerificationData {
  readonly note: object;
  readonly filename: object;
  readonly annotation: object | null;
  /** The one-item Citation both Citation Variants of the fold render. */
  readonly citation: readonly CiteRef[];
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
): Promise<MigrationVerificationData | null> {
  await deps.libraryScope.ready;
  using lease = await deps.db.acquireRead();
  const scope = deps.libraryScope.resolveWith(lease.client);
  const candidates: { indexedKey: string; itemID: number }[] = [];
  for (const library of scope.available) {
    for (const itemID of getIndexedItemIDsByLibrary(
      lease.client,
      library.libraryID,
    )) {
      const indexedKey = getItemDisplayRefByID(
        lease.client,
        itemID,
      )?.indexedKey;
      if (indexedKey) candidates.push({ indexedKey, itemID });
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
  let verificationBase: MigrationVerificationData | undefined;
  for (const { indexedKey, itemID } of candidates) {
    const [note, filename] = await Promise.all([
      loadTemplateData(dataDeps, indexedKey, "note"),
      loadTemplateData(dataDeps, indexedKey, "filename"),
    ]);
    if (note.kind !== "data" || filename.kind !== "data") continue;
    const citation = citationVerificationRefs(lease.client, itemID);
    if (!options.annotation) {
      return {
        note: note.data,
        filename: filename.data,
        annotation: null,
        citation,
      };
    }
    verificationBase ??= {
      note: note.data,
      filename: filename.data,
      annotation: null,
      citation,
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
      citation,
    };
  }
  return verificationBase ?? null;
}

/**
 * The one-item Citation the Citation Template fold verifies against: the same
 * ref shape the citation suggester inserts, so the fold is checked through the
 * data path a real insertion takes.
 */
function citationVerificationRefs(
  client: Parameters<typeof getItemsByID>[0],
  itemID: number,
): readonly CiteRef[] {
  const item = getItemsByID(client, [itemID])[0];
  if (!item) return [];
  const citationKey =
    "citationKey" in item.fields ? (item.fields.citationKey ?? null) : null;
  return [{ citationKey, item }];
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
      code: "legacy-frontmatter-inert" | "legacy-frontmatter-evaluation";
      message: string;
      difference: string;
      hint: string;
      fields: readonly string[];
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
      /** The converted Profile document, `null` when the vault held no
       *  Literature Note slots to fold into one. */
      document: string | null;
      trashed: readonly string[];
      /** Legacy files a failed trash left behind; retry from the Welcome view. */
      pendingCleanup: readonly string[];
      /** Legacy files left in place and reported: the Eta side of a
       *  mixed-language `cite` / `cite2` pair. */
      kept: readonly string[];
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
    const slotFiles = this.#template.getLegacyLiteratureNoteTemplateFiles();
    const legacy = this.#template.getLegacyTemplateDocuments();
    if (
      slotFiles.length === 0 &&
      legacy.citation.length === 0 &&
      legacy.partials.length === 0
    ) {
      return refused(
        "no-legacy-templates",
        "No legacy template files were found",
        "Keep using the built-in templates.",
      );
    }

    const profilePath =
      slotFiles.length > 0
        ? join(settings["template.folder"], CONVERTED_DEFAULT_PROFILE_DOCUMENT)
        : null;
    const foldsAnnotation = slotFiles.some(
      (path) => templateFileFromPath(path)?.name === "annotation",
    );
    const data = await this.#loadVerificationData({
      annotation: foldsAnnotation,
    });
    if (!data || (legacy.citation.length > 0 && data.citation.length === 0)) {
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

    // Every source is built and verified before the first write, so a refusal
    // anywhere below leaves the vault exactly as the user left it.
    let documents: { path: string; source: string }[];
    let legacyFiles: string[];
    let kept: readonly string[];
    try {
      const converted = await this.#template.convertLegacyTemplateDocuments(
        data.citation,
      );
      documents = [...converted.documents];
      legacyFiles = [...converted.trashed];
      kept = converted.kept;
      if (profilePath) {
        const profile =
          await this.#template.convertLegacyLiteratureNoteTemplates({
            note: data.note,
            filename: data.filename,
            ...(data.annotation ? { annotation: data.annotation } : {}),
          });
        documents.unshift({ path: profilePath, source: profile.source });
        legacyFiles.push(...profile.legacyFiles);
      }
    } catch (error) {
      if (error instanceof LegacyTemplateConversionError) {
        return refusedByConversion(error);
      }
      throw error;
    }

    const occupied = documents.find(({ path }) =>
      this.#app.vault.getFileByPath(path),
    );
    if (occupied) {
      return refused(
        "converted-document-exists",
        `Converted document already exists at ${occupied.path}`,
        "Rename or remove that document, then retry conversion.",
      );
    }

    const created: string[] = [];
    try {
      for (const { path, source } of documents) {
        await this.#app.vault.create(path, source);
        created.push(path);
      }
    } catch (error) {
      // A half-written pass would block its own retry: the documents already
      // created occupy the paths the next run refuses on, and one of them is
      // the Profile document that stands the prompt down. Undo them, so the
      // vault is again what the user handed the pass.
      await this.#rollback(created);
      throw error;
    }
    this.#settings.update({ "note.template-conversion-pending": false });
    await this.#settings.flush();

    const trashed: string[] = [];
    const pendingCleanup: string[] = [];
    for (const path of legacyFiles) {
      const file = this.#app.vault.getFileByPath(path);
      if (!file) continue;
      try {
        await this.#app.fileManager.trashFile(file);
        trashed.push(path);
      } catch (error) {
        // The accepted documents are already active. Keep this file in place
        // for a later retry rather than undo the conversion.
        pendingCleanup.push(path);
        logger.warn("Failed to move a legacy template file to trash", {
          error,
          path,
        });
      }
    }
    this.#settings.update({
      "note.template-conversion-result": {
        document: profilePath,
        trashed: trashed.length,
        pendingCleanup,
      },
    });
    await this.#settings.flush();
    logger.info("Converted legacy templates", {
      documents: documents.map(({ path }) => path),
      trashed,
      pendingCleanup,
      kept,
    });
    return {
      outcome: "converted",
      document:
        profilePath === null ? null : CONVERTED_DEFAULT_PROFILE_DOCUMENT,
      trashed,
      pendingCleanup,
      kept,
    };
  }

  /**
   * Trash the legacy files a previous conversion could not move, from the
   * recorded `pendingCleanup`. A file that still resists stays on the list.
   */
  async retryCleanup(): Promise<LiteratureNoteTemplateMigrationResult> {
    await this.ready;
    const settings = this.#settings.current ?? (await this.#settings.loaded);
    const accepted = settings["note.template-conversion-result"];
    if (!accepted) {
      return refused(
        "no-legacy-templates",
        "No completed conversion was found",
        "Convert the legacy templates before retrying cleanup.",
      );
    }
    const pendingCleanup: string[] = [];
    const trashed: string[] = [];
    let trashedCount = accepted.trashed;
    for (const path of accepted.pendingCleanup ?? []) {
      const file = this.#app.vault.getFileByPath(path);
      if (!file) continue;
      try {
        await this.#app.fileManager.trashFile(file);
        trashed.push(path);
        trashedCount += 1;
      } catch (error) {
        pendingCleanup.push(path);
        logger.warn("Failed to retry moving a legacy template file to trash", {
          error,
          path,
        });
      }
    }
    this.#settings.update({
      "note.template-conversion-result": {
        ...accepted,
        trashed: trashedCount,
        pendingCleanup,
      },
    });
    await this.#settings.flush();
    return {
      outcome: "converted",
      document:
        accepted.document === null ? null : CONVERTED_DEFAULT_PROFILE_DOCUMENT,
      trashed,
      pendingCleanup,
      kept: [],
    };
  }

  /** Trash the documents this pass created, newest first. A file that resists
   *  is logged rather than thrown: the original failure is the one to report. */
  async #rollback(paths: readonly string[]): Promise<void> {
    for (const path of paths.toReversed()) {
      const file = this.#app.vault.getFileByPath(path);
      if (!file) continue;
      try {
        await this.#app.fileManager.trashFile(file);
      } catch (error) {
        logger.error("Failed to roll back a converted document", {
          error,
          path,
        });
      }
    }
  }

  async #load(): Promise<void> {
    await Promise.all([this.#settings.loaded, this.#template.ready]);
    await using stack = new AsyncDisposableStack();
    stack.defer(() => {
      this.#stopped = true;
    });
    await this.#detectTemplates(false);
    this.commit(stack.move());
  }

  async #detectTemplates(layoutReady: boolean): Promise<void> {
    if (this.#stopped) return;
    const settings = this.#settings.current ?? (await this.#settings.loaded);
    const legacy = this.#template.getLegacyTemplateDocuments();
    const hasLegacyFiles =
      this.#template.getLegacyLiteratureNoteTemplateFiles().length > 0 ||
      legacy.citation.length > 0 ||
      legacy.partials.length > 0;
    // A recorded result keeps deliberately retained legacy files from arming
    // another invitation.
    const converted =
      settings["note.template-conversion-result"] !== null ||
      this.#app.vault.getFileByPath(
        join(settings["template.folder"], CONVERTED_DEFAULT_PROFILE_DOCUMENT),
      ) !== null;
    const detection = {
      phase: layoutReady ? "layout-ready" : "initial",
      foundLegacy: hasLegacyFiles,
    };
    if (!converted && !hasLegacyFiles && !layoutReady) {
      logger.debug("Template conversion detection", {
        ...detection,
        branch: "deferred",
      });
      // The first scan can precede Obsidian's vault inventory. Keep startup
      // finite and preserve a saved pending flag until the layout-ready scan.
      this.#app.workspace.onLayoutReady(async () => {
        if (this.#stopped) return;
        try {
          await this.#template.refresh();
          await this.#detectTemplates(true);
        } catch (error) {
          logger.warn("Deferred template conversion detection failed", {
            error,
          });
        }
      });
      return;
    }
    if (converted || !hasLegacyFiles) {
      logger.debug("Template conversion detection", {
        ...detection,
        branch: "converted-or-none",
        converted,
      });
      if (settings["note.template-conversion-pending"]) {
        this.#settings.update({ "note.template-conversion-pending": false });
        await this.#settings.flush();
      }
      return;
    }

    if (!settings["note.template-conversion-pending"]) {
      this.#settings.update({ "note.template-conversion-pending": true });
      await this.#settings.flush();
      logger.debug("Template conversion detection", {
        ...detection,
        branch: "newly-armed",
      });
      if (layoutReady) {
        if (!this.#stopped) await this.#openPrompt();
      } else {
        this.#app.workspace.onLayoutReady(() => {
          if (!this.#stopped) void this.#openPrompt();
        });
      }
    } else {
      logger.debug("Template conversion detection", {
        ...detection,
        branch: "already-answered",
      });
    }
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

/** Carry a failed verification out as the refusal the prompt reports. */
function refusedByConversion(
  error: LegacyTemplateConversionError,
): LiteratureNoteTemplateMigrationResult {
  const detail = {
    difference: error.difference,
    message: error.message,
    hint: error.recovery,
  };
  if (
    error.code === "legacy-frontmatter-inert" ||
    error.code === "legacy-frontmatter-evaluation"
  ) {
    return {
      outcome: "refused",
      diagnostic: { ...detail, code: error.code, fields: error.fields ?? [] },
    };
  }
  return { outcome: "refused", diagnostic: { ...detail, code: error.code } };
}
