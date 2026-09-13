import { join } from "node:path/posix";
import { TextFileView } from "obsidian";
import type { App } from "obsidian";

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
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";
import { loadTemplateData } from "@/services/template-workbench/data";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import { ConversionCopy, ConversionRepairError } from "./conversion-copy";
import type {
  ConversionCopyEditorScope,
  ConversionRepairReview,
} from "./conversion-copy";
import {
  citationPath,
  partialPath,
  templateFileFromPath,
  classifyTemplateFolderFile,
  inTemplateFolder,
} from "./defaults";
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
        | "note.template-conversion-copy"
        | "template.folder"
        | "note.frontmatter-fields"
        | "template.auto-trim-leading"
        | "template.auto-trim-trailing"
      >
    >
  >;
  update(patch: Partial<Settings>): void;
  updatePersisted(
    patch: Partial<Settings>,
    beforePublish?: () => void,
  ): Promise<void>;
  flush(): Promise<void>;
}

interface MigrationTemplateService {
  holdActivation(): Promise<AsyncDisposable>;
  prepareActivation(): Promise<() => void>;
  readonly javascriptTemplatesEnabled: boolean;
  refresh(): Promise<void>;
  waitUntilSettled(
    timeoutMs: number,
  ): Promise<"settled" | "timeout" | "init-failed">;
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

export interface LiteratureNoteTemplateMigrationOptions {
  app: App;
  settings: MigrationSettings;
  template: MigrationTemplateService;
  loadVerificationData: (options: {
    annotation: boolean;
  }) => Promise<MigrationVerificationData | null>;
  openPrompt: () => void | Promise<void>;
}

/** One real Zotero item, in every shape a conversion verifies against. */
export interface MigrationVerificationData {
  readonly itemKey?: string;
  readonly annotationKey?: string;
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
        itemKey: indexedKey,
        note: note.data,
        filename: filename.data,
        annotation: null,
        citation,
      };
    }
    verificationBase ??= {
      itemKey: indexedKey,
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
      itemKey: indexedKey,
      annotationKey,
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
        | "no-legacy-templates"
        | "originals-changed";
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
      documents: readonly string[];
      pendingCleanup: readonly string[];
      /** Legacy files left in place and reported: the Eta side of a
       *  mixed-language `cite` / `cite2` pair. */
      kept: readonly string[];
    }
  | {
      outcome: "refused";
      diagnostic: LiteratureNoteTemplateMigrationDiagnostic;
    };

/** The inactive review retains the original inputs even when synthesis refuses. */
export interface LiteratureNoteTemplateConversionReview {
  readonly inputs: readonly {
    readonly kind: "profile" | "citation" | "partial";
    readonly path: string;
    readonly source: string;
    readonly destination: string | null;
  }[];
  readonly kept: readonly string[];
  readonly fields: Settings["note.frontmatter-fields"];
  readonly annotation: boolean;
  readonly selected: {
    readonly item: string;
    readonly annotation: string | null;
    readonly citation: readonly string[];
  } | null;
  readonly preparation:
    | {
        readonly outcome: "prepared";
        readonly documents: readonly {
          readonly path: string;
          readonly source: string;
        }[];
      }
    | Extract<LiteratureNoteTemplateMigrationResult, { outcome: "refused" }>;
}

interface PreparedConversion {
  review: LiteratureNoteTemplateConversionReview;
  baseline: string;
  documents: { path: string; source: string }[];
  legacyFiles: string[];
  kept: readonly string[];
  profilePath: string | null;
}

