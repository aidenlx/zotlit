import { type Extension } from "@codemirror/state";
import { dirname } from "node:path/posix";
import {
  TFile,
  type App,
  type EventRef,
  type Plugin,
  type TAbstractFile,
} from "obsidian";

import { createNanoEvents } from "@zotlit/shared/nanoevents";
import {
  type AutoTrim,
  type FrontmatterLanguage,
} from "@zotlit/templates/constants";
import {
  TemplateFacade,
  type TemplateLanguage,
} from "@zotlit/templates/facade";
import {
  type CompiledFrontmatterField,
  type FrontmatterField,
} from "@zotlit/templates/frontmatter";
import { managedRegionTransform } from "@zotlit/templates/obsidian";

import { RESERVED_KEYS } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { Service } from "@/services/service-base";
import { type Settings } from "@/services/settings/schema";
import { type SettingsService } from "@/services/settings/service";

import {
  DEFAULT_TEMPLATES,
  isTemplateName,
  MANAGED_CONTENT_TEMPLATE,
  templateFileFromPath,
  templatePath,
  TEMPLATE_NAMES,
} from "./defaults";
import { bracketExtension } from "./editor/bracket";
import { EtaSuggest } from "./editor/suggest";
import { InertTemplateError } from "./errors";
import { normalizeVaultPath } from "./path";

const logger = getLogger("template");
const FLUSH_DEBOUNCE_MS = 500;

/** localStorage key for the per-device JavaScript Templates consent flag. */
const JS_TEMPLATES_STORAGE_KEY = "zotlit-javascript-templates";

export interface TemplateServiceEvents {
  "compile-status-changed": () => void;
}

export interface TemplateServiceOptions {
  plugin: Plugin;
  app: App;
  settings: SettingsService;
}

export class TemplateService extends Service<void> {
  readonly #plugin;
  readonly #app;
  readonly #settings;
  readonly #facade = new TemplateFacade({
    transformRender: managedRegionTransform(MANAGED_CONTENT_TEMPLATE),
  });
  readonly #emitter = createNanoEvents<TemplateServiceEvents>();
  readonly #compileErrors = new Map<string, string>();
  readonly #shadowed = new Map<string, string>();
  readonly #inertEta = new Map<string, string>();
  readonly #pendingFlush = new Set<string>();
  readonly #autoPairExtensions: Extension[] = [];

  #javascriptTemplatesEnabled: boolean;

  /** Compiled managed-frontmatter fields, memoized by the settings array
   *  reference (which changes only when the list is mutated). */
  #lastFrontmatterFields: readonly FrontmatterField[] | null = null;
  #compiledFrontmatterFields: readonly CompiledFrontmatterField[] = [];
  #inertFrontmatterKeys: readonly string[] = [];

  #flushTimer: ReturnType<typeof setTimeout> | null = null;
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

  get compileErrors(): ReadonlyMap<string, string> {
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
      );
    }
    const compileError = this.#compileErrors.get(name);
    if (compileError !== undefined) {
      throw new Error(
        `Template '${name}' has a compile error:\n${compileError}`,
      );
    }
    return this.#facade.render(name, data);
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
    await this.#rebuildFolder(this.#lastTemplateFolder);

    stack.defer(this.#registerVaultEvents());
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
    const generation = ++this.#folderGeneration;
    this.#cancelFlush();
    this.#pendingFlush.clear();
    this.#shadowed.clear();
    this.#inertEta.clear();
    this.#facade.reset();
    this.#compileErrors.clear();

    const root =
      folder === ""
        ? this.#app.vault.getRoot()
        : this.#app.vault.getFolderByPath(folder);

    const names = new Set<string>();
    if (root) {
      for (const child of root.children) {
        if (child instanceof TFile) {
          const parsed = templateFileFromPath(child.path);
          if (parsed) names.add(parsed.name);
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

    await Promise.all(
      [...names].map((name) => this.#reconcileName(name, generation)),
    );
    if (generation !== this.#folderGeneration) return;

    this.#emitter.emit("compile-status-changed");
    logger.debug("Template folder rebuilt", {
      folder,
      count: names.size,
    });
  }

  #onCreateOrModify(file: TAbstractFile): void {
    if (!(file instanceof TFile)) return;
    this.#queueTemplateName(file.path);
  }

  #onRename(file: TAbstractFile, oldPathRaw: string): void {
    this.#queueTemplateName(oldPathRaw);
    if (file instanceof TFile) this.#queueTemplateName(file.path);
  }

  #onDelete(file: TAbstractFile): void {
    this.#queueTemplateName(file.path);
  }

  #queueTemplateName(path: string): void {
    const normalized = normalizeVaultPath(path);
    if (!this.#isWatchedTemplatePath(normalized)) return;
    const parsed = templateFileFromPath(normalized);
    if (!parsed) return;
    this.#pendingFlush.add(parsed.name);
    this.#scheduleFlush();
  }

  #scheduleFlush(): void {
    if (this.#flushTimer !== null) return;
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      void this.#flushPending();
    }, FLUSH_DEBOUNCE_MS);
  }

  async #flushPending(): Promise<void> {
    const generation = this.#folderGeneration;
    const names = [...this.#pendingFlush];
    this.#pendingFlush.clear();
    await Promise.all(
      names.map((name) => this.#reconcileName(name, generation)),
    );

    if (generation !== this.#folderGeneration) return;

    this.#emitter.emit("compile-status-changed");
    logger.debug("Template flush completed", { count: names.length });
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
      this.#compileErrors.set(name, errorMessage(error));
      logger.warn("Failed to compile vault template", { error, name });
      this.#facade.remove(name, language);
    }
  }

  /** Use a canonical name's package default (Liquid) when no vault override exists, else remove a non-canonical one. */
  #useDefault(name: string): void {
    this.#facade.remove(name, "eta");
    if (!isTemplateName(name)) {
      this.#facade.remove(name, "liquid");
      return;
    }
    try {
      this.#facade.define(name, DEFAULT_TEMPLATES[name], "liquid");
      this.#compileErrors.delete(name);
    } catch (error) {
      this.#compileErrors.set(name, errorMessage(error));
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

  #cancelFlush(): void {
    if (this.#flushTimer === null) return;
    clearTimeout(this.#flushTimer);
    this.#flushTimer = null;
  }

  #requireLoaded(method: string): void {
    if (!this.#loaded) {
      throw new Error(`TemplateService.${method}(): service is not ready`);
    }
  }
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
