import { dirname, join } from "node:path/posix";
import { TFile } from "obsidian";
import type { App, TAbstractFile } from "obsidian";

import { citekeysToCiteTemplateData } from "@zotlit/db";
import type {
  CitationTemplateData,
  CitationVariant,
  CiteRef,
} from "@zotlit/db";
import { inlineCitation } from "@zotlit/templates";
import type {
  AutoTrim,
  FrontmatterLanguage,
} from "@zotlit/templates/constants";
import {
  formatPlainTemplateDocument,
  LegacyTemplateConversionError,
  LiteratureNoteTemplateError,
  MissingTemplateError,
  parsePlainTemplateDocument,
  PlainTemplateDocumentError,
  TemplateError,
  TemplateFacade,
} from "@zotlit/templates/facade";
import type {
  ConvertedLegacyLiteratureNoteTemplate,
  LiteratureNoteTemplateDocument,
  LiteratureNoteTemplateErrorCode,
  LiteratureNoteTemplateManifest,
  RootVariableUse,
  TemplateLanguage,
} from "@zotlit/templates/facade";
import { evalFrontmatterFields } from "@zotlit/templates/frontmatter";
import type {
  CompiledFrontmatterField,
  CompiledManagedFrontmatter,
  FrontmatterField,
} from "@zotlit/templates/frontmatter";
import {
  exportLiteratureNotePack,
  LiteratureNotePackError,
  unpackLiteratureNotePartials,
} from "@zotlit/templates/literature-note-pack";
import type {
  LiteratureNotePartialUnpack,
  LiteratureNoteTemplatePartial,
} from "@zotlit/templates/literature-note-pack";
import {
  formatManagedRegion,
  managedRegionTransform,
} from "@zotlit/templates/obsidian";

import { RESERVED_KEYS } from "@/lib/constants";
import {
  Context,
  Deferred,
  Effect,
  Fiber,
  Layer,
  PubSub,
  Scope,
  Stream,
  SubscriptionRef,
} from "@/lib/effect";
import type { Cause } from "@/lib/effect";
import { withLogCategory } from "@/lib/effect-log";
import { obsidianEvents } from "@/lib/effect-obsidian-events";
import { changesUntil } from "@/lib/effect-stream";
import { ensureFolder } from "@/lib/ensure-folder";
import * as m from "@/lib/i18n/generated/messages";
import { processLiveText, readLiveText } from "@/lib/live-text";
import { ObsidianApp } from "@/lib/obsidian-app";
import type { UnknownProfileDiagnostic } from "@/lib/profile-stamp";
import { isFileExistsError } from "@/lib/vault-errors";
import type { ResolvedProfile } from "@/services/profile/bindings";
import type { Settings } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";

import {
  CITATION_TEMPLATE_NAME,
  CITATION_TEMPLATE_SOURCE,
  citationPath,
  classifyTemplateFolderFile,
  DEFAULT_TEMPLATES,
  isLegacyCitationName,
  isTemplateName,
  MANAGED_CONTENT_TEMPLATE,
  partialNameRefusal,
  partialPath,
  RESERVED_PARTIAL_NAMES,
  templatePath,
  TEMPLATE_NAMES,
} from "./defaults";
import type { TemplateName } from "./defaults";
import {
  engineFaultSpan,
  InertTemplateError,
  MissingPartialError,
  PartialNameError,
  TemplateOperationError,
  TemplateRenderError,
} from "./errors";
import type { EngineFaultSpan } from "./errors";
import { normalizeVaultPath } from "./path";

const FLUSH_DEBOUNCE_MS = 500;
/** Bounded wait for the reconciler after this service writes a document. */
const SETTLE_TIMEOUT_MS = 5_000;
const LEGACY_LITERATURE_NOTE_TEMPLATE_NAMES: ReadonlySet<TemplateName> =
  new Set(["filename", "note", "annotation", MANAGED_CONTENT_TEMPLATE]);

/** localStorage key for the per-device JavaScript Templates consent flag. */
const JS_TEMPLATES_STORAGE_KEY = "zotlit-javascript-templates";

/** The winner of a name with no vault file: its packaged Liquid default. */
const EMBEDDED_DEFAULT_WINNER = {
  language: "liquid",
  source: { kind: "embedded-default" },
} as const satisfies TemplateWinner;

interface TemplateEngineOptions {
  app: App;
  settings: { readonly current: Readonly<Settings> };
  changed: () => void;
  flushRequested: () => void;
  intakePending: () => number;
  schedule: (millis: number, task: () => void) => () => void;
  log: (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    fields?: Record<string, unknown>,
  ) => void;
}

/**
 * The template a name currently resolves to, as the reconciler computed it.
 * `source.kind: "none"` means no compiled template backs the name at all: its
 * `.eta.md` file would win, but the JavaScript Templates gate keeps it inert,
 * so {@link Template.render} raises {@link InertTemplateError} for it.
 */
export interface TemplateWinner {
  language: TemplateLanguage;
  source:
    | { kind: "vault"; path: string }
    | { kind: "embedded-default" }
    | { kind: "none" };
}

export interface TemplateFileStatus {
  name: TemplateName;
  winner: TemplateWinner;
  editablePath: string;
  shadowedFiles: readonly string[];
  inertFiles: readonly string[];
  compileError: string | null;
}

/** One reconciled Literature Note Template document in the template folder. */
export interface ResolvedLiteratureNoteTemplate {
  readonly reference: string;
  readonly path: string;
  readonly manifest: LiteratureNoteTemplateManifest;
  readonly frontmatter?: CompiledManagedFrontmatter;
  readonly hasManagedBlock: boolean;
  renderForCreate<T extends object>(data: T): string;
  renderForUpdate<T extends object>(data: T): string | null;
  renderAnnotation<T extends object>(data: T): string;
  renderFilename<T extends object>(data: T): string;
}

export type ProfileAnnotationDiagnostic =
  | UnknownProfileDiagnostic
  | {
      readonly code: "missing-literature-note-template";
      readonly document: string;
      readonly hint: string;
    };

/** A stamped Profile cannot supply the requested annotation presentation. */
export class ProfileAnnotationError extends Error {
  readonly _tag = "ProfileAnnotationError";
  readonly diagnostic: ProfileAnnotationDiagnostic;

  constructor(diagnostic: ProfileAnnotationDiagnostic) {
    super(
      diagnostic.code === "unknown-literature-note-profile"
        ? m.notice_literature_note_profile_unknown({
            stamp: diagnostic.stamp,
          })
        : m.notice_literature_note_template_missing({
            document: diagnostic.document,
          }),
    );
    this.name = "ProfileAnnotationError";
    this.diagnostic = diagnostic;
  }
}

/** Validation state for one Literature Note Template document in the folder. */
export interface LiteratureNoteTemplateStatus {
  readonly reference: string;
  readonly path: string;
  readonly validation:
    | {
        readonly state: "valid";
        readonly manifest: LiteratureNoteTemplateManifest;
        readonly hasManagedBlock: boolean;
      }
    | {
        readonly state: "invalid";
        readonly manifestId?: string;
        readonly error: {
          readonly code: LiteratureNoteTemplateErrorCode | "unknown";
          readonly message: string;
          readonly recovery: string;
          /** UTF-16 offset of the responsible text in the document. */
          readonly offset?: number;
          /** Path of the responsible manifest node. */
          readonly manifestPath?: readonly (string | number)[];
          readonly cause?: unknown;
        };
      };
}

export interface ConvertedLegacyProfileDocument extends ConvertedLegacyLiteratureNoteTemplate {
  readonly legacyFiles: readonly string[];
}

/** One 2.1.x Legacy Template File that folds into a plain Template Document. */
export interface LegacyTemplateFile {
  /** The bare 2.1.x name: `cite`, `cite2`, or the partial's own name. */
  readonly name: string;
  /** The `zotlit-<name>.(liquid|eta).md` file that owns the name. */
  readonly path: string;
  readonly language: TemplateLanguage;
  /** The JavaScript Templates gate leaves this Eta file uncompiled. */
  readonly inert: boolean;
  /** Editions that lose to {@link path}, trashed along with it. */
  readonly shadowed: readonly string[];
}

/** The Legacy Template Files the one-shot conversion still has to fold. */
export interface LegacyTemplateDocuments {
  /** `cite` before `cite2`, the order they fold in. */
  readonly citation: readonly LegacyTemplateFile[];
  /** Every bare partial file, by name. */
  readonly partials: readonly LegacyTemplateFile[];
}

/** The plain Template Documents {@link LegacyTemplateDocuments} converts into. */
export interface ConvertedLegacyTemplateDocuments {
  /** Documents to create, each already verified. */
  readonly documents: readonly {
    readonly path: string;
    readonly source: string;
  }[];
  /** Legacy files the documents replace, to move to trash. */
  readonly trashed: readonly string[];
  /** Legacy files no document claims, left in place and reported: the Eta
   *  side of a mixed-language `cite` / `cite2` pair. */
  readonly kept: readonly string[];
}

interface ReconciledLiteratureNoteTemplate {
  path: string;
  document: LiteratureNoteTemplateDocument;
}

/** One Shared Partial as its document parsed it, ready to bundle into a pack. */
interface RegisteredPartial {
  path: string;
  language: TemplateLanguage;
  source: string;
}

/** The Citation Template as it currently resolves; `path` is `null` while the
 *  built-in source stands in for a vault document. */
interface RegisteredCitationTemplate {
  path: string | null;
  language: TemplateLanguage;
  source: string;
}

/**
 * One Shared Partial as the agent CLI reports it: the document that owns the
 * name, and the language that document renders in.
 */
export interface SharedPartialDocument {
  readonly name: string;
  /** Where `zotlit-partial.<name>.md` lives. */
  readonly path: string;
  readonly language: TemplateLanguage;
}

/** What {@link Template.unpackPartials} did with each planned partial. */
export interface PartialUnpackOutcome {
  /** The names a Shared Partial document now holds the bundle's source under. */
  readonly written: readonly string[];
  /** The names the reader's own document answers, left exactly as they were. */
  readonly kept: readonly string[];
  /**
   * Every name whose transport copy has no reader left — written, already
   * identical, or answered by the reader's own document — so the caller drops
   * exactly those manifest entries. A name no Shared Partial file can carry
   * stays out: the manifest copy is all that answers it.
   */
  readonly dropped: readonly string[];
  /**
   * The names no Shared Partial file can be given, which reached no vault path
   * and keep their manifest entries. A caller that reports nothing for these
   * leaves Unpack partials looking inert, since the entry is still there to
   * report the next time the document is read.
   */
  readonly refused: readonly string[];
  /**
   * The names the template folder holds a file for under another case. One
   * file answers both spellings, while a call resolves by exact name, so these
   * keep their manifest entries — the copy that still answers the call.
   */
  readonly otherCase: readonly string[];
}

/** The Citation Template's state, as the Citations settings row reads it. */
export interface CitationTemplateStatus {
  /** Where `zotlit-citation.md` lives, whether or not the vault holds it. */
  readonly path: string;
  /** The vault holds the document; `false` means the built-in text renders. */
  readonly customized: boolean;
  readonly language: TemplateLanguage;
  /** The document's path while it is Eta and the JavaScript Templates gate
   *  keeps it inert, `null` otherwise. */
  readonly inertPath: string | null;
  readonly compileError: string | null;
}

/**
 * The reconciliation work one folder scan or one debounce window collected,
 * bucketed by the Template Document kind that reconciles each entry.
 */
interface TemplateWork {
  readonly names: Set<string>;
  readonly documentReferences: Set<string>;
  readonly partialNames: Set<string>;
  /** Holds {@link CITATION_TEMPLATE_NAME} while the one Citation Template
   *  awaits reconciliation; a set so it clears and counts with every other
   *  bucket. */
  readonly citation: Set<string>;
  readonly unrecognizedPaths: Set<string>;
}

function emptyTemplateWork(): TemplateWork {
  return {
    names: new Set(),
    documentReferences: new Set(),
    partialNames: new Set(),
    citation: new Set(),
    unrecognizedPaths: new Set(),
  };
}

/** Every bucket of `work`, so the whole set clears and counts as one. */
function templateWorkBuckets(work: TemplateWork): readonly Set<string>[] {
  return [
    work.names,
    work.documentReferences,
    work.partialNames,
    work.citation,
    work.unrecognizedPaths,
  ];
}

function isTemplateWorkEmpty(work: TemplateWork): boolean {
  return templateWorkBuckets(work).every((bucket) => bucket.size === 0);
}

/** Move everything `pending` holds into the work one flush reconciles. */
function takeTemplateWork(pending: TemplateWork): TemplateWork {
  const work: TemplateWork = {
    names: new Set(pending.names),
    documentReferences: new Set(pending.documentReferences),
    partialNames: new Set(pending.partialNames),
    citation: new Set(pending.citation),
    unrecognizedPaths: new Set(pending.unrecognizedPaths),
  };
  for (const bucket of templateWorkBuckets(pending)) bucket.clear();
  return work;
}

/**
 * Route one template-folder file into the bucket its Template Document kind
 * reconciles from — the one place a kind maps to its reconciliation.
 *
 * @returns whether `path` landed in a bucket. A file ZotLit ignores lands in
 *   none.
 */
function collectTemplatePath(work: TemplateWork, path: string): boolean {
  const classified = classifyTemplateFolderFile(path);
  switch (classified?.kind) {
    // A Legacy Template File keeps 2.1.x's registration by bare name until the
    // one-shot conversion trashes it, so a note template that calls a legacy
    // partial still resolves and the conversion reads one reconciled winner.
    case "legacy-slot":
    case "legacy-citation":
    case "legacy-partial":
      work.names.add(classified.name);
      return true;
    case "profile":
      work.documentReferences.add(classified.reference);
      return true;
    case "partial":
      work.partialNames.add(classified.name);
      return true;
    case "citation":
      work.citation.add(CITATION_TEMPLATE_NAME);
      return true;
    case "unrecognized":
      work.unrecognizedPaths.add(path);
      return true;
    default:
      return false;
  }
}

/**
 * The language the folded Citation Template is written in. Liquid wins a
 * mixed `cite` / `cite2` pair, the way it wins every other name, and the Eta
 * side stays in the vault.
 */
