import type { Extension } from "@codemirror/state";
import { dirname, join } from "node:path/posix";
import { TFile } from "obsidian";
import type { App, EventRef, Plugin, TAbstractFile } from "obsidian";

import { createNanoEvents } from "@zotlit/shared/nanoevents";
import type {
  AutoTrim,
  FrontmatterLanguage,
} from "@zotlit/templates/constants";
import {
  LiteratureNoteTemplateError,
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
  FrontmatterField,
} from "@zotlit/templates/frontmatter";
import { exportLiteratureNotePack } from "@zotlit/templates/literature-note-pack";
import type { LiteratureNoteTemplatePartial } from "@zotlit/templates/literature-note-pack";
import { managedRegionTransform } from "@zotlit/templates/obsidian";

import { RESERVED_KEYS } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { Service } from "@/services/service-base";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";

import {
  DEFAULT_TEMPLATES,
  isTemplateName,
  MANAGED_CONTENT_TEMPLATE,
  templateFileFromPath,
  templatePath,
  TEMPLATE_NAMES,
} from "./defaults";
import type { TemplateName } from "./defaults";
import { bracketExtension } from "./editor/bracket";
import { EtaSuggest } from "./editor/suggest";
import { InertTemplateError } from "./errors";
import { normalizeVaultPath } from "./path";

const logger = getLogger("template");
const FLUSH_DEBOUNCE_MS = 500;

/** localStorage key for the per-device JavaScript Templates consent flag. */
const JS_TEMPLATES_STORAGE_KEY = "zotlit-javascript-templates";

/** The winner of a name with no vault file: its packaged Liquid default. */
const EMBEDDED_DEFAULT_WINNER = {
  language: "liquid",
  source: { kind: "embedded-default" },
} as const satisfies TemplateWinner;

export interface TemplateServiceEvents {
  "compile-status-changed": () => void;
}

export interface TemplateServiceOptions {
  plugin: Plugin;
  app: App;
  settings: SettingsService;
}

/**
 * The template a name currently resolves to, as the reconciler computed it.
 * `source.kind: "none"` means no compiled template backs the name at all: its
 * `.eta.md` file would win, but the JavaScript Templates gate keeps it inert,
 * so {@link TemplateService.render} raises {@link InertTemplateError} for it.
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
  readonly hasManagedBlock: boolean;
  renderForCreate<T extends object>(data: T): string;
  renderForUpdate<T extends object>(data: T): string | null;
  renderFilename<T extends object>(data: T): string;
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
        readonly error: {
          readonly code: LiteratureNoteTemplateErrorCode | "unknown";
          readonly message: string;
          readonly recovery: string;
        };
      };
}

export interface ConvertedLegacyProfileDocument extends ConvertedLegacyLiteratureNoteTemplate {
  readonly legacyFiles: readonly string[];
}

interface ReconciledLiteratureNoteTemplate {
  path: string;
  document: LiteratureNoteTemplateDocument;
}

/** A recorded compile error: its message, and the liquidjs caret-annotated
 *  source excerpt when the underlying error carried one. */
export interface CompileError {
  message: string;
  context?: string;
}

/** Managed-frontmatter field configuration and inert-key state, as
 *  {@link TemplateService.getFrontmatterFieldStatus} reports it. */
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

/** Outcome of {@link TemplateService.waitUntilSettled}. */
export type SettleOutcome = "settled" | "timeout" | "init-failed";