/** Owns the user-consented, one-shot transition from slot files to one document. */
export class LiteratureNoteTemplateMigrationService extends Service<void> {
  readonly #app;
  readonly #settings;
  readonly #template;
  readonly #loadVerificationData;
  readonly #openPrompt;
  #stopped = false;
  #copy: ConversionCopy | undefined;
  #copyLoading: Promise<ConversionCopy> | undefined;
  #creatingCopy: Promise<ConversionCopy> | undefined;
  #repairReview:
    | { review: ConversionRepairReview; snapshot: string }
    | undefined;
  #prepared: PreparedConversion | undefined;
  #selected: LiteratureNoteTemplateConversionReview["selected"] = null;

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
    const settings = this.#settings.current ?? (await this.#settings.loaded);
    if (settings["note.template-conversion-result"]) return this.retryCleanup();
    const review = await this.prepare();
    if (review.preparation.outcome === "refused") return review.preparation;
    return this.activate(review);
  }

  /** Inspect and verify the candidate without changing active files or settings. */
  async prepare(): Promise<LiteratureNoteTemplateConversionReview> {
    await this.ready;
    this.#prepared = undefined;
    this.#selected = null;
    const settled = await this.#template.waitUntilSettled(5000);
    const inputs = await this.#captureInputs();
    const settings = await this.#settings.loaded;
    const fields = structuredClone(settings["note.frontmatter-fields"]);
    const baseline = await this.#baseline(inputs);
    const annotation = inputs.some(
      ({ path }) => templateFileFromPath(path)?.name === "annotation",
    );
    let prepared =
      settled === "settled"
        ? await this.#prepareDocuments()
        : refused(
            "originals-changed",
            "The template registry is still refreshing",
            "Review conversion again after the template files finish loading.",
          );
    if (baseline !== (await this.#baseline(await this.#captureInputs()))) {
      logger.debug("Invalidated conversion review", {
        phase: "preparation",
        reason: "originals-changed",
      });
      prepared = refused(
        "originals-changed",
        "The original template configuration changed",
        "Review conversion again before activating it.",
      );
    }
    const review: LiteratureNoteTemplateConversionReview = {
      inputs,
      kept: inputs
        .filter(({ destination }) => destination === null)
        .map(({ path }) => path),
      fields,
      annotation,
      selected: this.#selected,
      preparation:
        prepared.outcome === "refused"
          ? prepared
          : { outcome: "prepared", documents: prepared.documents },
    };
    if (prepared.outcome === "prepared")
      this.#prepared = { ...prepared, review, baseline };
    logger.debug("Prepared conversion review", {
      outcome: prepared.outcome,
      inputs: inputs.length,
      diagnostic:
        prepared.outcome === "refused" ? prepared.diagnostic.code : null,
    });
    return review;
  }

  /** Persist inactive sources before opening the copied field in the native editor. */
  startRepair(): Promise<ConversionCopy> {
    return (this.#creatingCopy ??= this.#createRepair().finally(() => {
      this.#creatingCopy = undefined;
    }));
  }

  async #createRepair(): Promise<ConversionCopy> {
    await this.ready;
    const existing = await this.resumeRepair();
    if (existing) return existing;
    const settings = {
      ...defaults,
      ...(this.#settings.current ?? (await this.#settings.loaded)),
    };
    if ((await this.#template.waitUntilSettled(5000)) !== "settled")
      throw new ConversionRepairError({ code: "copy-loading" });
    const data = await this.#loadVerificationData({
      annotation: this.#template
        .getLegacyLiteratureNoteTemplateFiles()
        .some((path) => templateFileFromPath(path)?.name === "annotation"),
    });
    const copy = await ConversionCopy.create(this.#app, {
      settings,
      javascript: this.#template.javascriptTemplatesEnabled,
      data,
    });
    try {
      this.#settings.update({ "note.template-conversion-copy": copy.path });
      await this.#settings.flush();
      this.#copy = copy;
      logger.debug("Saved inactive Conversion Copy", { path: copy.path });
      return copy;
    } catch (error) {
      this.#settings.update({ "note.template-conversion-copy": null });
      await copy.discard();
      throw error;
    }
  }

  async resumeRepair(): Promise<ConversionCopy | null> {
    await this.ready;
    if (this.#copy) return this.#copy;
    const settings = this.#settings.current ?? (await this.#settings.loaded);
    const path = settings["note.template-conversion-copy"];
    if (!path) return null;
    this.#copyLoading ??= ConversionCopy.resume(this.#app, path);
    try {
      this.#copy = await this.#copyLoading;
      logger.debug("Resumed inactive Conversion Copy", { path });
      return this.#copy;
    } finally {
      this.#copyLoading = undefined;
    }
  }

  /** Resolve before native file initialization, including restored workspace leaves. */
  async resolveCopyEditor(
    path: string,
  ): Promise<ConversionCopyEditorScope | null> {
    const copy = await this.resumeRepair();
    if (copy && inTemplateFolder(path, copy.editor.folder)) return copy.editor;
    if (copy && path.startsWith(`${copy.folder}/`))
      throw new Error(
        "This Conversion Copy input does not have an editor document yet",
      );
    return null;
  }

  async reviewRepair(): Promise<ConversionRepairReview> {
    const copy = await this.resumeRepair();
    if (!copy) throw new ConversionRepairError({ code: "copy-missing" });
    this.#repairReview = undefined;
    await this.#flushCopyEditors(copy.folder);
    const settings = {
      ...defaults,
      ...(this.#settings.current ?? (await this.#settings.loaded)),
    };
    if (
      !(await copy.originalsMatch(
        settings,
        this.#template.javascriptTemplatesEnabled,
      ))
    ) {
      return {
        copy: copy.path,
        comparisons: [],
        valid: false,
        requiresAcceptance: false,
        diagnostic: { code: "originals-changed" },
        documents: [],
      };
    }
    const data = await this.#loadVerificationData({
      annotation: copy.requiresAnnotation,
    });
    if (!data)
      return {
        copy: copy.path,
        comparisons: [],
        valid: false,
        requiresAcceptance: false,
        diagnostic: { code: "no-verification-item" },
        documents: [],
      };
    const snapshot = await copy.fingerprint();
    const review = await copy.review(data);
    if (
      snapshot !== (await copy.fingerprint()) ||
      !(await copy.originalsMatch(
        settings,
        this.#template.javascriptTemplatesEnabled,
      ))
    ) {
      return {
        ...review,
        valid: false,
        diagnostic: { code: "originals-changed" },
      };
    }
    this.#repairReview = { review, snapshot };
    logger.debug("Reviewed Conversion Copy", {
      valid: review.valid,
      changed: review.requiresAcceptance,
      comparisons: review.comparisons.length,
    });
    return review;
  }

  async acceptRepair(
    review: ConversionRepairReview,
    decision: "matching" | "reviewed-changes",
  ): Promise<LiteratureNoteTemplateMigrationResult> {
    const copy = await this.resumeRepair();
    const prepared = this.#repairReview;
    if (
      !copy ||
      !prepared ||
      prepared.review !== review ||
      !review.valid ||
      (review.requiresAcceptance && decision !== "reviewed-changes")
    ) {
      return refused(
        "originals-changed",
        "The Conversion Copy requires a valid explicit review",
        "Review the copied templates and accept the reviewed changes.",
      );
    }
    await this.#flushCopyEditors(copy.folder);
    const settings = {
      ...defaults,
      ...(this.#settings.current ?? (await this.#settings.loaded)),
    };
    if (
      prepared.snapshot !== (await copy.fingerprint()) ||
      !(await copy.originalsMatch(
        settings,
        this.#template.javascriptTemplatesEnabled,
      ))
    )
      return refused(
        "originals-changed",
        "The reviewed configuration changed",
        "Review conversion again before activating it.",
      );
    this.#repairReview = undefined;
    const result = await this.activateDocuments({
      documents: review.documents,
      legacyFiles: copy.legacyFiles,
      kept: copy.kept,
      profilePath: copy.profilePath
        ? join(settings["template.folder"], CONVERTED_DEFAULT_PROFILE_DOCUMENT)
        : null,
      acceptance: decision,
    });
    if (result.outcome === "converted") {
      // The acceptance is durable before copy disposal, so cleanup never reverses it.
      try {
        await this.discardRepair();
      } catch (error) {
        logger.warn("Accepted Conversion Copy still needs disposal", {
          path: copy.path,
          error,
        });
      }
    }
    return result;
  }

  /** Explicitly compare the saved repair with the current active originals. */
  async refreshRepairOriginals(): Promise<ConversionRepairReview> {
    const copy = await this.resumeRepair();
    if (!copy) throw new ConversionRepairError({ code: "copy-missing" });
    await this.#flushCopyEditors(copy.folder);
    for (const { leaf } of this.#copyEditors(copy.folder)) leaf.detach();
    const settings = {
      ...defaults,
      ...(this.#settings.current ?? (await this.#settings.loaded)),
    };
    const data = await this.#loadVerificationData({
      annotation:
        copy.requiresAnnotation ||
        this.#template
          .getLegacyLiteratureNoteTemplateFiles()
          .some((path) => templateFileFromPath(path)?.name === "annotation"),
    });
    const replacement = await copy.refreshOriginals(
      settings,
      this.#template.javascriptTemplatesEnabled,
      data,
    );
    try {
      await this.#settings.updatePersisted({
        "note.template-conversion-copy": replacement.path,
      });
    } catch (error) {
      await replacement.discard();
      throw error;
    }
    this.#copy = replacement;
    this.#repairReview = undefined;
    try {
      await copy.discard();
    } catch (error) {
      logger.warn("Previous Conversion Copy still needs disposal", {
        path: copy.path,
        error,
      });
    }
    return this.reviewRepair();
  }

  async discardRepair(): Promise<void> {
    const copy = await this.resumeRepair();
    if (!copy) return;
    for (const { leaf } of this.#copyEditors(copy.folder)) leaf.detach();
    await this.#settings.updatePersisted({
      "note.template-conversion-copy": null,
    });
    this.#copy = undefined;
    this.#repairReview = undefined;
    await copy.discard();
    logger.debug("Discarded inactive Conversion Copy", { path: copy.path });
  }

  #copyEditors(folder: string) {
    return this.#app.workspace
      .getLeavesOfType("zotlit-template-workbench")
      .flatMap((leaf) => {
        const view = leaf.view;
        return view instanceof TextFileView &&
          view.file?.path.startsWith(`${folder}/`)
          ? [{ leaf, view }]
          : [];
      });
  }

  async #flushCopyEditors(folder: string): Promise<void> {
    for (const { view } of this.#copyEditors(folder)) await view.save();
  }

  async #baseline(
    inputs: LiteratureNoteTemplateConversionReview["inputs"],
  ): Promise<string> {
    const settings = await this.#settings.loaded;
    const inventory = await Promise.all(
      this.#app.vault
        .getMarkdownFiles()
        .filter(({ path }) => {
          if (!inTemplateFolder(path, settings["template.folder"]))
            return false;
          const kind = classifyTemplateFolderFile(path)?.kind;
          return (
            kind === "legacy-slot" ||
            kind === "legacy-citation" ||
            kind === "legacy-partial"
          );
        })
        .toSorted((a, b) => a.path.localeCompare(b.path))
        .map(async (file) => ({
          path: file.path,
          source: await this.#app.vault.cachedRead(file),
        })),
    );
    return JSON.stringify({
      inventory,
      inputs,
      folder: settings["template.folder"],
      fields: settings["note.frontmatter-fields"],
      profile: settings["note.default-profile"],
      leading: settings["template.auto-trim-leading"],
      trailing: settings["template.auto-trim-trailing"],
      javascript: this.#template.javascriptTemplatesEnabled,
    });
  }

  async #captureInputs(): Promise<
    LiteratureNoteTemplateConversionReview["inputs"]
  > {
    const settings = await this.#settings.loaded;
    const folder = settings["template.folder"];
    const legacy = this.#template.getLegacyTemplateDocuments();
    const citationLanguage = legacy.citation.every(
      ({ language }) => language === "eta",
    )
      ? "eta"
      : "liquid";
    const sources = [
      ...this.#template.getLegacyLiteratureNoteTemplateFiles().map((path) => ({
        kind: "profile" as const,
        path,
        destination: join(folder, CONVERTED_DEFAULT_PROFILE_DOCUMENT),
      })),
      ...legacy.citation.flatMap((file) =>
        [file.path, ...file.shadowed].map((path) => ({
          kind: "citation" as const,
          path,
          destination:
            file.language === citationLanguage ? citationPath(folder) : null,
        })),
      ),
      ...legacy.partials.flatMap((file) =>
        [file.path, ...file.shadowed].map((path) => ({
          kind: "partial" as const,
          path,
          destination: partialPath(folder, file.name),
        })),
      ),
    ];
    return Promise.all(
      sources.map(async (input) => {
        const file = this.#app.vault.getFileByPath(input.path);
        return {
          ...input,
          source: file ? await this.#app.vault.cachedRead(file) : "",
        };
      }),
    );
  }

  async #prepareDocuments(): Promise<
    | ({ outcome: "prepared" } & Pick<
        PreparedConversion,
        "documents" | "legacyFiles" | "kept" | "profilePath"
      >)
    | Extract<LiteratureNoteTemplateMigrationResult, { outcome: "refused" }>
  > {
    await this.ready;
    const settings = this.#settings.current ?? (await this.#settings.loaded);
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
    this.#selected = data
      ? {
          item: verificationLabel(
            data.note,
            ["indexedKey", "title"],
            data.itemKey,
          ),
          annotation: data.annotation
            ? verificationLabel(
                data.annotation,
                ["indexedKey", "text"],
                data.annotationKey,
              )
            : null,
          citation: data.citation.map(({ citationKey }) => citationKey ?? "—"),
        }
      : null;
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
    return { outcome: "prepared", documents, legacyFiles, kept, profilePath };
  }

  /** Activate only the exact review held by this service, while its originals still match. */
  async activate(
    review: LiteratureNoteTemplateConversionReview,
  ): Promise<LiteratureNoteTemplateMigrationResult> {
    await this.ready;
    const prepared = this.#prepared;
    const inputs = await this.#captureInputs();
    if (
      !prepared ||
      prepared.review !== review ||
      prepared.baseline !== (await this.#baseline(inputs))
    ) {
      logger.debug("Invalidated conversion review", {
        phase: "activation",
        reason:
          !prepared || prepared.review !== review
            ? "review-not-current"
            : "originals-changed",
      });
      return refused(
        "originals-changed",
        "The original template configuration changed",
        "Review conversion again before activating it.",
      );
    }
    this.#prepared = undefined;
    return this.activateDocuments(prepared);
  }

  /** Commit the accepted document set before disposing of original sources. */
  async activateDocuments(options: {
    documents: readonly { path: string; source: string }[];
    legacyFiles: readonly string[];
    kept: readonly string[];
    profilePath: string | null;
    acceptance?: "matching" | "reviewed-changes";
  }): Promise<LiteratureNoteTemplateMigrationResult> {
    await this.ready;
    const { documents, legacyFiles, kept, profilePath } = options;
    const settings = this.#settings.current ?? (await this.#settings.loaded);
    const previousPending = settings["note.template-conversion-pending"];
    const previousResult = settings["note.template-conversion-result"];
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
    {
      await using _activation = await this.#template.holdActivation();
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
      try {
        const publishRegistry = await this.#template.prepareActivation();
        await this.#settings.updatePersisted(
          {
            "note.template-conversion-pending": false,
            "note.template-conversion-result": {
              document: profilePath,
              ...(options.acceptance ? { acceptance: options.acceptance } : {}),
              documents: documents.map(({ path }) => path),
              trashed: 0,
              trashedFiles: [],
              pendingCleanup: [...new Set(legacyFiles)].filter((path) =>
                this.#app.vault.getFileByPath(path),
              ),
              kept: [...kept],
            },
          },
          publishRegistry,
        );
      } catch (error) {
        this.#settings.update({
          "note.template-conversion-pending": previousPending,
          "note.template-conversion-result": previousResult,
        });
        await this.#rollback(created);
        try {
          await this.#settings.flush();
        } catch (restoreError) {
          logger.error("Failed to persist conversion rollback", {
            error: restoreError,
          });
        }
        throw error;
      }
    }
    logger.debug("Activated accepted template conversion", {
      documents: created,
      legacyFiles,
      kept,
    });
    return this.retryCleanup();
  }

  /** Retry only the accepted conversion's remaining trash operations. */
  async retryCleanup(): Promise<LiteratureNoteTemplateMigrationResult> {
    await this.ready;
    const settings = this.#settings.current ?? (await this.#settings.loaded);
    const accepted = settings["note.template-conversion-result"];
    if (!accepted) {
      return refused(
        "no-legacy-templates",
        "No accepted conversion was found",
        "Review conversion before cleaning up its source files.",
      );
    }
    const pendingCleanup: string[] = [];
    const trashedFiles = [...(accepted.trashedFiles ?? [])];
    for (const path of accepted.pendingCleanup ?? []) {
      try {
        const file = this.#app.vault.getFileByPath(path);
        if (file) await this.#app.fileManager.trashFile(file);
        if (!trashedFiles.includes(path)) trashedFiles.push(path);
      } catch (error) {
        pendingCleanup.push(path);
        logger.warn("Converted template source still needs cleanup", {
          path,
          error,
        });
      }
    }
    const result = {
      ...accepted,
      trashed: accepted.trashedFiles ? trashedFiles.length : accepted.trashed,
      trashedFiles,
      pendingCleanup,
    };
    this.#settings.update({ "note.template-conversion-result": result });
    try {
      await this.#settings.flush();
    } catch (error) {
      // The saved acceptance still lists every unfinished operation. Missing
      // files are successful cleanup on the next attempt, including restart.
      this.#settings.update({ "note.template-conversion-result": accepted });
      logger.warn("Converted template cleanup progress could not be saved", {
        error,
      });
      return convertedResult(accepted);
    }
    logger.debug("Finished accepted template cleanup", {
      documents: result.documents,
      trashedFiles,
      pendingCleanup,
      kept: result.kept,
    });
    return convertedResult(result);
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
    stack.defer(async () => {
      this.#stopped = true;
      await this.#copyLoading?.then(
        (copy) => copy[Symbol.asyncDispose](),
        () => {},
      );
      await this.#creatingCopy?.then(
        (copy) => copy[Symbol.asyncDispose](),
        () => {},
      );
      await this.#copy?.[Symbol.asyncDispose]();
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

function verificationLabel(
  data: object,
  keys: readonly string[],
  selectedKey?: string,
): string {
  const values = keys.flatMap((key) => {
    const value: unknown = Reflect.get(data, key);
    return typeof value === "string" && value.length > 0 ? [value] : [];
  });
  return (
    [...new Set([selectedKey, ...values].filter(Boolean))].join(": ") || "—"
  );
}

function refused(
  code: Extract<
    LiteratureNoteTemplateMigrationDiagnostic["code"],
    | "no-verification-item"
    | "no-verification-annotation"
    | "converted-document-exists"
    | "no-legacy-templates"
    | "originals-changed"
  >,
  message: string,
  hint: string,
): Extract<LiteratureNoteTemplateMigrationResult, { outcome: "refused" }> {
  return { outcome: "refused", diagnostic: { code, message, hint } };
}

/** Carry a failed verification out as the refusal the prompt reports. */
function refusedByConversion(
  error: LegacyTemplateConversionError,
): Extract<LiteratureNoteTemplateMigrationResult, { outcome: "refused" }> {
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

function convertedResult(
  result: NonNullable<Settings["note.template-conversion-result"]>,
): LiteratureNoteTemplateMigrationResult {
  return {
    outcome: "converted",
    document:
      result.document === null ? null : CONVERTED_DEFAULT_PROFILE_DOCUMENT,
    documents: result.documents ?? (result.document ? [result.document] : []),
    trashed: result.trashedFiles ?? [],
    pendingCleanup: result.pendingCleanup ?? [],
    kept: result.kept ?? [],
  };
}