function foldCitationLanguage(
  files: readonly LegacyTemplateFile[],
): TemplateLanguage {
  return files.every((file) => file.language === "eta") ? "eta" : "liquid";
}

/** A recorded compile error: its message, the liquidjs caret-annotated
 *  source excerpt when the underlying error carried one, and the span the
 *  engine reported in the compiled source. */
export interface CompileError {
  message: string;
  context?: string;
  at?: EngineFaultSpan;
}

/** Managed-frontmatter field configuration and inert-key state, as
 *  {@link Template.getFrontmatterFieldStatus} reports it. */
export interface FrontmatterFieldStatus {
  /** Configured fields in `note.frontmatter-fields` order. */
  fields: readonly FrontmatterField[];
  /** Keys of `"javascript"` fields skipped because the gate is off. */
  inertKeys: readonly string[];
}

/** The liquidjs caret-annotated source excerpt on `error`, when it carries one. */
export function errorContext(error: unknown): string | undefined {
  return error !== null &&
    typeof error === "object" &&
    "context" in error &&
    typeof error.context === "string"
    ? error.context
    : undefined;
}

interface SettledWaiter {
  resolve: () => void;
}

/** Outcome of {@link Template.waitUntilSettled}. */
export type SettleOutcome = "settled" | "timeout" | "init-failed";

const wrapManagedContent = managedRegionTransform(MANAGED_CONTENT_TEMPLATE);