export class TemplateService extends Service<void> {
  readonly #plugin;
  readonly #app;
  readonly #settings;
  readonly #facade = new TemplateFacade({
    transformRender: managedRegionTransform(MANAGED_CONTENT_TEMPLATE),
  });
  readonly #emitter = createNanoEvents<TemplateServiceEvents>();
  readonly #compileErrors = new Map<string, CompileError>();
  /** Name → the winner {@link #reconcileName} last resolved it to, with the
   *  JavaScript Templates gate already applied. Read by
   *  {@link getTemplateFileStatuses}, so status reports the winner the
   *  reconciler computed instead of re-deriving one from the vault. */
  readonly #winners = new Map<string, TemplateWinner>();
  readonly #shadowed = new Map<string, string>();
  readonly #inertEta = new Map<string, string>();
  readonly #pendingFlush = new Set<string>();
  readonly #pendingDocumentFlush = new Set<string>();
  readonly #literatureNoteDocuments = new Map<
    string,
    ReconciledLiteratureNoteTemplate
  >();
  readonly #literatureNoteDocumentErrors = new Map<string, Error>();
  readonly #settledWaiters = new Set<SettledWaiter>();
  readonly #autoPairExtensions: Extension[] = [];

  #javascriptTemplatesEnabled: boolean;

  /** Compiled managed-frontmatter fields, memoized by the settings array
   *  reference (which changes only when the list is mutated). */
  #lastFrontmatterFields: readonly FrontmatterField[] | null = null;
  #compiledFrontmatterFields: readonly CompiledFrontmatterField[] = [];
  #inertFrontmatterKeys: readonly string[] = [];

  #flushTimer: number | null = null;
  #settlingTasks = 0;
  #folderGeneration = 0;
  #loaded = false;

  #lastTemplateFolder = "";
  #lastAutoTrim: [AutoTrim, AutoTrim] = [false, false];
  #lastAutoPairEta = false;

  ready: Promise<void>;

  constructor(options: TemplateServiceOptions) {
    super();
    this.#plugin = options.plugin;
    this.#app = options.app;
    this.#settings = options.settings;
    this.#javascriptTemplatesEnabled =
      this.#app.loadLocalStorage(JS_TEMPLATES_STORAGE_KEY) === "1";
    this.ready = this.#load();
  }

  get compileErrors(): ReadonlyMap<string, CompileError> {
    return this.#compileErrors;
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

  /** Synchronous readiness check for callers that can't await {@link ready} —
   *  e.g. `dragstart` and `selectSuggestion` handlers. */
  get loaded(): boolean {
    return this.#loaded;
  }

  getTemplateFileStatuses(): readonly TemplateFileStatus[] {
    this.#requireLoaded("getTemplateFileStatuses");
    const folder = this.#currentTemplateFolder();

    return TEMPLATE_NAMES.map((name) => {
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
    const { document, path } = entry;
    if (
      document.manifest.language === "eta" &&
      !this.#javascriptTemplatesEnabled
    ) {
      throw new InertTemplateError(m.settings_template_inert_eta({ path }));
    }
    return {
      reference,
      path,
      manifest: document.manifest,
      hasManagedBlock: document.managedBlock !== null,
      renderForCreate: <T extends object>(data: T) =>
        this.#facade.renderLiteratureNoteTemplateForCreate(document, data),
      renderForUpdate: <T extends object>(data: T) =>
        this.#facade.renderLiteratureNoteTemplateForUpdate(document, data),
      renderFilename: <T extends object>(data: T) =>
        toSingleLine(
          this.#facade.renderLiteratureNoteTemplateFilename(document, data),
        ),
    };
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
          error:
            error instanceof LiteratureNoteTemplateError
              ? {
                  code: error.code,
                  message: error.message,
                  recovery: error.recovery,
                }
              : {
                  code: "unknown",
                  message: error.message,
                  recovery: "Correct the document, then inspect it again.",
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
    this.#requireLoaded("renderLiteratureNoteTemplateSource");
    const document = this.#facade.parseLiteratureNoteTemplate(source);
    if (
      (document.manifest.language === "eta" ||
        document.manifest.partials?.some(
          (partial) => partial.language === "eta",
        )) &&
      !this.#javascriptTemplatesEnabled
    ) {
      throw new InertTemplateError(
        m.settings_template_inert_eta({ path: "source override" }),
      );
    }
    const facade = document.manifest.partials
      ? new TemplateFacade({
          transformRender: managedRegionTransform(MANAGED_CONTENT_TEMPLATE),
        })
      : this.#facade;
    for (const partial of document.manifest.partials ?? []) {
      facade.define(partial.name, partial.source, partial.language);
    }
    return {
      create: facade.renderLiteratureNoteTemplateForCreate(document, data),
      update: facade.renderLiteratureNoteTemplateForUpdate(document, data),
    };
  }

  /** Export one installed document with all reachable partials embedded. */
  async exportLiteratureNotePack(reference: string): Promise<string> {
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
            source: await this.#app.vault.cachedRead(file),
          } satisfies LiteratureNoteTemplatePartial;
        }),
      )
    ).filter((partial) => partial !== null);
    return exportLiteratureNotePack(
      await this.#app.vault.cachedRead(documentFile),
      partials,
    );
  }

  /**
   * Wait until every template edit **Obsidian has observed** before or during
   * this call has passed through the debounced compiler. The predicate reads
   * three in-memory counters, and Obsidian owns observation: an edit reaches
   * the service through a vault event, so a write made outside Obsidian
   * settles only once Obsidian notices the file.
   *
   * @returns `"timeout"` when the bounded wait expires, `"init-failed"` when
   *   service startup itself failed, and `"settled"` otherwise.
   */
  async waitUntilSettled(timeoutMs: number): Promise<SettleOutcome> {
    if (timeoutMs <= 0) return "timeout";

    return await new Promise<SettleOutcome>((resolve) => {
      let waiter: SettledWaiter | null = null;
      let finished = false;
      const finish = (outcome: SettleOutcome): void => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timeout);
        if (waiter) this.#settledWaiters.delete(waiter);
        resolve(outcome);
      };
      const timeout = window.setTimeout(() => finish("timeout"), timeoutMs);

      void this.ready.then(
        () => {
          if (finished) return;
          if (this.#isSettled()) {
            finish("settled");
            return;
          }
          waiter = { resolve: () => finish("settled") };
          this.#settledWaiters.add(waiter);
          this.#resolveSettledWaiters();
        },
        () => finish("init-failed"),
      );
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

  on<K extends keyof TemplateServiceEvents>(
    event: K,
    cb: TemplateServiceEvents[K],
  ): () => void {
    return this.#emitter.on(event, cb);
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
    try {
      return this.#facade.render(name, data);
    } catch (error) {
      throw classifyRenderFailure(error, this.#compileErrors, this.#inertEta);
    }
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

  /** Vault files that make the default Profile use the legacy three-slot format. */
  getLegacyLiteratureNoteTemplateFiles(): readonly string[] {
    return this.getTemplateFileStatuses()
      .filter(
        (status) =>
          (status.name === "filename" ||
            status.name === "note" ||
            status.name === "content") &&
          status.winner.source.kind === "vault",
      )
      .map((status) =>
        status.winner.source.kind === "vault" ? status.winner.source.path : "",
      );
  }

  /** Build and byte-verify the converted default Profile document in memory. */
  async convertLegacyLiteratureNoteTemplates(data: {
    readonly note: object;
    readonly filename: object;
  }): Promise<ConvertedLegacyProfileDocument> {
    this.#requireLoaded("convertLegacyLiteratureNoteTemplates");
    const statuses = this.getTemplateFileStatuses();
    const source = async (name: "filename" | "note" | "content") => {
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
    return {
      ...this.#facade.convertLegacyLiteratureNoteTemplates(
        { note, content, filename },
        data,
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
    logger.info("JavaScript templates flag changed", { enabled });

    if (this.#lastFrontmatterFields) {
      this.#compileFrontmatter(this.#lastFrontmatterFields);
    }

    await this.#rebuildFolder(this.#currentTemplateFolder());
  }

  async #load(): Promise<void> {
    const snapshot = await this.#settings.loaded;
    this.#lastTemplateFolder = normalizeVaultPath(snapshot["template.folder"]);
    this.#lastAutoTrim = [
      snapshot["template.auto-trim-leading"],
      snapshot["template.auto-trim-trailing"],
    ];
    this.#lastAutoPairEta = snapshot["template.auto-pair-eta"];
    this.#facade.setAutoTrim(this.#lastAutoTrim);
    this.#compileFrontmatter(snapshot["note.frontmatter-fields"]);

    await using stack = new AsyncDisposableStack();
    // Registered before the initial scan, so an edit landing while the scan
    // runs queues instead of being dropped: #rebuildFolder clears
    // #pendingFlush before it walks the folder, so anything queued during the
    // walk survives into the debounced flush that follows.
    stack.defer(this.#registerVaultEvents());
    await this.#rebuildFolder(this.#lastTemplateFolder);

    stack.defer(this.#registerAutoPair());
    stack.defer(this.#registerEtaSuggest());
    stack.defer(
      this.#settings.subscribe((settings) => {
        if (settings === null) return;
        this.#onSettingsChanged(settings);
      }),
    );
    stack.defer(() => this.#cancelFlush());

    this.#loaded = true;
    this.commit(stack.move());
  }

  #registerVaultEvents(): () => void {
    const vault = this.#app.vault;
    const refs: EventRef[] = [
      vault.on("create", (file) => this.#onCreateOrModify(file)),
      vault.on("modify", (file) => this.#onCreateOrModify(file)),
      vault.on("rename", (file, oldPath) => this.#onRename(file, oldPath)),
      vault.on("delete", (file) => this.#onDelete(file)),
    ];

    return () => {
      for (const ref of refs) vault.offref(ref);
    };
  }

  #registerAutoPair(): () => void {
    this.#setAutoPairEnabled(this.#lastAutoPairEta, false);
    this.#plugin.registerEditorExtension(this.#autoPairExtensions);
    return () => {
      this.#autoPairExtensions.length = 0;
      this.#app.workspace.updateOptions();
    };
  }

  #registerEtaSuggest(): () => void {
    const suggest = new EtaSuggest(this.#app);
    this.#plugin.registerEditorSuggest(suggest);
    return () => suggest.close();
  }

  #onSettingsChanged(settings: Readonly<Settings>): void {
    const folder = normalizeVaultPath(settings["template.folder"]);
    const autoTrim: [AutoTrim, AutoTrim] = [
      settings["template.auto-trim-leading"],
      settings["template.auto-trim-trailing"],
    ];
    const autoPairEta = settings["template.auto-pair-eta"];

    const folderChanged = folder !== this.#lastTemplateFolder;
    const autoTrimChanged =
      autoTrim[0] !== this.#lastAutoTrim[0] ||
      autoTrim[1] !== this.#lastAutoTrim[1];
    const autoPairChanged = autoPairEta !== this.#lastAutoPairEta;

    const frontmatterFields = settings["note.frontmatter-fields"];

    this.#lastTemplateFolder = folder;
    this.#lastAutoTrim = autoTrim;
    this.#lastAutoPairEta = autoPairEta;

    if (frontmatterFields !== this.#lastFrontmatterFields) {
      this.#compileFrontmatter(frontmatterFields);
    }

    if (autoTrimChanged) {
      this.#facade.setAutoTrim(autoTrim);
      logger.debug("Template autoTrim changed", { autoTrim });
    }

    if (folderChanged) {
      void this.#rebuildFolder(folder).catch((error) => {
        logger.warn("Template folder rebuild failed", { error, folder });
      });
    }

    if (autoPairChanged) this.#setAutoPairEnabled(autoPairEta, true);
  }

  async #rebuildFolder(folder: string): Promise<void> {
    this.#settlingTasks += 1;
    try {
      const generation = ++this.#folderGeneration;
      this.#cancelFlush();
      this.#pendingFlush.clear();
      this.#pendingDocumentFlush.clear();
      this.#shadowed.clear();
      this.#inertEta.clear();
      this.#winners.clear();
      this.#facade.reset();
      this.#compileErrors.clear();
      this.#literatureNoteDocuments.clear();
      this.#literatureNoteDocumentErrors.clear();

      const root =
        folder === ""
          ? this.#app.vault.getRoot()
          : this.#app.vault.getFolderByPath(folder);

      const names = new Set<string>();
      const documentReferences = new Set<string>();
      if (root) {
        for (const child of root.children) {
          if (child instanceof TFile) {
            const parsed = templateFileFromPath(child.path);
            if (parsed) names.add(parsed.name);
            else if (child.extension === "md") {
              documentReferences.add(child.name);
            }
          }
        }
      } else {
        logger.debug("Template folder not found; embedded defaults remain", {
          folder,
        });
      }

      for (const name of TEMPLATE_NAMES) {
        if (!names.has(name)) this.#useDefault(name);
      }

      await Promise.all([
        ...[...names].map((name) => this.#reconcileName(name, generation)),
        ...[...documentReferences].map((reference) =>
          this.#reconcileDocument(reference, generation),
        ),
      ]);
      if (generation !== this.#folderGeneration) return;

      this.#emitter.emit("compile-status-changed");
      logger.debug("Template folder rebuilt", {
        folder,
        count: names.size,
      });
    } finally {
      this.#settlingTasks -= 1;
      this.#resolveSettledWaiters();
    }
  }

  #onCreateOrModify(file: TAbstractFile): void {
    if (!(file instanceof TFile)) return;
    this.#queueTemplatePath(file.path);
  }

  #onRename(file: TAbstractFile, oldPathRaw: string): void {
    this.#queueTemplatePath(oldPathRaw);
    if (file instanceof TFile) this.#queueTemplatePath(file.path);
  }

  #onDelete(file: TAbstractFile): void {
    this.#queueTemplatePath(file.path);
  }

  #queueTemplatePath(path: string): void {
    const normalized = normalizeVaultPath(path);
    const parsed = templateFileFromPath(normalized);
    if (parsed && this.#isWatchedTemplatePath(normalized)) {
      this.#pendingFlush.add(parsed.name);
    } else if (
      isWatchedDocumentPath(normalized, this.#currentTemplateFolder())
    ) {
      this.#pendingDocumentFlush.add(normalized.split("/").at(-1)!);
    } else {
      return;
    }
    this.#scheduleFlush();
  }

  #scheduleFlush(): void {
    if (this.#flushTimer !== null) return;
    this.#flushTimer = window.setTimeout(() => {
      this.#flushTimer = null;
      void this.#flushPending();
    }, FLUSH_DEBOUNCE_MS);
  }

  async #flushPending(): Promise<void> {
    this.#settlingTasks += 1;
    try {
      const generation = this.#folderGeneration;
      const names = [...this.#pendingFlush];
      const documentReferences = [...this.#pendingDocumentFlush];
      this.#pendingFlush.clear();
      this.#pendingDocumentFlush.clear();
      await Promise.all([
        ...names.map((name) => this.#reconcileName(name, generation)),
        ...documentReferences.map((reference) =>
          this.#reconcileDocument(reference, generation),
        ),
      ]);

      if (generation !== this.#folderGeneration) return;

      this.#emitter.emit("compile-status-changed");
      logger.debug("Template flush completed", { count: names.length });
    } finally {
      this.#settlingTasks -= 1;
      this.#resolveSettledWaiters();
    }
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

    // A shadowed eta file is reported as shadowed regardless of the gate —
    // the liquid edition wins either way, so the flag never changes its fate.
    if (liquidFile && etaFile) {
      if (this.#shadowed.get(name) !== etaFile.path) {
        logger.warn("Eta template shadowed by its Liquid edition", {
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
        logger.info(
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
      logger.warn("Failed to read template file", {
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
      return;
    }

    try {
      const source = await this.#app.vault.cachedRead(file);
      if (generation !== this.#folderGeneration) return;
      const document = this.#facade.parseLiteratureNoteTemplate(source);
      this.#literatureNoteDocuments.set(reference, { path, document });
      this.#literatureNoteDocumentErrors.delete(reference);
    } catch (error) {
      if (generation !== this.#folderGeneration) return;
      const failure = Error.isError(error) ? error : new Error(String(error));
      this.#literatureNoteDocuments.delete(reference);
      this.#literatureNoteDocumentErrors.set(reference, failure);
      logger.warn("Failed to reconcile Literature Note Template document", {
        error: failure,
        path,
      });
    }
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
      this.#compileErrors.set(name, {
        message: errorMessage(error),
        context: errorContext(error),
      });
      logger.warn("Failed to compile vault template", { error, name });
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
      this.#compileErrors.set(name, {
        message: errorMessage(error),
        context: errorContext(error),
      });
      logger.error("Built-in default template failed to compile", {
        error,
        name,
      });
      this.#facade.remove(name, "liquid");
    }
  }

  #currentTemplateFolder(): string {
    return normalizeVaultPath(
      this.#settings.current?.["template.folder"] ?? this.#lastTemplateFolder,
    );
  }

  #isWatchedTemplatePath(path: string): boolean {
    return isWatchedTemplatePath(path, this.#currentTemplateFolder());
  }

  #setAutoPairEnabled(enabled: boolean, updateWorkspace: boolean): void {
    this.#autoPairExtensions.length = 0;
    if (enabled) {
      this.#autoPairExtensions.push(bracketExtension(this.#app.vault));
    }
    if (updateWorkspace) this.#app.workspace.updateOptions();
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
      logger.info("Skipping inert frontmatter fields", { keys: inertKeys });
    }
  }

  /** Drop a scheduled flush, then release any waiter the drop settled — on
   *  unload a waiter is answered at once rather than after its full budget. */
  #cancelFlush(): void {
    if (this.#flushTimer !== null) {
      window.clearTimeout(this.#flushTimer);
      this.#flushTimer = null;
    }
    this.#resolveSettledWaiters();
  }

  #isSettled(): boolean {
    return (
      this.#settlingTasks === 0 &&
      this.#flushTimer === null &&
      this.#pendingFlush.size === 0 &&
      this.#pendingDocumentFlush.size === 0
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

/** A watched template is a `zotlit-<name>.(liquid|eta).md` file directly inside `folder` (no recursion). */
function isWatchedTemplatePath(path: string, folder: string): boolean {
  const normalized = normalizeVaultPath(path);
  return (
    templateFileFromPath(normalized) !== null &&
    normalizeVaultPath(dirname(normalized)) === normalizeVaultPath(folder)
  );
}

/** A document is a direct Markdown child of the configured template folder. */
function isWatchedDocumentPath(path: string, folder: string): boolean {
  const normalized = normalizeVaultPath(path);
  return (
    normalized.endsWith(".md") &&
    templateFileFromPath(normalized) === null &&
    normalizeVaultPath(dirname(normalized)) === normalizeVaultPath(folder)
  );
}