/** Rendering and vault-document operations; the Template layer owns its lifetime. */
class TemplateEngine {
  readonly #app;
  readonly #settings;
  readonly #facade = new TemplateFacade({
    // The built-in `content` renders inline; only a vault `content` template
    // keeps its Managed Region on create.
    transformRender: (name, output) =>
      this.#contentIsVaultBacked() ? wrapManagedContent(name, output) : output,
  });
  readonly #changed;
  readonly #schedule;
  readonly #log;
  readonly #flushRequested;
  readonly #intakePending;
  #closed = false;
  #initFailed = false;
  readonly #compileErrors = new Map<string, CompileError>();
  /** Exact bytes observed by reconciliation, including sources that fail parsing. */
  readonly #loadedDocumentSources = new Map<string, string>();
  /** Name → the winner {@link #reconcileName} last resolved it to, with the
   *  JavaScript Templates gate already applied. Read by
   *  {@link getTemplateFileStatuses}, so status reports the winner the
   *  reconciler computed instead of re-deriving one from the vault. */
  readonly #winners = new Map<string, TemplateWinner>();
  readonly #shadowed = new Map<string, string>();
  readonly #inertEta = new Map<string, string>();
  readonly #pending: TemplateWork = emptyTemplateWork();
  /** Partial name → the `zotlit-partial.<name>.md` document backing it. */
  readonly #partials = new Map<string, RegisteredPartial>();
  /** Partial name → the text of a document the JavaScript Templates gate left
   *  inert. Nothing renders it here; a Share still carries what the reader
   *  wrote, since the gate rules out running the text, not copying it. */
  readonly #inertPartials = new Map<string, LiteratureNoteTemplatePartial>();
  /** Every name the folder holds a `zotlit-partial.<name>.md` for, whether or
   *  not it compiled: the vault's namespace, which completion offers and the
   *  name rule checks a new name against. */
  readonly #partialNames = new Set<string>();
  /** Reserved name → the partial file claiming it, reported in settings. */
  readonly #reservedPartialFiles = new Map<string, string>();
  /** The Citation Template currently registered, `null` while none compiles. */
  #citation: RegisteredCitationTemplate | null = null;
  /** Vault paths of the `zotlit-` files no kind claims, reported in settings. */
  readonly #unrecognizedFiles = new Set<string>();
  readonly #literatureNoteDocuments = new Map<
    string,
    ReconciledLiteratureNoteTemplate
  >();
  readonly #literatureNoteDocumentErrors = new Map<string, Error>();
  readonly #settledWaiters = new Set<SettledWaiter>();

  #javascriptTemplatesEnabled: boolean;

  /** Compiled managed-frontmatter fields, memoized by the settings array
   *  reference (which changes only when the list is mutated). */
  #lastFrontmatterFields: readonly FrontmatterField[] | null = null;
  #compiledFrontmatterFields: readonly CompiledFrontmatterField[] = [];
  #inertFrontmatterKeys: readonly string[] = [];

  #flushTimer: (() => void) | null = null;
  #settlingTasks = 0;
  #folderGeneration = 0;
  #loaded = false;

  #lastTemplateFolder = "";
  #lastAutoTrim: [AutoTrim, AutoTrim] = [false, false];

  constructor(options: TemplateEngineOptions) {
    this.#changed = options.changed;
    this.#flushRequested = options.flushRequested;
    this.#intakePending = options.intakePending;
    this.#schedule = options.schedule;
    this.#log = options.log;
    this.#app = options.app;
    this.#settings = options.settings;
    this.#javascriptTemplatesEnabled =
      this.#app.loadLocalStorage(JS_TEMPLATES_STORAGE_KEY) === "1";
  }

  get compileErrors(): ReadonlyMap<string, CompileError> {
    return this.#compileErrors;
  }

  getLoadedDocumentSource(path: string): string | undefined {
    return this.#loadedDocumentSources.get(path);
  }

  /** Name → vault path of a shadowed `.eta.md` file whose Liquid edition currently wins. */
  get shadowedFiles(): ReadonlyMap<string, string> {
    return this.#shadowed;
  }

  /** Name → vault path of an `.eta.md` template file that is inert because the JavaScript Templates gate is off. */
  get inertEtaFiles(): ReadonlyMap<string, string> {
    return this.#inertEta;
  }

  /** Per-device consent flag gating all Eta compilation; see {@link setJavascriptTemplatesEnabled}. */
  get javascriptTemplatesEnabled(): boolean {
    return this.#javascriptTemplatesEnabled;
  }

  /** Whether the layer completed the initial template scan successfully. */
  get loaded(): boolean {
    return this.#loaded;
  }

  /**
   * Vault paths of the `zotlit-` prefixed Markdown files in the template
   * folder that answer to no Template Document kind, sorted, so the setting
   * tab can name each one. A file without the prefix is ignored and absent.
   */
  getUnrecognizedFiles(): readonly string[] {
    this.#requireLoaded("getUnrecognizedFiles");
    return [...this.#unrecognizedFiles].sort();
  }

  /**
   * The Legacy Template File slots and how each currently resolves — empty
   * once conversion has run: a converted vault keeps its note sources in
   * Profile documents and its citation text in the Citation Template, so no
   * slot remains.
   */
  getTemplateFileStatuses(): readonly TemplateFileStatus[] {
    this.#requireLoaded("getTemplateFileStatuses");
    return this.#settings.current?.["note.template-conversion-pending"]
      ? this.#getTemplateFileStatuses(TEMPLATE_NAMES)
      : [];
  }

  /**
   * How the Citation Template currently resolves: the vault's
   * `zotlit-citation.md`, or the built-in source that stands in for it.
   */
  getCitationTemplateStatus(): CitationTemplateStatus {
    this.#requireLoaded("getCitationTemplateStatus");
    const path = citationPath(this.#currentTemplateFolder());
    const inertPath = this.#inertEta.get(CITATION_TEMPLATE_NAME) ?? null;
    return {
      path,
      customized: this.#app.vault.getFileByPath(path) !== null,
      language: this.#citation?.language ?? "liquid",
      inertPath,
      compileError:
        this.#compileErrors.get(CITATION_TEMPLATE_NAME)?.message ?? null,
    };
  }

  /**
   * The Citation Template document, created from the built-in source when the
   * vault holds none, so a first edit starts from the text ZotLit renders.
   *
   * The layer completes the initial folder scan before this operation is available.
   */
  async materializeCitationTemplate(): Promise<TFile> {
    this.#requireLoaded("materializeCitationTemplate");
    const path = citationPath(this.#currentTemplateFolder());
    const existing = this.#app.vault.getFileByPath(path);
    if (existing) return existing;
    await ensureFolder(this.#app, this.#currentTemplateFolder() || "/");
    const file = await this.#app.vault.create(path, CITATION_TEMPLATE_SOURCE);
    await this.#settle();
    return file;
  }

  /**
   * Move the Citation Template document to Obsidian's recoverable trash, so
   * the built-in citation text renders again and a bad edit is undoable.
   */
  async restoreCitationTemplate(): Promise<void> {
    this.#requireLoaded("restoreCitationTemplate");
    const file = this.#app.vault.getFileByPath(
      citationPath(this.#currentTemplateFolder()),
    );
    if (!file) return;
    await this.#app.fileManager.trashFile(file);
    await this.#settle();
  }

  #getTemplateFileStatuses(
    names: readonly TemplateName[],
  ): readonly TemplateFileStatus[] {
    const folder = this.#currentTemplateFolder();

    return names.map((name) => {
      const liquidPath = templatePath(folder, name, "liquid");
      // Every canonical name is written while a folder rebuild walks it; the
      // fallback covers a read taken inside that walk, before the name's own
      // reconcile resolved.
      const winner = this.#winners.get(name) ?? EMBEDDED_DEFAULT_WINNER;

      const shadowed = this.#shadowed.get(name);
      const inert = this.#inertEta.get(name);
      return {
        name,
        winner,
        editablePath:
          winner.source.kind === "vault" ? winner.source.path : liquidPath,
        shadowedFiles: shadowed ? [shadowed] : [],
        inertFiles: inert ? [inert] : [],
        compileError: this.#compileErrors.get(name)?.message ?? null,
      };
    });
  }

  /** Resolve one document filename from the configured template folder. */
  getLiteratureNoteTemplate(
    reference: string,
  ): ResolvedLiteratureNoteTemplate | undefined {
    this.#requireLoaded("getLiteratureNoteTemplate");
    const error = this.#literatureNoteDocumentErrors.get(reference);
    if (error) throw error;
    const entry = this.#literatureNoteDocuments.get(reference);
    if (!entry) return undefined;
    return this.#resolveLiteratureDocument(entry, reference);
  }

  /** Compile a draft against the installed partials without installing or writing it. */
  prepareLiteratureNoteTemplateSource(
    source: string,
  ): ResolvedLiteratureNoteTemplate {
    this.#requireLoaded("prepareLiteratureNoteTemplateSource");
    const document = this.#facade.parseLiteratureNoteTemplate(source);
    return this.#resolveLiteratureDocument(
      { document, path: "source override" },
      "source override",
    );
  }

  #resolveLiteratureDocument(
    entry: ReconciledLiteratureNoteTemplate,
    reference: string,
  ): ResolvedLiteratureNoteTemplate {
    const { document, path } = entry;
    if (
      (document.manifest.language === "eta" ||
        document.manifest.partials?.some(
          (partial) => partial.language === "eta",
        )) &&
      !this.#javascriptTemplatesEnabled
    ) {
      throw new InertTemplateError(m.settings_template_inert_eta({ path }));
    }
    const facade = document.manifest.partials
      ? new TemplateFacade({
          transformRender: managedRegionTransform(MANAGED_CONTENT_TEMPLATE),
        })
      : this.#facade;
    for (const partial of document.manifest.partials ?? [])
      facade.define(partial.name, partial.source, partial.language);
    const frontmatter = document.manifest.frontmatter
      ? facade.compileManagedFrontmatterEntries(document.manifest.frontmatter, {
          javascript: this.#javascriptTemplatesEnabled,
        })
      : undefined;
    return {
      reference,
      path,
      manifest: document.manifest,
      frontmatter,
      hasManagedBlock: document.managedBlock !== null,
      renderForCreate: <T extends object>(data: T) =>
        this.#classifyRender(
          () => facade.renderLiteratureNoteTemplateForCreate(document, data),
          path,
        ),
      renderForUpdate: <T extends object>(data: T) =>
        this.#classifyRender(
          () => facade.renderLiteratureNoteTemplateForUpdate(document, data),
          path,
        ),
      renderAnnotation: <T extends object>(data: T) =>
        this.#classifyRender(
          () => facade.renderLiteratureNoteTemplateAnnotation(document, data),
          path,
        ),
      renderFilename: <T extends object>(data: T) =>
        toSingleLine(
          this.#classifyRender(
            () => facade.renderLiteratureNoteTemplateFilename(document, data),
            path,
          ),
        ),
    };
  }

  /**
   * Run one render and name the artifact any failure belongs to, so a Shared
   * Partial the JavaScript Templates gate left inert reports the localized
   * inert notice instead of the facade's bare "not found". Every render path
   * — {@link render} and every Profile document render — passes through here.
   *
   * @param documentPath - the document being rendered, when one is: a call to
   *   a partial the vault holds no document for is re-raised as a
   *   {@link MissingPartialError} naming it, which is where the refusal
   *   notice's Open template workbench action goes.
   */
  #classifyRender<T>(render: () => T, documentPath?: string): T {
    try {
      return render();
    } catch (error) {
      const failure = classifyRenderFailure(
        error,
        this.#compileErrors,
        this.#inertEta,
      );
      throw documentPath !== undefined &&
        failure instanceof MissingTemplateError &&
        !(failure instanceof MissingPartialError)
        ? new MissingPartialError(documentPath, failure.templateName, error)
        : failure;
    }
  }

  /** Render one annotation through its Profile document or legacy slot. */
  renderProfileAnnotation<T extends object>(
    data: T,
    options: { profile: ResolvedProfile },
  ): string {
    const { profile } = options;
    if (profile.settings["note.template-conversion-pending"]) {
      return this.render("annotation", data);
    }

    if (profile.document) {
      const document = this.getLiteratureNoteTemplate(profile.document);
      if (!document) {
        throw new ProfileAnnotationError({
          code: "missing-literature-note-template",
          document: profile.document,
          hint: "Restore the document in the template folder or clear the Profile document reference.",
        });
      }
      return document.renderAnnotation(data);
    }
    this.#requireLoaded("renderProfileAnnotation");
    return this.#facade.render("annotation", data, {
      source: DEFAULT_TEMPLATES.annotation,
      language: "liquid",
    });
  }

  /** Report every installed document and its reconciled validation state. */
  getLiteratureNoteTemplateStatuses(): readonly LiteratureNoteTemplateStatus[] {
    this.#requireLoaded("getLiteratureNoteTemplateStatuses");
    const references = new Set([
      ...this.#literatureNoteDocuments.keys(),
      ...this.#literatureNoteDocumentErrors.keys(),
    ]);
    return [...references].sort().map((reference) => {
      const entry = this.#literatureNoteDocuments.get(reference);
      if (entry) {
        return {
          reference,
          path: entry.path,
          validation: {
            state: "valid",
            manifest: entry.document.manifest,
            hasManagedBlock: entry.document.managedBlock !== null,
          },
        };
      }
      const error = this.#literatureNoteDocumentErrors.get(reference)!;
      const path = join(this.#currentTemplateFolder(), reference);
      return {
        reference,
        path,
        validation: {
          state: "invalid",
          ...(error instanceof LiteratureNoteTemplateError &&
          error.manifestId !== undefined
            ? { manifestId: error.manifestId }
            : {}),
          error:
            error instanceof LiteratureNoteTemplateError
              ? {
                  code: error.code,
                  message: error.message,
                  recovery: error.recovery,
                  ...(error.offset === undefined
                    ? {}
                    : { offset: error.offset }),
                  ...(error.manifestPath === undefined
                    ? {}
                    : { manifestPath: error.manifestPath }),
                  cause: error.cause,
                }
              : {
                  code: "unknown",
                  message: error.message,
                  recovery: "Correct the document, then inspect it again.",
                  cause: error.cause,
                },
        },
      };
    });
  }

  /** Parse and render document source in memory without installing it. */
  renderLiteratureNoteTemplateSource<T extends object>(
    source: string,
    data: T,
  ): { create: string; update: string | null } {
    const document = this.prepareLiteratureNoteTemplateSource(source);
    return {
      create: document.renderForCreate(data),
      update: document.renderForUpdate(data),
    };
  }

  /** Export one installed document with all reachable partials embedded. */
  async exportLiteratureNotePack(
    reference: string,
    options: { includeFolders?: boolean } = {},
  ): Promise<string> {
    this.#requireLoaded("exportLiteratureNotePack");
    const reconciled = this.#literatureNoteDocuments.get(reference);
    if (!reconciled) {
      throw new Error(
        `Literature Note Template '${reference}' is not installed`,
      );
    }
    const documentFile = this.#app.vault.getFileByPath(reconciled.path);
    if (!documentFile) {
      throw new Error(`Literature Note Template '${reference}' is unavailable`);
    }
    return this.exportLiteratureNotePackSource(
      await this.#app.vault.cachedRead(documentFile),
      options,
    );
  }

  /** Export a Profile snapshot, including a built-in Default that has no file. */
  async exportLiteratureNotePackSource(
    source: string,
    options: {
      includeFolders?: boolean;
      /** Extra partial names to bundle, reachable from the draft or not. */
      include?: readonly string[];
      /** Reports a name no partial answers instead of failing the export. */
      onMissingPartial?: (name: string) => void;
    } = {},
  ): Promise<string> {
    this.#requireLoaded("exportLiteratureNotePackSource");
    const partials = (
      await Promise.all(
        [...this.#winners.entries()].map(async ([name, winner]) => {
          if (winner.source.kind === "none") return null;
          if (winner.source.kind === "embedded-default") {
            if (!isTemplateName(name)) return null;
            return {
              name,
              language: winner.language,
              source: DEFAULT_TEMPLATES[name],
            } satisfies LiteratureNoteTemplatePartial;
          }
          const file = this.#app.vault.getFileByPath(winner.source.path);
          if (!file) return null;
          return {
            name,
            language: winner.language,
            source: await readLiveText(this.#app, file),
          } satisfies LiteratureNoteTemplatePartial;
        }),
      )
    ).filter((partial) => partial !== null);
    // A Shared Partial bundles the source its document holds, without the
    // manifest line that named the language — a document the JavaScript
    // Templates gate left inert among them, which is why this reads the same
    // set the Share sheet offers. The Citation Template joins them under its
    // own name, so a host that renders an annotation's citation — the web
    // Workbench — gets the text this vault would produce.
    partials.push(...this.getPartialEntries());
    if (this.#citation) {
      partials.push({
        name: CITATION_TEMPLATE_NAME,
        language: this.#citation.language,
        source: this.#citation.source,
      });
    }
    return exportLiteratureNotePack(source, partials, options);
  }

  /**
   * Rebuild the template folder from the vault's current inventory. The
   * startup scan can run before Obsidian has indexed every file, and files
   * indexed later arrive without `create` events, so a caller that waited for
   * layout-ready uses this to pick them up.
   */
  async refresh(): Promise<void> {
    await this.#rebuildFolder(this.#currentTemplateFolder());
    await this.#settle();
  }

  /**
   * Wait until every template edit **Obsidian has observed** before or during
   * this call has passed through the debounced compiler. The predicate reads
   * the intake backlog and compiler work. Obsidian owns observation: an edit
   * reaches the service through a vault event, so a write made outside Obsidian
   * settles only once Obsidian notices the file.
   *
   * @returns `"timeout"` when the bounded wait expires, `"init-failed"` when
   *   service startup itself failed, and `"settled"` otherwise.
   */
  async waitUntilSettled(timeoutMs: number): Promise<SettleOutcome> {
    if (timeoutMs <= 0) return "timeout";
    if (this.#initFailed) return "init-failed";
    if (this.#closed || this.#isSettled()) return "settled";
    return await new Promise<SettleOutcome>((resolve) => {
      const waiter = { resolve: () => finish("settled") };
      const finish = (outcome: SettleOutcome): void => {
        cancel();
        this.#settledWaiters.delete(waiter);
        resolve(outcome);
      };
      const cancel = this.#schedule(timeoutMs, () => finish("timeout"));
      this.#settledWaiters.add(waiter);
      this.#resolveSettledWaiters();
    });
  }

  /**
   * Managed-frontmatter fields compiled from `note.frontmatter-fields`,
   * recompiled on settings change. Consumed by the note feature when writing a
   * note's frontmatter; reserved system keys are already filtered out.
   *
   * @throws {@link InertTemplateError} when one or more `"javascript"`-language
   *   fields are inert because the JavaScript Templates gate is off (see
   *   {@link javascriptTemplatesEnabled}) — consuming a partial field set
   *   could half-apply a synced field configuration to a note.
   */
  get frontmatterFields(): readonly CompiledFrontmatterField[] {
    if (this.#inertFrontmatterKeys.length > 0) {
      throw new InertTemplateError(
        m.notice_frontmatter_js_inert({
          fields: this.#inertFrontmatterKeys.join(", "),
        }),
      );
    }
    return this.#compiledFrontmatterFields;
  }

  /**
   * Managed-frontmatter field configuration in configuration order, and which
   * keys are inert because the JavaScript Templates gate is off. Non-throwing
   * counterpart to {@link frontmatterFields}, for read-only inspection (the
   * Template Workbench's `frontmatter-status` command).
   */
  getFrontmatterFieldStatus(): FrontmatterFieldStatus {
    return {
      fields: this.#lastFrontmatterFields ?? [],
      inertKeys: this.#inertFrontmatterKeys,
    };
  }

  /**
   * Evaluate `fields` over `zt`, gate-aware: a `"javascript"` field is
   * skipped (never compiled) while the JavaScript Templates gate is off, its
   * key reported in `inertKeys` rather than `values`/`errors`. A field whose
   * evaluator throws is reported in `errors` rather than aborting the rest.
   * Non-throwing counterpart to the plugin's frontmatter write path, for the
   * Template Workbench's `frontmatter-eval` command.
   */
  evaluateFrontmatterFields(
    fields: readonly FrontmatterField[],
    zt: object,
  ): {
    values: Readonly<Record<string, unknown>>;
    errors: Readonly<Record<string, string>>;
    inertKeys: readonly string[];
  } {
    this.#requireLoaded("evaluateFrontmatterFields");
    const { compiled, inertKeys } = this.#facade.compileFrontmatterFields(
      fields,
      { javascript: this.#javascriptTemplatesEnabled },
    );
    const errors: Record<string, string> = {};
    const values = evalFrontmatterFields(compiled, zt, (key, error) => {
      errors[key] = error instanceof Error ? error.message : String(error);
    });
    return { values, errors, inertKeys };
  }

  /**
   * @throws {@link InertTemplateError} when `name`'s winning file is an
   *   `.eta.md` template left inert by the JavaScript Templates gate.
   * @throws when the named template has a recorded compile error; or `TemplateError`
   *   when the facade cannot resolve or render it — including an `include()` of
   *   a template that failed to compile (such a template is left undefined, so
   *   rendering never silently falls back to a default).
   */
  render<T extends object>(name: string, data: T): string {
    this.#requireLoaded("render");
    const inertPath = this.#inertEta.get(name);
    if (inertPath !== undefined) {
      throw new InertTemplateError(
        m.settings_template_inert_eta({ path: inertPath }),
        name,
      );
    }
    const compileError = this.#compileErrors.get(name);
    if (compileError !== undefined) {
      throw new TemplateError(
        compileErrorMessage(name, compileError.message),
        name,
      );
    }
    return this.#classifyRender(() => this.#facade.render(name, data));
  }

  /**
   * The `content` slot's output as a Managed Region: what an Update of a
   * documentless Literature Note writes into the region the note already has.
   */
  renderManagedContent<T extends object>(data: T): string {
    const output = this.render(MANAGED_CONTENT_TEMPLATE, data);
    return this.#contentIsVaultBacked() ? output : formatManagedRegion(output);
  }

  /** Whether a vault file backs the `content` slot; the facade wraps only that render. */
  #contentIsVaultBacked(): boolean {
    return this.#winners.get(MANAGED_CONTENT_TEMPLATE)?.source.kind === "vault";
  }

  /**
   * Render one in-text Citation through the Citation Template: `refs` become
   * `zt.citations` and `zt.items`, and `variant` names the gesture as
   * `zt.variant`. The output is normalized to its inline form, so a template
   * that spans lines still inserts one in-text token.
   *
   * @throws {@link InertTemplateError} when the Citation Template document is
   *   Eta and the JavaScript Templates gate is off.
   * @throws when the document has a compile error or fails to render.
   */
  renderCitation(refs: readonly CiteRef[], variant: CitationVariant): string {
    return this.renderCitationData(citekeysToCiteTemplateData(refs, variant));
  }

  /**
   * Render one in-text Citation from Citation Template data that is already
   * built — a built-in example set, or a set another leg assembled — and
   * normalize the output to its inline form.
   *
   * @throws {@link InertTemplateError} when the Citation Template document is
   *   Eta and the JavaScript Templates gate is off.
   * @throws when the document has a compile error or fails to render.
   */
  renderCitationData(data: CitationTemplateData): string {
    return inlineCitation(this.render(CITATION_TEMPLATE_NAME, data));
  }

  /**
   * The Shared Partial document `name` answers to, read off the folder scan: a
   * document the JavaScript Templates gate left inert or the parser refused
   * still owns the name, and still names the language its manifest declares.
   *
   * @returns null while the template folder holds no `zotlit-partial.<name>.md`.
   */
  getPartialDocument(name: string): SharedPartialDocument | null {
    this.#requireLoaded("getPartialDocument");
    const registered = this.#partials.get(name);
    if (registered)
      return { name, path: registered.path, language: registered.language };
    const path = partialPath(this.#currentTemplateFolder(), name);
    if (this.#inertEta.get(name) === path)
      return { name, path, language: "eta" };
    // A document the parser refused names no language, so it reads as the
    // Liquid default a manifest-less document declares.
    return this.#app.vault.getFileByPath(path) === null
      ? null
      : { name, path, language: "liquid" };
  }

  /**
   * Every Shared Partial the template folder holds a document for, sorted by
   * name — the vault's one flat namespace, which completion offers, the
   * settings list shows, and a new name is checked against. A document that
   * failed to compile keeps its name here: the file exists, so the name is
   * taken.
   */
  getPartialNames(): readonly string[] {
    this.#requireLoaded("getPartialNames");
    return [...this.#partialNames].sort();
  }

  /** {@link getPartialNames} as documents, for a caller that shows the file. */
  getPartialDocuments(): readonly SharedPartialDocument[] {
    return this.getPartialNames()
      .map((name) => this.getPartialDocument(name))
      .filter((document) => document !== null);
  }

  /**
   * {@link getPartialNames} as bundle entries — the name, the language, and
   * the source under the manifest — which is what a Share writes into a
   * Profile manifest's transport list.
   *
   * A document the JavaScript Templates gate left inert is carried all the
   * same: the gate rules out running the text on this device, not copying it,
   * and the recipient's own gate decides there. A document that failed to
   * parse has no source to separate from its manifest, so it is left out and
   * the Share sheet reports the name as one the bundle could not answer.
   */
  getPartialEntries(): readonly LiteratureNoteTemplatePartial[] {
    this.#requireLoaded("getPartialEntries");
    return this.getPartialNames().flatMap((name) => {
      const registered = this.#partials.get(name);
      if (registered)
        return [
          { name, language: registered.language, source: registered.source },
        ];
      const inert = this.#inertPartials.get(name);
      return inert ? [inert] : [];
    });
  }

  /**
   * What each partial a Profile manifest bundles does to the template folder,
   * read against the documents the vault holds right now.
   *
   * A name another Template already answers — `citation`, which the Citation
   * Template carries — reads as `unchanged`: this vault renders that name with
   * a document of its own, so no partial file is written for it and its
   * transport entry simply goes.
   *
   * A name the vault answers only under another case — a bundled `Authors`
   * against the vault's own `authors` — reads as `other-case`: one file
   * answers both on a case-insensitive filesystem, while a call resolves by
   * exact name, so the bundle keeps the copy that still answers `Authors`.
   *
   * A name the Shared Partial name rule refuses outright reads as `refused`,
   * so an import says which names stay in the profile rather than promising a
   * file the write then declines to make.
   *
   * @see unpackPartials for the write this plan feeds.
   */
  planPartialUnpack(
    bundled: readonly LiteratureNoteTemplatePartial[],
  ): readonly LiteratureNotePartialUnpack[] {
    this.#requireLoaded("planPartialUnpack");
    const held = new Map<
      string,
      Pick<LiteratureNoteTemplatePartial, "language" | "source"> | null
    >();
    const otherCase = new Set<string>();
    for (const partial of bundled) {
      if (RESERVED_PARTIAL_NAMES.has(partial.name)) {
        held.set(partial.name, partial);
        continue;
      }
      const name = this.#heldPartialName(partial.name);
      if (name !== partial.name) {
        if (name !== undefined) otherCase.add(partial.name);
        continue;
      }
      const registered = this.#partials.get(name);
      held.set(
        partial.name,
        registered
          ? { language: registered.language, source: registered.source }
          : null,
      );
    }
    const plan = unpackLiteratureNotePartials(
      bundled,
      held,
      // A name the vault answers under this very spelling is settled above, so
      // `taken` speaks for the case-folded ones alone.
      (name) => partialNameRefusal(name, this.#partialNames) === null,
    );
    // The name rule refuses a case-folded name only because the vault answers
    // it, which is a reason of its own. This plan says so once, and every
    // caller reads that one decision.
    return plan.map((step) =>
      otherCase.has(step.name)
        ? { ...step, verdict: "other-case" as const }
        : step,
    );
  }

  /**
   * Write the planned partials into the template folder, leaving every
   * document the vault already holds exactly as it is: a `conflict` the reader
   * did not name in `replace` keeps their file, and so does a file that
   * appeared between the plan and this write.
   *
   * Either way that name has no transport left — the reader's own document
   * answers it from now on — so it lands in `dropped` beside the ones written.
   * The names that stay out of `dropped` are the ones the manifest copy alone
   * answers: a `refused` name no Shared Partial file can carry, and an
   * `other-case` name the folder holds a file for under another case.
   */
  async unpackPartials(
    plan: readonly LiteratureNotePartialUnpack[],
    options: { replace?: readonly string[] } = {},
  ): Promise<PartialUnpackOutcome> {
    this.#requireLoaded("unpackPartials");
    const replace = new Set(options.replace);
    const folder = this.#currentTemplateFolder();
    const written: string[] = [];
    const kept: string[] = [];
    const refused: string[] = [];
    const otherCase: string[] = [];
    const dropped: string[] = [];
    for (const step of plan) {
      if (step.verdict === "unchanged") {
        dropped.push(step.name);
        continue;
      }
      // One file answers every spelling of a name, so writing here would land
      // in the reader's own document while the call keeps asking for a name
      // the registry has no exact key for.
      if (step.verdict === "other-case") {
        otherCase.push(step.name);
        continue;
      }
      // The name arrives inside a pasted bundle, so it passes the rule every
      // entry point shares before it ever reaches a vault path.
      if (partialNameRefusal(step.name, [])) {
        refused.push(step.name);
        continue;
      }
      const declined = step.verdict === "conflict" && !replace.has(step.name);
      if (!declined && (await this.#writePartialFile(folder, step)))
        written.push(step.name);
      else kept.push(step.name);
      dropped.push(step.name);
    }
    if (written.length > 0) await this.#settle();
    this.#log("debug", "Unpacked bundled partials", {
      written,
      kept,
      refused,
      otherCase,
    });
    return { written, kept, dropped, refused, otherCase };
  }

  /**
   * The name this vault's own Shared Partial files answer `name` under, folded
   * the way {@link partialNameRefusal} folds it; `undefined` when none does.
   */
  #heldPartialName(name: string): string | undefined {
    const folded = name.toLowerCase();
    return [...this.#partialNames].find(
      (taken) => taken.toLowerCase() === folded,
    );
  }

  /**
   * Write one planned partial into the document it belongs in. A `conflict`
   * reaches here only once the reader has approved that very name, so it is
   * the one step that replaces a document — every other write creates.
   *
   * @returns false when a document the plan never read holds the path, which
   *   is left exactly as the reader wrote it.
   */
  async #writePartialFile(
    folder: string,
    step: LiteratureNotePartialUnpack,
  ): Promise<boolean> {
    if (step.verdict === "conflict") {
      const held = this.#heldPartialName(step.name);
      const file =
        held === undefined
          ? null
          : this.#app.vault.getFileByPath(partialPath(folder, held));
      if (file) {
        await processLiveText(this.#app, file, () => step.document);
        return true;
      }
    }
    await ensureFolder(this.#app, folder || "/");
    try {
      await this.#app.vault.create(
        partialPath(folder, step.name),
        step.document,
      );
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
      this.#log("debug", "A partial document appeared after the unpack plan", {
        name: step.name,
      });
      return false;
    }
    return true;
  }

  /**
   * The partial files whose name already answers to another Template, keyed by
   * that name — nothing renders them, so settings names each one instead.
   */
  getReservedPartialFiles(): readonly { name: string; path: string }[] {
    this.#requireLoaded("getReservedPartialFiles");
    return [...this.#reservedPartialFiles]
      .map(([name, path]) => ({ name, path }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /**
   * Create `zotlit-partial.<name>.md` and wait for the reconciler to register
   * it, so the caller can open the document and render through it at once.
   *
   * The layer completes the initial folder scan before this operation is available.
   *
   * @param name a name the caller has already folded with
   *   `normalizePartialName`.
   * @throws {@link PartialNameError} when the name breaks the rule every entry
   *   point shares.
   */
  async createPartial(
    name: string,
    options: { source?: string; language?: TemplateLanguage } = {},
  ): Promise<TFile> {
    this.#requireLoaded("createPartial");
    const refusal = partialNameRefusal(name, this.#partialNames);
    if (refusal) throw new PartialNameError(name, refusal);
    const folder = this.#currentTemplateFolder();
    await ensureFolder(this.#app, folder || "/");
    const source = options.source ?? "";
    const file = await this.#app.vault.create(
      partialPath(folder, name),
      options.language === undefined
        ? source
        : formatPlainTemplateDocument(source, options.language),
    );
    await this.#settle();
    this.#log("debug", "Created a Shared Partial", { name, path: file.path });
    return file;
  }

  /**
   * Move a Shared Partial's document to Obsidian's recoverable trash. Every
   * template that still calls the name reports a missing partial from then on:
   * ZotLit rewrites no caller.
   */
  async deletePartial(name: string): Promise<void> {
    this.#requireLoaded("deletePartial");
    const file = this.#app.vault.getFileByPath(
      partialPath(this.#currentTemplateFolder(), name),
    );
    if (!file) return;
    await this.#app.fileManager.trashFile(file);
    await this.#settle();
  }

  /**
   * Render a draft Shared Partial — the unsaved bytes of
   * `zotlit-partial.<name>.md` — against the installed partials, without
   * registering the draft or writing it. This is what the Template Workbench
   * View previews while the reader types.
   *
   * @throws {@link InertTemplateError} when the draft names Eta and the
   *   JavaScript Templates gate is off.
   * @throws {@link PlainTemplateDocumentError} when the draft's manifest is
   *   malformed, and whatever the compile or the render itself raises.
   */
  renderPartialSource<T extends object>(
    source: string,
    data: T,
    options: { name: string },
  ): string {
    this.#requireLoaded("renderPartialSource");
    return this.#renderPlainSource(source, data, {
      name: options.name,
      path: partialPath(this.#currentTemplateFolder(), options.name),
    });
  }

  /**
   * Render one plain Template Document's draft bytes under the name the facade
   * registers that document by, without registering the draft or writing it.
   *
   * @param options.path - the document's own vault path, which the inert
   *   notice names; the draft may not be written there yet.
   */
  #renderPlainSource<T extends object>(
    source: string,
    data: T,
    options: { name: string; path: string },
  ): string {
    const parsed = parsePlainTemplateDocument(source);
    const { language } = parsed.manifest;
    if (language === "eta" && !this.#javascriptTemplatesEnabled) {
      throw new InertTemplateError(
        m.settings_template_inert_eta({ path: options.path }),
        options.name,
      );
    }
    return this.#classifyRender(() =>
      this.#facade.render(options.name, data, {
        source: parsed.source,
        language,
      }),
    );
  }

  /**
   * Render one in-text Citation through a draft Citation Template — the
   * unsaved bytes of `zotlit-citation.md` — against the installed partials,
   * without registering the draft or writing it. This is what the Template
   * Workbench View previews while the reader types.
   *
   * @throws {@link InertTemplateError} when the draft names Eta and the
   *   JavaScript Templates gate is off.
   * @throws {@link PlainTemplateDocumentError} when the draft's manifest is
   *   malformed, and whatever the compile or the render itself raises.
   */
  renderCitationSource(source: string, data: CitationTemplateData): string {
    this.#requireLoaded("renderCitationSource");
    return inlineCitation(
      this.#renderPlainSource(source, data, {
        name: CITATION_TEMPLATE_NAME,
        path: citationPath(this.#currentTemplateFolder()),
      }),
    );
  }

  /**
   * Render the `filename` Template and collapse the output to one trimmed
   * line: line breaks and their surrounding whitespace are removed, so
   * template-structural newlines never leak into the note name.
   *
   * @throws {@link InertTemplateError} when the `filename` winner is an
   *   `.eta.md` template left inert by the JavaScript Templates gate.
   * @throws when the template has a compile error or fails to render — note
   *   creation must fail loudly rather than silently misname files.
   */
  renderFilename<T extends object>(data: T): string {
    return toSingleLine(this.render("filename", data));
  }

  /**
   * Statically analyzes `name`'s own registered Liquid source and reports
   * every root-level variable read, including `zt` — callers filter. See
   * {@link TemplateFacade.analyzeRootVariables}.
   *
   * @returns `null` when `name` is unregistered or registered as Eta only.
   */
  analyzeRootVariables(name: string): RootVariableUse[] | null {
    this.#requireLoaded("analyzeRootVariables");
    return this.#facade.analyzeRootVariables(name);
  }

  /**
   * The raw source text behind `name`'s current winner.
   *
   * @returns the vault file's content when a vault file wins, or the
   *   packaged Liquid default body otherwise — the same body {@link render}
   *   would compile.
   */
  async getTemplateSource(name: TemplateName): Promise<string> {
    this.#requireLoaded("getTemplateSource");
    const winner = this.#winners.get(name) ?? EMBEDDED_DEFAULT_WINNER;
    if (winner.source.kind === "vault") {
      const file = this.#app.vault.getFileByPath(winner.source.path);
      if (file) return await this.#app.vault.cachedRead(file);
    }
    return DEFAULT_TEMPLATES[name];
  }

  /** Vault files that make the default Profile use legacy Literature Note slots. */
  getLegacyLiteratureNoteTemplateFiles(): readonly string[] {
    return this.#legacyLiteratureNoteSlots().flatMap(({ paths }) => paths);
  }

  /**
   * Each legacy Literature Note slot a vault file backs right now, with the
   * files behind it. A name with no file of its own stays out: its built-in
   * renders the slot before the conversion and after it alike.
   */
  #legacyLiteratureNoteSlots(): {
    name: TemplateName;
    paths: string[];
  }[] {
    return this.#getTemplateFileStatuses(TEMPLATE_NAMES)
      .filter((status) =>
        LEGACY_LITERATURE_NOTE_TEMPLATE_NAMES.has(status.name),
      )
      .map((status) => ({
        name: status.name,
        paths: [
          ...(status.winner.source.kind === "vault"
            ? [status.winner.source.path]
            : []),
          ...status.shadowedFiles,
          ...status.inertFiles,
        ],
      }))
      .filter(({ paths }) => paths.length > 0);
  }

  /**
   * The vault's remaining 2.1.x Legacy Template Files that convert into plain
   * Template Documents: the `cite` and `cite2` citation slots, and every bare
   * `zotlit-<name>.(liquid|eta).md` partial.
   */
  getLegacyTemplateDocuments(): LegacyTemplateDocuments {
    this.#requireLoaded("getLegacyTemplateDocuments");
    const citation: LegacyTemplateFile[] = [];
    const partials: LegacyTemplateFile[] = [];
    // Sorted, so `cite` folds before `cite2` and both lists read stably.
    for (const name of [...this.#winners.keys()].sort()) {
      if (isTemplateName(name)) continue;
      const file = this.#legacyTemplateFile(name);
      if (!file) continue;
      (isLegacyCitationName(name) ? citation : partials).push(file);
    }
    return { citation, partials };
  }

  /**
   * Build and verify, in memory, the plain Template Documents the vault's
   * remaining Legacy Template Files convert into: one Citation Template
   * folding `cite` and `cite2`, and one `zotlit-partial.<name>.md` per bare
   * partial. Nothing is written — the caller persists the returned documents
   * only once every verification passed.
   *
   * The fold is verified against the registry the whole one-shot pass leaves
   * behind, which retires the legacy Literature Note slots as well as the
   * citation slots: those slot files fold into the default Profile document
   * and reach the trash in this same pass, so each name a vault file backs
   * today renders its built-in from there on.
   *
   * @param refs the citation the fold verifies both Citation Variants
   *   against, from one real Zotero item.
   * @throws {@link LegacyTemplateConversionError} when a variant's output
   *   differs from the legacy file it replaces, or when the fold is Eta while
   *   the JavaScript Templates gate is off.
   */
  async convertLegacyTemplateDocuments(
    refs: readonly CiteRef[],
  ): Promise<ConvertedLegacyTemplateDocuments> {
    this.#requireLoaded("convertLegacyTemplateDocuments");
    const folder = this.#currentTemplateFolder();
    const { citation, partials } = this.getLegacyTemplateDocuments();
    const documents: { path: string; source: string }[] = [];
    const trashed: string[] = [];
    const kept: string[] = [];

    if (citation.length > 0) {
      const language = foldCitationLanguage(citation);
      if (language === "eta" && !this.#javascriptTemplatesEnabled) {
        throw new LegacyTemplateConversionError(
          "unsupported-legacy-template",
          "The legacy citation templates are Eta while JavaScript Templates are disabled",
          {
            difference: "inert template",
            recovery:
              "Enable JavaScript Templates on this device, then retry conversion.",
          },
        );
      }
      const legacy: {
        language: TemplateLanguage;
        main?: string;
        alt?: string;
      } = { language };
      // Every bare name the pass unregisters with the files it trashes: the
      // citation slots folded below, and the Literature Note slots the same
      // pass folds into the default Profile document. The fold is verified
      // against the registry that remains, so a branch that renders one of
      // them is refused rather than written.
      const removedNames: string[] = this.#legacyLiteratureNoteSlots().map(
        ({ name }) => name,
      );
      for (const file of citation) {
        if (file.language !== language) {
          kept.push(file.path);
          continue;
        }
        legacy[file.name === "cite" ? "main" : "alt"] =
          await this.#readLegacyTemplateFile(file.path);
        trashed.push(file.path, ...file.shadowed);
        removedNames.push(file.name);
      }
      const { source } = this.#facade.convertLegacyCitationTemplates(
        legacy,
        {
          main: citekeysToCiteTemplateData(refs, "main"),
          alt: citekeysToCiteTemplateData(refs, "alt"),
        },
        { removedNames },
      );
      documents.push({
        path: citationPath(folder),
        source: formatPlainTemplateDocument(source, language),
      });
    }

    for (const file of partials) {
      documents.push({
        path: partialPath(folder, file.name),
        source: formatPlainTemplateDocument(
          await this.#readLegacyTemplateFile(file.path),
          file.language,
        ),
      });
      trashed.push(file.path, ...file.shadowed);
    }
    this.#log("debug", "Planned the legacy Template Document conversion", {
      documents: documents.map(({ path }) => path),
      trashed,
      kept,
    });
    return { documents, trashed, kept };
  }

  /** The reconciled state of one bare legacy name, `null` when no file backs it. */
  #legacyTemplateFile(name: string): LegacyTemplateFile | null {
    const winner = this.#winners.get(name);
    if (!winner) return null;
    const shadowed = this.#shadowed.get(name);
    if (winner.source.kind === "vault") {
      return {
        name,
        path: winner.source.path,
        language: winner.language,
        inert: false,
        shadowed: shadowed ? [shadowed] : [],
      };
    }
    const inertPath = this.#inertEta.get(name);
    if (!inertPath) return null;
    return {
      name,
      path: inertPath,
      language: "eta",
      inert: true,
      shadowed: shadowed ? [shadowed] : [],
    };
  }

  async #readLegacyTemplateFile(path: string): Promise<string> {
    const file = this.#app.vault.getFileByPath(path);
    if (!file) {
      throw new LegacyTemplateConversionError(
        "unsupported-legacy-template",
        `Legacy template file '${path}' is no longer in the vault`,
        {
          difference: "missing legacy file",
          recovery: "Reload the template folder, then retry conversion.",
        },
      );
    }
    return await this.#app.vault.cachedRead(file);
  }

  /** Build and byte-verify the converted default Profile document in memory. */
  async convertLegacyLiteratureNoteTemplates(data: {
    readonly note: object;
    readonly filename: object;
    readonly annotation?: object;
  }): Promise<ConvertedLegacyProfileDocument> {
    this.#requireLoaded("convertLegacyLiteratureNoteTemplates");
    const statuses = this.#getTemplateFileStatuses(TEMPLATE_NAMES);
    const inert = statuses.find(
      (status) =>
        LEGACY_LITERATURE_NOTE_TEMPLATE_NAMES.has(status.name) &&
        status.winner.source.kind === "none" &&
        status.inertFiles.length > 0,
    );
    if (inert) {
      throw new LegacyTemplateConversionError(
        "unsupported-legacy-template",
        `Legacy template '${inert.name}' is inert while JavaScript Templates are disabled`,
        {
          difference: "inert template",
          recovery:
            "Enable JavaScript Templates on this device, then retry conversion.",
        },
      );
    }
    const source = async (
      name: "filename" | "note" | "content" | "annotation",
    ) => {
      const status = statuses.find((candidate) => candidate.name === name)!;
      return {
        source: await this.getTemplateSource(name),
        language: status.winner.language,
      };
    };
    const [note, content, filename] = await Promise.all([
      source("note"),
      source("content"),
      source("filename"),
    ]);
    const annotationStatus = statuses.find(
      (candidate) => candidate.name === "annotation",
    )!;
    const annotation =
      annotationStatus.winner.source.kind === "vault"
        ? await source("annotation")
        : undefined;
    return {
      ...this.#facade.convertLegacyLiteratureNoteTemplates(
        { note, content, filename, annotation },
        data,
        {
          frontmatter:
            this.#settings.current?.["note.frontmatter-fields"] ?? [],
          javascript: this.#javascriptTemplatesEnabled,
          managed: this.#contentIsVaultBacked(),
        },
      ),
      legacyFiles: this.getLegacyLiteratureNoteTemplateFiles(),
    };
  }

  /**
   * Compile-check a single Managed Frontmatter expression for the setting tab.
   * A javascript expression is left unvalidated while the gate is off —
   * validating it would compile it, and the gate-off invariant forbids any
   * dynamic code compilation.
   * @returns `null` when `expr` compiles, or the error message when it does not.
   */
  validateFrontmatterExpr(
    expr: string,
    language: FrontmatterLanguage,
  ): string | null {
    if (language === "javascript" && !this.#javascriptTemplatesEnabled) {
      return null;
    }
    return this.#facade.validateFrontmatterExpr(expr, language);
  }

  /**
   * Flip the per-device JavaScript Templates gate and rebuild the current
   * template folder so the change takes effect live, without a reload. The
   * setting tab is the only caller — the flag is never read from or written
   * to synced plugin settings.
   */
  async setJavascriptTemplatesEnabled(enabled: boolean): Promise<void> {
    this.#requireLoaded("setJavascriptTemplatesEnabled");
    if (enabled === this.#javascriptTemplatesEnabled) return;

    this.#app.saveLocalStorage(JS_TEMPLATES_STORAGE_KEY, enabled ? "1" : null);
    this.#javascriptTemplatesEnabled = enabled;
    this.#log("info", "JavaScript templates flag changed", { enabled });

    if (this.#lastFrontmatterFields) {
      this.#compileFrontmatter(this.#lastFrontmatterFields);
    }

    await this.#rebuildFolder(this.#currentTemplateFolder());
  }

  async load(): Promise<void> {
    const snapshot = this.#settings.current;
    this.#lastTemplateFolder = normalizeVaultPath(snapshot["template.folder"]);
    this.#lastAutoTrim = [
      snapshot["template.auto-trim-leading"],
      snapshot["template.auto-trim-trailing"],
    ];
    this.#facade.setAutoTrim(this.#lastAutoTrim);
    this.#compileFrontmatter(snapshot["note.frontmatter-fields"]);
    await this.#rebuildFolder(this.#lastTemplateFolder);
    this.#loaded = true;
  }

  failStartup(): void {
    this.#initFailed = true;
  }

  close(): void {
    this.#closed = true;
    this.#folderGeneration += 1;
    this.#cancelFlush();
    for (const bucket of templateWorkBuckets(this.#pending)) bucket.clear();
    for (const waiter of this.#settledWaiters) waiter.resolve();
    this.#settledWaiters.clear();
  }

  async onSettingsChanged(settings: Readonly<Settings>): Promise<void> {
    if (this.#closed) return;
    const folder = normalizeVaultPath(settings["template.folder"]);
    const autoTrim: [AutoTrim, AutoTrim] = [
      settings["template.auto-trim-leading"],
      settings["template.auto-trim-trailing"],
    ];

    const folderChanged = folder !== this.#lastTemplateFolder;
    const autoTrimChanged =
      autoTrim[0] !== this.#lastAutoTrim[0] ||
      autoTrim[1] !== this.#lastAutoTrim[1];

    const frontmatterFields = settings["note.frontmatter-fields"];

    this.#lastTemplateFolder = folder;
    this.#lastAutoTrim = autoTrim;

    if (frontmatterFields !== this.#lastFrontmatterFields) {
      this.#compileFrontmatter(frontmatterFields);
    }

    if (autoTrimChanged) {
      this.#facade.setAutoTrim(autoTrim);
      this.#log("debug", "Template autoTrim changed", { autoTrim });
    }

    if (folderChanged) {
      await this.#rebuildFolder(folder);
    }
  }

  async #rebuildFolder(folder: string): Promise<void> {
    this.#settlingTasks += 1;
    try {
      const generation = ++this.#folderGeneration;
      this.#cancelFlush();
      for (const bucket of templateWorkBuckets(this.#pending)) bucket.clear();
      this.#shadowed.clear();
      this.#inertEta.clear();
      this.#winners.clear();
      this.#partials.clear();
      this.#inertPartials.clear();
      this.#partialNames.clear();
      this.#reservedPartialFiles.clear();
      this.#citation = null;
      this.#unrecognizedFiles.clear();
      this.#facade.reset();
      this.#compileErrors.clear();
      this.#literatureNoteDocuments.clear();
      this.#literatureNoteDocumentErrors.clear();
      this.#loadedDocumentSources.clear();

      const root =
        folder === ""
          ? this.#app.vault.getRoot()
          : this.#app.vault.getFolderByPath(folder);

      const work = emptyTemplateWork();
      if (root) {
        for (const child of root.children) {
          if (child instanceof TFile) collectTemplatePath(work, child.path);
        }
      } else {
        this.#log(
          "debug",
          "Template folder not found; embedded defaults remain",
          {
            folder,
          },
        );
      }

      for (const name of TEMPLATE_NAMES) {
        if (!work.names.has(name)) this.#useDefault(name);
      }
      // Reconciled on every rebuild, file or none: with no document the
      // built-in source registers, so `citation` always resolves to something.
      work.citation.add(CITATION_TEMPLATE_NAME);

      await this.#reconcileWork(work, generation);
      if (generation !== this.#folderGeneration) return;

      this.#changed();
      this.#log("debug", "Template folder rebuilt", {
        folder,
        count: work.names.size,
      });
    } finally {
      this.#settlingTasks -= 1;
      this.#resolveSettledWaiters();
    }
  }

  onCreateOrModify(file: TAbstractFile): void {
    if (!(file instanceof TFile)) return;
    this.#queueTemplatePath(file.path);
  }

  onRename(file: TAbstractFile, oldPathRaw: string): void {
    this.#queueTemplatePath(oldPathRaw);
    if (file instanceof TFile) this.#queueTemplatePath(file.path);
  }

  onDelete(file: TAbstractFile): void {
    this.#queueTemplatePath(file.path);
  }

  /** Queue one vault event's path; a watched file is a direct child of the
   *  configured template folder (no recursion). */
  #queueTemplatePath(path: string): void {
    const normalized = normalizeVaultPath(path);
    if (
      normalizeVaultPath(dirname(normalized)) !== this.#currentTemplateFolder()
    ) {
      return;
    }
    if (!collectTemplatePath(this.#pending, normalized)) return;
    this.#scheduleFlush();
  }

  #scheduleFlush(): void {
    if (this.#closed || this.#flushTimer !== null) return;
    this.#flushTimer = this.#schedule(FLUSH_DEBOUNCE_MS, () => {
      this.#flushTimer = null;
      this.#flushRequested();
    });
  }

  async flushPending(): Promise<void> {
    this.#settlingTasks += 1;
    try {
      const generation = this.#folderGeneration;
      const work = takeTemplateWork(this.#pending);
      await this.#reconcileWork(work, generation);

      if (generation !== this.#folderGeneration) return;

      this.#changed();
      this.#log("debug", "Template flush completed", {
        count: work.names.size,
      });
    } finally {
      this.#settlingTasks -= 1;
      this.#resolveSettledWaiters();
    }
  }

  /**
   * Reconcile every bucket of `work`: a `zotlit-` file no kind claims is
   * reported or dropped by whether it still exists, and each remaining kind
   * reconciles through its own routine.
   */
  async #reconcileWork(work: TemplateWork, generation: number): Promise<void> {
    for (const path of work.unrecognizedPaths) {
      if (this.#app.vault.getFileByPath(path)) {
        this.#unrecognizedFiles.add(path);
      } else {
        this.#unrecognizedFiles.delete(path);
      }
    }
    await Promise.all([
      ...[...work.names].map((name) => this.#reconcileName(name, generation)),
      ...[...work.documentReferences].map((reference) =>
        this.#reconcileDocument(reference, generation),
      ),
      ...[...work.partialNames].map((name) =>
        this.#reconcilePartial(name, generation),
      ),
      ...(work.citation.size > 0 ? [this.#reconcileCitation(generation)] : []),
    ]);
  }

  /**
   * Resolve `name` from its two candidate files — `.liquid.md` wins over
   * `.eta.md` when both exist, and only the winner stays registered on the
   * facade. Called for every watcher event (debounced) and for each name
   * found while rebuilding the folder.
   */
  async #reconcileName(name: string, generation: number): Promise<void> {
    // Folder changes rebuild the full template set; stale reconciles from the
    // old folder must not redefine or drop templates loaded by a newer rebuild.
    if (generation !== this.#folderGeneration) return;

    const folder = this.#currentTemplateFolder();
    const liquidFile = this.#app.vault.getFileByPath(
      templatePath(folder, name, "liquid"),
    );
    const etaFile = this.#app.vault.getFileByPath(
      templatePath(folder, name, "eta"),
    );

    // One bare name, two file forms: the 2.1.x Legacy Template File and the
    // `zotlit-partial.<name>.md` document that replaces it. The document owns
    // the name — the conversion writes it before it trashes the legacy file,
    // so the deletion event that follows leaves the registered partial alone.
    if (this.#partials.has(name)) {
      if (!liquidFile && !etaFile) {
        this.#winners.delete(name);
        this.#shadowed.delete(name);
      }
      return;
    }

    // A shadowed eta file is reported as shadowed regardless of the gate —
    // the liquid edition wins either way, so the flag never changes its fate.
    if (liquidFile && etaFile) {
      if (this.#shadowed.get(name) !== etaFile.path) {
        this.#log("warn", "Eta template shadowed by its Liquid edition", {
          name,
          path: etaFile.path,
        });
      }
      this.#shadowed.set(name, etaFile.path);
    } else {
      this.#shadowed.delete(name);
    }

    // Inert means the eta file would win, but the gate keeps it from compiling.
    // Such a name is left with no compiled template at all: render/renderFilename
    // must fail loudly with InertTemplateError rather than degrade to the
    // embedded default.
    if (!this.#javascriptTemplatesEnabled && !liquidFile && etaFile) {
      if (this.#inertEta.get(name) !== etaFile.path) {
        this.#log(
          "info",
          "Eta template inert while JavaScript templates are disabled",
          { name, path: etaFile.path },
        );
      }
      this.#inertEta.set(name, etaFile.path);
      this.#winners.set(name, {
        language: "eta",
        source: { kind: "none" },
      });
      this.#compileErrors.delete(name);
      this.#facade.remove(name, "liquid");
      this.#facade.remove(name, "eta");
      return;
    }
    this.#inertEta.delete(name);

    const etaCandidate = this.#javascriptTemplatesEnabled ? etaFile : null;
    const winner = liquidFile
      ? ({ file: liquidFile, language: "liquid" } as const)
      : etaCandidate
        ? ({ file: etaCandidate, language: "eta" } as const)
        : null;

    if (!winner) {
      this.#compileErrors.delete(name);
      this.#useDefault(name);
      return;
    }

    let content: string;
    try {
      content = await this.#app.vault.cachedRead(winner.file);
    } catch (error) {
      if (generation !== this.#folderGeneration) return;
      this.#log("warn", "Failed to read template file", {
        error,
        path: winner.file.path,
      });
      this.#useDefault(name);
      return;
    }

    if (generation !== this.#folderGeneration) return;
    this.#facade.remove(name, winner.language === "liquid" ? "eta" : "liquid");
    this.#defineTemplate(name, content, winner.language);
    this.#winners.set(name, {
      language: winner.language,
      source: { kind: "vault", path: winner.file.path },
    });
  }

  async #reconcileDocument(
    reference: string,
    generation: number,
  ): Promise<void> {
    if (generation !== this.#folderGeneration) return;
    const folder = this.#currentTemplateFolder();
    const path = folder === "" ? reference : join(folder, reference);
    const file = this.#app.vault.getFileByPath(path);
    if (!file) {
      this.#literatureNoteDocuments.delete(reference);
      this.#literatureNoteDocumentErrors.delete(reference);
      this.#loadedDocumentSources.delete(path);
      return;
    }

    let source: string | undefined;
    try {
      source = await this.#app.vault.cachedRead(file);
      if (generation !== this.#folderGeneration) return;
      this.#loadedDocumentSources.set(path, source);
      const document = this.#facade.parseLiteratureNoteTemplate(source);
      this.#literatureNoteDocuments.set(reference, { path, document });
      this.#literatureNoteDocumentErrors.delete(reference);
    } catch (error) {
      if (generation !== this.#folderGeneration) return;
      const failure = Error.isError(error) ? error : new Error(String(error));
      if (source === undefined) this.#loadedDocumentSources.delete(path);
      this.#literatureNoteDocuments.delete(reference);
      this.#literatureNoteDocumentErrors.set(reference, failure);
      this.#log(
        "warn",
        "Failed to reconcile Literature Note Template document",
        {
          error: failure,
          path,
        },
      );
    }
  }

  /**
   * Register the Shared Partial `name` from its `zotlit-partial.<name>.md`
   * document, which carries the partial's language and its source.
   *
   * A partial whose document fails to parse or to compile is left undefined
   * and records a compile error, and one written in Eta while the JavaScript
   * Templates gate is off is left inert — a template that calls it then fails
   * loudly rather than rendering a hole.
   */
  async #reconcilePartial(name: string, generation: number): Promise<void> {
    if (generation !== this.#folderGeneration) return;

    const path = partialPath(this.#currentTemplateFolder(), name);
    const file = this.#app.vault.getFileByPath(path);

    // A reserved name already answers to another Template, so the file owns
    // nothing: it is reported by name in settings rather than registered.
    if (RESERVED_PARTIAL_NAMES.has(name)) {
      if (file) {
        this.#log("debug", "Partial file claims a reserved template name", {
          name,
          path,
        });
        this.#reservedPartialFiles.set(name, path);
        try {
          const source = await this.#app.vault.cachedRead(file);
          if (generation !== this.#folderGeneration) return;
          this.#loadedDocumentSources.set(path, source);
        } catch (error) {
          if (generation !== this.#folderGeneration) return;
          this.#loadedDocumentSources.delete(path);
          this.#log("warn", "Failed to read reserved partial file", {
            error,
            path,
          });
        }
      } else {
        this.#reservedPartialFiles.delete(name);
        this.#loadedDocumentSources.delete(path);
      }
      return;
    }

    if (!file) {
      this.#partialNames.delete(name);
      this.#loadedDocumentSources.delete(path);
      this.#removePartial(name);
      return;
    }
    this.#partialNames.add(name);

    let source: string;
    try {
      source = await this.#app.vault.cachedRead(file);
    } catch (error) {
      if (generation !== this.#folderGeneration) return;
      this.#log("warn", "Failed to read partial file", { error, path });
      this.#loadedDocumentSources.delete(path);
      this.#removePartial(name);
      this.#compileErrors.set(name, { message: errorMessage(error) });
      return;
    }
    if (generation !== this.#folderGeneration) return;

    this.#loadedDocumentSources.set(path, source);
    let parsed;
    try {
      parsed = parsePlainTemplateDocument(source);
    } catch (error) {
      this.#removePartial(name);
      this.#compileErrors.set(name, { message: errorMessage(error) });
      this.#log("warn", "Failed to parse partial document", { error, path });
      return;
    }

    const { language } = parsed.manifest;
    if (language === "eta" && !this.#javascriptTemplatesEnabled) {
      if (this.#inertEta.get(name) !== path) {
        this.#log(
          "debug",
          "Eta partial inert while JavaScript templates are disabled",
          {
            name,
            path,
          },
        );
      }
      this.#removePartial(name);
      this.#inertEta.set(name, path);
      this.#inertPartials.set(name, { name, language, source: parsed.source });
      return;
    }

    this.#removePartial(name);
    this.#partials.set(name, { path, language, source: parsed.source });
    this.#defineTemplate(name, parsed.source, language);
  }

  /**
   * Resolve the Citation Template from `zotlit-citation.md`, or register the
   * built-in source when the vault holds no document. Either way the template
   * answers to {@link CITATION_TEMPLATE_NAME}, so every citation render and
   * the pack export reach it by that one name.
   *
   * A document that fails to parse or to compile is left undefined and records
   * a compile error, and one written in Eta while the JavaScript Templates gate
   * is off is left inert: inserting a citation then reports the inert notice
   * rather than quietly falling back to the built-in text.
   */
  async #reconcileCitation(generation: number): Promise<void> {
    if (generation !== this.#folderGeneration) return;

    const name = CITATION_TEMPLATE_NAME;
    const path = citationPath(this.#currentTemplateFolder());
    const file = this.#app.vault.getFileByPath(path);
    if (!file) {
      this.#useBuiltInCitation();
      this.#loadedDocumentSources.delete(path);
      return;
    }

    let source: string;
    try {
      source = await this.#app.vault.cachedRead(file);
    } catch (error) {
      if (generation !== this.#folderGeneration) return;
      this.#log("warn", "Failed to read the Citation Template", {
        error,
        path,
      });
      this.#loadedDocumentSources.delete(path);
      this.#useBuiltInCitation();
      this.#compileErrors.set(name, { message: errorMessage(error) });
      return;
    }
    if (generation !== this.#folderGeneration) return;

    this.#loadedDocumentSources.set(path, source);
    let parsed;
    try {
      parsed = parsePlainTemplateDocument(source);
    } catch (error) {
      this.#unregisterCitation();
      this.#compileErrors.set(name, { message: errorMessage(error) });
      this.#log("warn", "Failed to parse the Citation Template", {
        error,
        path,
      });
      return;
    }

    const { language } = parsed.manifest;
    if (language === "eta" && !this.#javascriptTemplatesEnabled) {
      if (this.#inertEta.get(name) !== path) {
        this.#log(
          "debug",
          "Citation Template inert while JavaScript templates are disabled",
          { path },
        );
      }
      this.#unregisterCitation();
      this.#inertEta.set(name, path);
      return;
    }

    this.#registerCitation({ path, language, source: parsed.source });
  }

  /** Register the packaged Citation Template, as a vault with no document renders it. */
  #useBuiltInCitation(): void {
    this.#registerCitation({
      path: null,
      language: "liquid",
      source: CITATION_TEMPLATE_SOURCE,
    });
  }

  /**
   * Register the source that won the Citation Template, and log the branch on
   * every change of winner, so a diagnosis reads which source rendered a
   * citation instead of re-instrumenting the reconcile.
   */
  #registerCitation(citation: RegisteredCitationTemplate): void {
    const previous = this.#citation;
    this.#unregisterCitation();
    this.#citation = citation;
    this.#defineTemplate(
      CITATION_TEMPLATE_NAME,
      citation.source,
      citation.language,
    );
    if (
      previous?.path !== citation.path ||
      previous.language !== citation.language
    ) {
      this.#log("debug", "Citation Template resolved", {
        selected: citation.path === null ? "built-in" : "vault",
        path: citation.path,
        language: citation.language,
      });
    }
  }

  #unregisterCitation(): void {
    this.#citation = null;
    this.#unregisterTemplate(CITATION_TEMPLATE_NAME);
  }

  #removePartial(name: string): void {
    this.#partials.delete(name);
    this.#inertPartials.delete(name);
    this.#unregisterTemplate(name);
  }

  /** Drop every trace of `name`: its compiled editions and the status a
   *  previous reconcile recorded for it. */
  #unregisterTemplate(name: string): void {
    this.#compileErrors.delete(name);
    this.#inertEta.delete(name);
    this.#facade.remove(name, "liquid");
    this.#facade.remove(name, "eta");
  }

  /**
   * Compile and register a vault template, recording any compile error. A
   * template that fails to compile is removed from the facade and never falls
   * back to a package default: it fails loudly through {@link render} and
   * through any template that `include()`s it, and surfaces in the setting tab.
   */
  #defineTemplate(
    name: string,
    content: string,
    language: TemplateLanguage,
  ): void {
    try {
      this.#facade.define(name, content, language);
      this.#compileErrors.delete(name);
    } catch (error) {
      const at = engineFaultSpan(error, content);
      this.#compileErrors.set(name, {
        message: errorMessage(error),
        context: errorContext(error),
        ...(at === undefined ? {} : { at }),
      });
      this.#log("warn", "Failed to compile vault template", { error, name });
      this.#facade.remove(name, language);
    }
  }

  /** Use a canonical name's package default (Liquid) when no vault override exists, else remove a non-canonical one. */
  #useDefault(name: string): void {
    this.#facade.remove(name, "eta");
    if (!isTemplateName(name)) {
      this.#facade.remove(name, "liquid");
      this.#winners.delete(name);
      return;
    }
    this.#winners.set(name, EMBEDDED_DEFAULT_WINNER);
    try {
      this.#facade.define(name, DEFAULT_TEMPLATES[name], "liquid");
      this.#compileErrors.delete(name);
    } catch (error) {
      const at = engineFaultSpan(error, DEFAULT_TEMPLATES[name]);
      this.#compileErrors.set(name, {
        message: errorMessage(error),
        context: errorContext(error),
        ...(at === undefined ? {} : { at }),
      });
      this.#log("error", "Built-in default template failed to compile", {
        error,
        name,
      });
      this.#facade.remove(name, "liquid");
    }
  }

  /** Wait for the debounced reconciler to observe a write this service made,
   *  so a caller reads the state its own change produced. */
  async #settle(): Promise<void> {
    if ((await this.waitUntilSettled(SETTLE_TIMEOUT_MS)) !== "settled") {
      throw new Error("The template folder did not finish scanning");
    }
  }

  #currentTemplateFolder(): string {
    return normalizeVaultPath(
      this.#settings.current?.["template.folder"] ?? this.#lastTemplateFolder,
    );
  }

  /**
   * Compile the managed-frontmatter fields, dropping reserved keys the system
   * owns so user and system keys stay disjoint, and hold them for reuse.
   * `"javascript"`-language fields are skipped uncompiled while the gate is
   * off; their keys are logged and recorded so {@link frontmatterFields}
   * throws rather than hand back a partial set.
   */
  #compileFrontmatter(fields: readonly FrontmatterField[]): void {
    this.#lastFrontmatterFields = fields;
    const filtered = fields.filter((field) => !RESERVED_KEYS.has(field.key));
    const { compiled, inertKeys } = this.#facade.compileFrontmatterFields(
      filtered,
      { javascript: this.#javascriptTemplatesEnabled },
    );
    this.#compiledFrontmatterFields = compiled;
    this.#inertFrontmatterKeys = inertKeys;

    if (inertKeys.length > 0) {
      this.#log("info", "Skipping inert frontmatter fields", {
        keys: inertKeys,
      });
    }
  }

  /** Drop a scheduled flush, then release any waiter the drop settled — on
   *  unload a waiter is answered at once rather than after its full budget. */
  #cancelFlush(): void {
    if (this.#flushTimer !== null) {
      this.#flushTimer();
      this.#flushTimer = null;
    }
    this.#resolveSettledWaiters();
  }

  intakeHandled(): void {
    this.#resolveSettledWaiters();
  }

  #isSettled(): boolean {
    return (
      this.#intakePending() === 0 &&
      this.#settlingTasks === 0 &&
      this.#flushTimer === null &&
      isTemplateWorkEmpty(this.#pending)
    );
  }

  #resolveSettledWaiters(): void {
    if (!this.#isSettled()) return;
    for (const waiter of this.#settledWaiters) {
      waiter.resolve();
    }
    this.#settledWaiters.clear();
  }

  #requireLoaded(method: string): void {
    if (!this.#loaded) {
      throw new Error(`TemplateService.${method}(): service is not ready`);
    }
  }
}

/**
 * Name the artifact a render failure belongs to, reading structured error
 * fields only. Message text names nothing: `#facade.render` evaluates lazy
 * data getters (`zt.citation`, `imgLink`, `noteLink`), so the chain routinely
 * carries application errors whose messages mention arbitrary paths — a
 * message holding an inert template's own path must not turn that failure
 * into an {@link InertTemplateError}.
 *
 * @returns the first {@link InertTemplateError} in the chain unchanged (it
 *   already carries the localized message, including the nameless
 *   managed-frontmatter case); otherwise the failure named by the first
 *   {@link TemplateError}, re-raised with the localized inert message or the
 *   recorded compile detail when that name has one; otherwise `error` itself.
 */
function classifyRenderFailure(
  error: unknown,
  compileErrors: ReadonlyMap<string, CompileError>,
  inertTemplates: ReadonlyMap<string, string>,
): Error {
  const chain = errorChain(error);
  const inertFailure = chain.find(
    (candidate) => candidate instanceof InertTemplateError,
  );
  if (inertFailure) return inertFailure;

  const namedFailure = chain.find(
    (candidate): candidate is TemplateError =>
      candidate instanceof TemplateError,
  );
  if (!namedFailure) {
    return Error.isError(error) ? error : new Error(errorMessage(error));
  }

  const name = namedFailure.templateName;
  const inertPath = inertTemplates.get(name);
  if (inertPath !== undefined) {
    return new InertTemplateError(
      m.settings_template_inert_eta({ path: inertPath }),
      name,
      { cause: error },
    );
  }

  const compileError = compileErrors.get(name);
  if (compileError !== undefined) {
    return new TemplateError(
      compileErrorMessage(name, compileError.message),
      name,
      { cause: error },
    );
  }
  return namedFailure;
}

/** The failure message for a name with a recorded compile error, identical
 *  whether a caller requested that name directly or reached it by include. */
function compileErrorMessage(name: string, detail: string): string {
  return `Template '${name}' has a compile error:\n${detail}`;
}

/**
 * Every `Error` reachable from `error`, breadth-first, so "the first typed
 * error" is the one nearest the thrown surface. Three link kinds carry a
 * template failure out of the engines:
 *
 * - `cause` — eta wraps rather than subclasses (`EtaRuntimeError` copies
 *   `originalError.name`, so an `instanceof` check on the wrapper fails);
 * - `originalError` — liquidjs defines it non-enumerably on its render errors;
 * - `errors` when it is an array — one duck-typed check covering both
 *   `AggregateError` and liquidjs's `LiquidErrors` batch.
 */
function errorChain(error: unknown): readonly Error[] {
  const errors: Error[] = [];
  const pending = [error];
  const seen = new Set<unknown>();

  while (pending.length > 0) {
    const candidate = pending.shift();
    if (!Error.isError(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    errors.push(candidate);
    pending.push(candidate.cause);
    if ("originalError" in candidate) {
      pending.push(candidate.originalError);
    }
    if ("errors" in candidate && Array.isArray(candidate.errors)) {
      pending.push(...(candidate.errors as unknown[]));
    }
  }
  return errors;
}

/** Extract a human-readable message from an unknown thrown value. */
function errorMessage(error: unknown): string {
  return Error.isError(error) ? error.message : String(error);
}

/** Collapse rendered filename output to one trimmed line. */
function toSingleLine(rendered: string): string {
  return rendered.trim().replaceAll(/\s*\n\s*/g, "");
}

/** Current startup and compilation status, replayed to every subscriber. */
export type TemplateStatus = {
  readonly compileErrors: ReadonlyMap<string, CompileError>;
} & (
  | { readonly state: "loading" | "loaded" }
  | {
      readonly state: "init-failed";
      readonly cause: Cause.Cause<TemplateFailure>;
    }
);

export type TemplateFailure =
  | TemplateError
  | LegacyTemplateConversionError
  | LiteratureNoteTemplateError
  | PlainTemplateDocumentError
  | LiteratureNotePackError
  | ProfileAnnotationError
  | InertTemplateError
  | PartialNameError
  | TemplateOperationError
  | TemplateRenderError;

export class Template extends Context.Service<
  Template,
  {
    readonly status: Effect.Effect<TemplateStatus>;
    readonly changes: Stream.Stream<TemplateStatus>;
    readonly compileEvents: Stream.Stream<void>;
    readonly compileErrors: Effect.Effect<
      ReadonlyMap<string, CompileError>,
      TemplateFailure
    >;
    getLoadedDocumentSource(
      path: string,
    ): Effect.Effect<string | undefined, TemplateFailure>;
    readonly shadowedFiles: Effect.Effect<
      ReadonlyMap<string, string>,
      TemplateFailure
    >;
    readonly inertEtaFiles: Effect.Effect<
      ReadonlyMap<string, string>,
      TemplateFailure
    >;
    readonly javascriptTemplatesEnabled: Effect.Effect<
      boolean,
      TemplateFailure
    >;
    readonly loaded: Effect.Effect<boolean, TemplateFailure>;
    getUnrecognizedFiles(): Effect.Effect<readonly string[], TemplateFailure>;
    getTemplateFileStatuses(): Effect.Effect<
      readonly TemplateFileStatus[],
      TemplateFailure
    >;
    getCitationTemplateStatus(): Effect.Effect<
      CitationTemplateStatus,
      TemplateFailure
    >;
    materializeCitationTemplate(): Effect.Effect<TFile, TemplateFailure>;
    restoreCitationTemplate(): Effect.Effect<void, TemplateFailure>;
    getLiteratureNoteTemplate(
      reference: string,
    ): Effect.Effect<
      ResolvedLiteratureNoteTemplate | undefined,
      TemplateFailure
    >;
    prepareLiteratureNoteTemplateSource(
      source: string,
    ): Effect.Effect<ResolvedLiteratureNoteTemplate, TemplateFailure>;
    renderProfileAnnotation<T extends object>(
      data: T,
      options: { profile: ResolvedProfile },
    ): Effect.Effect<string, TemplateFailure>;
    getLiteratureNoteTemplateStatuses(): Effect.Effect<
      readonly LiteratureNoteTemplateStatus[],
      TemplateFailure
    >;
    renderLiteratureNoteTemplateSource<T extends object>(
      source: string,
      data: T,
    ): Effect.Effect<
      { create: string; update: string | null },
      TemplateFailure
    >;
    exportLiteratureNotePack(
      reference: string,
      options?: { includeFolders?: boolean },
    ): Effect.Effect<string, TemplateFailure>;
    exportLiteratureNotePackSource(
      source: string,
      options?: {
        includeFolders?: boolean;
        /** Extra partial names to bundle, reachable from the draft or not. */
        include?: readonly string[];
        /** Reports a name no partial answers instead of failing the export. */
        onMissingPartial?: (name: string) => void;
      },
    ): Effect.Effect<string, TemplateFailure>;
    refresh(): Effect.Effect<void, TemplateFailure>;
    waitUntilSettled(
      timeoutMs: number,
    ): Effect.Effect<SettleOutcome, TemplateFailure>;
    readonly frontmatterFields: Effect.Effect<
      readonly CompiledFrontmatterField[],
      TemplateFailure
    >;
    getFrontmatterFieldStatus(): Effect.Effect<
      FrontmatterFieldStatus,
      TemplateFailure
    >;
    evaluateFrontmatterFields(
      fields: readonly FrontmatterField[],
      zt: object,
    ): Effect.Effect<
      {
        values: Readonly<Record<string, unknown>>;
        errors: Readonly<Record<string, string>>;
        inertKeys: readonly string[];
      },
      TemplateFailure
    >;
    render<T extends object>(
      name: string,
      data: T,
    ): Effect.Effect<string, TemplateFailure>;
    renderManagedContent<T extends object>(
      data: T,
    ): Effect.Effect<string, TemplateFailure>;
    renderCitation(
      refs: readonly CiteRef[],
      variant: CitationVariant,
    ): Effect.Effect<string, TemplateFailure>;
    renderCitationData(
      data: CitationTemplateData,
    ): Effect.Effect<string, TemplateFailure>;
    getPartialDocument(
      name: string,
    ): Effect.Effect<SharedPartialDocument | null, TemplateFailure>;
    getPartialNames(): Effect.Effect<readonly string[], TemplateFailure>;
    getPartialDocuments(): Effect.Effect<
      readonly SharedPartialDocument[],
      TemplateFailure
    >;
    getPartialEntries(): Effect.Effect<
      readonly LiteratureNoteTemplatePartial[],
      TemplateFailure
    >;
    planPartialUnpack(
      bundled: readonly LiteratureNoteTemplatePartial[],
    ): Effect.Effect<readonly LiteratureNotePartialUnpack[], TemplateFailure>;
    unpackPartials(
      plan: readonly LiteratureNotePartialUnpack[],
      options?: { replace?: readonly string[] },
    ): Effect.Effect<PartialUnpackOutcome, TemplateFailure>;
    getReservedPartialFiles(): Effect.Effect<
      readonly { name: string; path: string }[],
      TemplateFailure
    >;
    createPartial(
      name: string,
      options?: { source?: string; language?: TemplateLanguage },
    ): Effect.Effect<TFile, TemplateFailure>;
    deletePartial(name: string): Effect.Effect<void, TemplateFailure>;
    renderPartialSource<T extends object>(
      source: string,
      data: T,
      options: { name: string },
    ): Effect.Effect<string, TemplateFailure>;
    renderCitationSource(
      source: string,
      data: CitationTemplateData,
    ): Effect.Effect<string, TemplateFailure>;
    renderFilename<T extends object>(
      data: T,
    ): Effect.Effect<string, TemplateFailure>;
    analyzeRootVariables(
      name: string,
    ): Effect.Effect<RootVariableUse[] | null, TemplateFailure>;
    getTemplateSource(
      name: TemplateName,
    ): Effect.Effect<string, TemplateFailure>;
    getLegacyLiteratureNoteTemplateFiles(): Effect.Effect<
      readonly string[],
      TemplateFailure
    >;
    getLegacyTemplateDocuments(): Effect.Effect<
      LegacyTemplateDocuments,
      TemplateFailure
    >;
    convertLegacyTemplateDocuments(
      refs: readonly CiteRef[],
    ): Effect.Effect<ConvertedLegacyTemplateDocuments, TemplateFailure>;
    convertLegacyLiteratureNoteTemplates(data: {
      readonly note: object;
      readonly filename: object;
      readonly annotation?: object;
    }): Effect.Effect<ConvertedLegacyProfileDocument, TemplateFailure>;
    validateFrontmatterExpr(
      expr: string,
      language: FrontmatterLanguage,
    ): Effect.Effect<string | null, TemplateFailure>;
    setJavascriptTemplatesEnabled(
      enabled: boolean,
    ): Effect.Effect<void, TemplateFailure>;
  }
>()("zotlit/template/Template") {}

export type TemplateOperations = Pick<
  TemplateEngine,
  | "compileErrors"
  | "getLoadedDocumentSource"
  | "shadowedFiles"
  | "inertEtaFiles"
  | "javascriptTemplatesEnabled"
  | "loaded"
  | "getUnrecognizedFiles"
  | "getTemplateFileStatuses"
  | "getCitationTemplateStatus"
  | "materializeCitationTemplate"
  | "restoreCitationTemplate"
  | "getLiteratureNoteTemplate"
  | "prepareLiteratureNoteTemplateSource"
  | "renderProfileAnnotation"
  | "getLiteratureNoteTemplateStatuses"
  | "renderLiteratureNoteTemplateSource"
  | "exportLiteratureNotePack"
  | "exportLiteratureNotePackSource"
  | "refresh"
  | "waitUntilSettled"
  | "frontmatterFields"
  | "getFrontmatterFieldStatus"
  | "evaluateFrontmatterFields"
  | "render"
  | "renderManagedContent"
  | "renderCitation"
  | "renderCitationData"
  | "getPartialDocument"
  | "getPartialNames"
  | "getPartialDocuments"
  | "getPartialEntries"
  | "planPartialUnpack"
  | "unpackPartials"
  | "getReservedPartialFiles"
  | "createPartial"
  | "deletePartial"
  | "renderPartialSource"
  | "renderCitationSource"
  | "renderFilename"
  | "analyzeRootVariables"
  | "getTemplateSource"
  | "getLegacyLiteratureNoteTemplateFiles"
  | "getLegacyTemplateDocuments"
  | "convertLegacyTemplateDocuments"
  | "convertLegacyLiteratureNoteTemplates"
  | "validateFrontmatterExpr"
  | "setJavascriptTemplatesEnabled"
>;

export const layerTemplate = Layer.effect(
  Template,
  Effect.gen(function* () {
    const app = yield* ObsidianApp;
    const settings = yield* PluginSettings;
    const scope = yield* Scope.fork(yield* Scope.Scope);
    const context = yield* Effect.context<never>();
    const runSync = Effect.runSyncWith(context);
    const stopped = yield* Deferred.make<void>();
    const status = yield* SubscriptionRef.make<TemplateStatus>({
      state: "loading",
      compileErrors: new Map(),
    });
    const compileEvents = yield* PubSub.unbounded<void>();
    yield* Effect.addFinalizer(() => PubSub.shutdown(compileEvents));
    const intake = yield* obsidianEvents<{
      create: [TAbstractFile];
      modify: [TAbstractFile];
      rename: [TAbstractFile, string];
      delete: [TAbstractFile];
      flush: [];
    }>();
    const engine = new TemplateEngine({
      app,
      settings: {
        get current() {
          return runSync(settings.current);
        },
      },
      changed: () => {
        publishStatus();
        PubSub.publishUnsafe(compileEvents, undefined);
      },
      flushRequested: intake.callback("flush"),
      intakePending: () => intake.pending,
      schedule: (millis, task) => {
        const fiber = runSync(
          Effect.forkIn(
            Effect.sleep(millis).pipe(Effect.andThen(Effect.sync(task))),
            scope,
            { startImmediately: true },
          ),
        );
        return () => fiber.interruptUnsafe();
      },
      log: (level, message, fields) => {
        const log = {
          debug: Effect.logDebug,
          info: Effect.logInfo,
          warn: Effect.logWarning,
          error: Effect.logError,
        }[level];
        runSync(
          log(message).pipe(
            Effect.annotateLogs(fields ?? {}),
            withLogCategory("template"),
          ),
        );
      },
    });
    const publishStatus = () =>
      runSync(
        SubscriptionRef.update(status, (previous) => ({
          ...(previous.state === "init-failed"
            ? previous
            : {
                state: engine.loaded
                  ? ("loaded" as const)
                  : ("loading" as const),
              }),
          compileErrors: new Map(engine.compileErrors),
        })),
      );
    const report = (message: string) => (cause: unknown) =>
      Effect.logWarning(message).pipe(
        Effect.annotateLogs({ cause }),
        withLogCategory("template"),
      );
    yield* intake
      .consume((event) =>
        Effect.gen(function* () {
          switch (event.type) {
            case "create":
            case "modify":
              engine.onCreateOrModify(event.args[0]);
              break;
            case "rename":
              engine.onRename(...event.args);
              break;
            case "delete":
              engine.onDelete(event.args[0]);
              break;
            case "flush":
              yield* attemptPromise(() => engine.flushPending());
              break;
          }
        }).pipe(Effect.ensuring(Effect.sync(() => engine.intakeHandled()))),
      )
      .pipe(Effect.forkScoped({ startImmediately: true }));
    yield* Effect.gen(function* () {
      for (const event of ["create", "modify", "rename", "delete"] as const)
        yield* intake.on(event, app.vault, event);
      yield* attemptPromise(() => engine.load());
      publishStatus();
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => engine.failStartup()).pipe(
          Effect.andThen(
            SubscriptionRef.set(status, {
              state: "init-failed",
              cause,
              compileErrors: new Map(engine.compileErrors),
            }),
          ),
          Effect.andThen(report("Template startup failed")(cause)),
        ),
      ),
    );
    yield* Stream.runForEach(settings.changes, (snapshot) =>
      attemptPromise(() => engine.onSettingsChanged(snapshot)).pipe(
        Effect.catchCause(report("Template settings update failed")),
        // Apply each snapshot immediately. Folder reads can overlap: the
        // generation check lets a newer folder supersede a pending read.
        Effect.forkIn(scope, { startImmediately: true }),
      ),
    ).pipe(Effect.forkScoped({ startImmediately: true }));
    let closed = false;
    const owned = <A, E>(
      effect: Effect.Effect<A, E>,
      uninterruptible = false,
    ) =>
      closed
        ? effect
        : Effect.forkIn(effect, scope, {
            startImmediately: true,
            uninterruptible,
          }).pipe(Effect.flatMap(Fiber.join));
    const write = <A, E>(effect: Effect.Effect<A, E>) => owned(effect, true);
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true;
        engine.close();
      }).pipe(Effect.andThen(Deferred.succeed(stopped, undefined))),
    );
    return Template.of({
      status: SubscriptionRef.get(status),
      changes: changesUntil(status, Deferred.await(stopped)),
      compileEvents: Stream.fromPubSub(compileEvents),
      compileErrors: attempt(() => engine.compileErrors),
      getLoadedDocumentSource: Effect.fn("Template.getLoadedDocumentSource")(
        function* (path: string) {
          return yield* attempt(() => engine.getLoadedDocumentSource(path));
        },
      ),
      shadowedFiles: attempt(() => engine.shadowedFiles),
      inertEtaFiles: attempt(() => engine.inertEtaFiles),
      javascriptTemplatesEnabled: attempt(
        () => engine.javascriptTemplatesEnabled,
      ),
      loaded: attempt(() => engine.loaded),
      getUnrecognizedFiles: Effect.fn("Template.getUnrecognizedFiles")(
        function* () {
          return yield* attempt(() => engine.getUnrecognizedFiles());
        },
      ),
      getTemplateFileStatuses: Effect.fn("Template.getTemplateFileStatuses")(
        function* () {
          return yield* attempt(() => engine.getTemplateFileStatuses());
        },
      ),
      getCitationTemplateStatus: Effect.fn(
        "Template.getCitationTemplateStatus",
      )(function* () {
        return yield* attempt(() => engine.getCitationTemplateStatus());
      }),
      materializeCitationTemplate: Effect.fn(
        "Template.materializeCitationTemplate",
      )(function* () {
        return yield* write(
          attemptPromise(() => engine.materializeCitationTemplate()).pipe(
            Effect.uninterruptible,
          ),
        );
      }),
      restoreCitationTemplate: Effect.fn("Template.restoreCitationTemplate")(
        function* () {
          return yield* write(
            attemptPromise(() => engine.restoreCitationTemplate()).pipe(
              Effect.uninterruptible,
            ),
          );
        },
      ),
      getLiteratureNoteTemplate: Effect.fn(
        "Template.getLiteratureNoteTemplate",
      )(function* (reference: string) {
        return yield* attempt(() =>
          engine.getLiteratureNoteTemplate(reference),
        );
      }),
      prepareLiteratureNoteTemplateSource: Effect.fn(
        "Template.prepareLiteratureNoteTemplateSource",
      )(function* (source: string) {
        return yield* attempt(() =>
          engine.prepareLiteratureNoteTemplateSource(source),
        );
      }),
      renderProfileAnnotation: Effect.fn("Template.renderProfileAnnotation")(
        function* <T extends object>(
          data: T,
          options: { profile: ResolvedProfile },
        ) {
          return yield* attemptRender(() =>
            engine.renderProfileAnnotation(data, options),
          );
        },
      ),
      getLiteratureNoteTemplateStatuses: Effect.fn(
        "Template.getLiteratureNoteTemplateStatuses",
      )(function* () {
        return yield* attempt(() => engine.getLiteratureNoteTemplateStatuses());
      }),
      renderLiteratureNoteTemplateSource: Effect.fn(
        "Template.renderLiteratureNoteTemplateSource",
      )(function* <T extends object>(source: string, data: T) {
        return yield* attemptRender(() =>
          engine.renderLiteratureNoteTemplateSource(source, data),
        );
      }),
      exportLiteratureNotePack: Effect.fn("Template.exportLiteratureNotePack")(
        function* (
          reference: string,
          options: { includeFolders?: boolean } = {},
        ) {
          return yield* owned(
            attemptPromise(() =>
              engine.exportLiteratureNotePack(reference, options),
            ),
          );
        },
      ),
      exportLiteratureNotePackSource: Effect.fn(
        "Template.exportLiteratureNotePackSource",
      )(function* (
        source: string,
        options: {
          includeFolders?: boolean;
          /** Extra partial names to bundle, reachable from the draft or not. */
          include?: readonly string[];
          /** Reports a name no partial answers instead of failing the export. */
          onMissingPartial?: (name: string) => void;
        } = {},
      ) {
        return yield* owned(
          attemptPromise(() =>
            engine.exportLiteratureNotePackSource(source, options),
          ),
        );
      }),
      refresh: Effect.fn("Template.refresh")(function* () {
        return yield* owned(attemptPromise(() => engine.refresh()));
      }),
      waitUntilSettled: Effect.fn("Template.waitUntilSettled")(function* (
        timeoutMs: number,
      ) {
        return yield* owned(
          attemptPromise(() => engine.waitUntilSettled(timeoutMs)),
        );
      }),
      frontmatterFields: attempt(() => engine.frontmatterFields),
      getFrontmatterFieldStatus: Effect.fn(
        "Template.getFrontmatterFieldStatus",
      )(function* () {
        return yield* attempt(() => engine.getFrontmatterFieldStatus());
      }),
      evaluateFrontmatterFields: Effect.fn(
        "Template.evaluateFrontmatterFields",
      )(function* (fields: readonly FrontmatterField[], zt: object) {
        return yield* attempt(() =>
          engine.evaluateFrontmatterFields(fields, zt),
        );
      }),
      render: Effect.fn("Template.render")(function* <T extends object>(
        name: string,
        data: T,
      ) {
        return yield* attemptRender(() => engine.render(name, data));
      }),
      renderManagedContent: Effect.fn("Template.renderManagedContent")(
        function* <T extends object>(data: T) {
          return yield* attemptRender(() => engine.renderManagedContent(data));
        },
      ),
      renderCitation: Effect.fn("Template.renderCitation")(function* (
        refs: readonly CiteRef[],
        variant: CitationVariant,
      ) {
        return yield* attemptRender(() => engine.renderCitation(refs, variant));
      }),
      renderCitationData: Effect.fn("Template.renderCitationData")(function* (
        data: CitationTemplateData,
      ) {
        return yield* attemptRender(() => engine.renderCitationData(data));
      }),
      getPartialDocument: Effect.fn("Template.getPartialDocument")(function* (
        name: string,
      ) {
        return yield* attempt(() => engine.getPartialDocument(name));
      }),
      getPartialNames: Effect.fn("Template.getPartialNames")(function* () {
        return yield* attempt(() => engine.getPartialNames());
      }),
      getPartialDocuments: Effect.fn("Template.getPartialDocuments")(
        function* () {
          return yield* attempt(() => engine.getPartialDocuments());
        },
      ),
      getPartialEntries: Effect.fn("Template.getPartialEntries")(function* () {
        return yield* attempt(() => engine.getPartialEntries());
      }),
      planPartialUnpack: Effect.fn("Template.planPartialUnpack")(function* (
        bundled: readonly LiteratureNoteTemplatePartial[],
      ) {
        return yield* attempt(() => engine.planPartialUnpack(bundled));
      }),
      unpackPartials: Effect.fn("Template.unpackPartials")(function* (
        plan: readonly LiteratureNotePartialUnpack[],
        options: { replace?: readonly string[] } = {},
      ) {
        return yield* write(
          attemptPromise(() => engine.unpackPartials(plan, options)).pipe(
            Effect.uninterruptible,
          ),
        );
      }),
      getReservedPartialFiles: Effect.fn("Template.getReservedPartialFiles")(
        function* () {
          return yield* attempt(() => engine.getReservedPartialFiles());
        },
      ),
      createPartial: Effect.fn("Template.createPartial")(function* (
        name: string,
        options: { source?: string; language?: TemplateLanguage } = {},
      ) {
        return yield* write(
          attemptPromise(() => engine.createPartial(name, options)).pipe(
            Effect.uninterruptible,
          ),
        );
      }),
      deletePartial: Effect.fn("Template.deletePartial")(function* (
        name: string,
      ) {
        return yield* write(
          attemptPromise(() => engine.deletePartial(name)).pipe(
            Effect.uninterruptible,
          ),
        );
      }),
      renderPartialSource: Effect.fn("Template.renderPartialSource")(function* <
        T extends object,
      >(source: string, data: T, options: { name: string }) {
        return yield* attemptRender(() =>
          engine.renderPartialSource(source, data, options),
        );
      }),
      renderCitationSource: Effect.fn("Template.renderCitationSource")(
        function* (source: string, data: CitationTemplateData) {
          return yield* attemptRender(() =>
            engine.renderCitationSource(source, data),
          );
        },
      ),
      renderFilename: Effect.fn("Template.renderFilename")(function* <
        T extends object,
      >(data: T) {
        return yield* attemptRender(() => engine.renderFilename(data));
      }),
      analyzeRootVariables: Effect.fn("Template.analyzeRootVariables")(
        function* (name: string) {
          return yield* attempt(() => engine.analyzeRootVariables(name));
        },
      ),
      getTemplateSource: Effect.fn("Template.getTemplateSource")(function* (
        name: TemplateName,
      ) {
        return yield* owned(
          attemptPromise(() => engine.getTemplateSource(name)),
        );
      }),
      getLegacyLiteratureNoteTemplateFiles: Effect.fn(
        "Template.getLegacyLiteratureNoteTemplateFiles",
      )(function* () {
        return yield* attempt(() =>
          engine.getLegacyLiteratureNoteTemplateFiles(),
        );
      }),
      getLegacyTemplateDocuments: Effect.fn(
        "Template.getLegacyTemplateDocuments",
      )(function* () {
        return yield* attempt(() => engine.getLegacyTemplateDocuments());
      }),
      convertLegacyTemplateDocuments: Effect.fn(
        "Template.convertLegacyTemplateDocuments",
      )(function* (refs: readonly CiteRef[]) {
        return yield* owned(
          attemptPromise(() => engine.convertLegacyTemplateDocuments(refs)),
        );
      }),
      convertLegacyLiteratureNoteTemplates: Effect.fn(
        "Template.convertLegacyLiteratureNoteTemplates",
      )(function* (data: {
        readonly note: object;
        readonly filename: object;
        readonly annotation?: object;
      }) {
        return yield* owned(
          attemptPromise(() =>
            engine.convertLegacyLiteratureNoteTemplates(data),
          ),
        );
      }),
      validateFrontmatterExpr: Effect.fn("Template.validateFrontmatterExpr")(
        function* (expr: string, language: FrontmatterLanguage) {
          return yield* attempt(() =>
            engine.validateFrontmatterExpr(expr, language),
          );
        },
      ),
      setJavascriptTemplatesEnabled: Effect.fn(
        "Template.setJavascriptTemplatesEnabled",
      )(function* (enabled: boolean) {
        return yield* write(
          attemptPromise(() =>
            engine.setJavascriptTemplatesEnabled(enabled),
          ).pipe(Effect.uninterruptible),
        );
      }),
    });
  }),
);

/** Preserve domain failures; map unknown host failures once, with their cause. */
export function templateFailure(cause: unknown): TemplateFailure {
  if (
    cause instanceof TemplateError ||
    cause instanceof LegacyTemplateConversionError ||
    cause instanceof LiteratureNoteTemplateError ||
    cause instanceof PlainTemplateDocumentError ||
    cause instanceof LiteratureNotePackError ||
    cause instanceof ProfileAnnotationError ||
    cause instanceof InertTemplateError ||
    cause instanceof PartialNameError ||
    cause instanceof TemplateOperationError ||
    cause instanceof TemplateRenderError
  )
    return cause;
  return new TemplateOperationError({
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

function attempt<A>(evaluate: () => A): Effect.Effect<A, TemplateFailure> {
  return Effect.try({ try: evaluate, catch: templateFailure });
}
function attemptRender<A>(
  evaluate: () => A,
): Effect.Effect<A, TemplateFailure> {
  return Effect.try({
    try: evaluate,
    catch: (cause) => {
      const error = templateFailure(cause);
      return error instanceof TemplateOperationError
        ? new TemplateRenderError({ message: error.message, cause })
        : error;
    },
  });
}
function attemptPromise<A>(
  evaluate: () => Promise<A>,
): Effect.Effect<A, TemplateFailure> {
  return Effect.tryPromise({ try: evaluate, catch: templateFailure });
}
