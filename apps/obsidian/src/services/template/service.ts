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
import { TemplateEngine, type TemplateFunction } from "@zotlit/templates";
import { type AutoTrim } from "@zotlit/templates/constants";
import {
  compileFrontmatterFields,
  type CompiledFrontmatterField,
  type FrontmatterField,
} from "@zotlit/templates/frontmatter";
import { managedRegionTransform } from "@zotlit/templates/obsidian";

import { RESERVED_KEYS } from "@/lib/constants";
import { getLogger } from "@/lib/log";
import { Service } from "@/services/service-base";
import { type Settings } from "@/services/settings/schema";
import { type SettingsService } from "@/services/settings/service";

import {
  DEFAULT_TEMPLATES,
  isTemplateName,
  MANAGED_CONTENT_TEMPLATE,
  templateNameFromPath,
  TEMPLATE_NAMES,
} from "./defaults";
import { bracketExtension } from "./editor/bracket";
import { EtaSuggest } from "./editor/suggest";
import { normalizeVaultPath } from "./path";

const logger = getLogger("template");
const FLUSH_DEBOUNCE_MS = 500;

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
  readonly #engine = new TemplateEngine({
    transformRender: managedRegionTransform(MANAGED_CONTENT_TEMPLATE),
  });
  readonly #emitter = createNanoEvents<TemplateServiceEvents>();
  readonly #compileErrors = new Map<string, string>();
  readonly #pendingFlush = new Set<string>();
  readonly #autoPairExtensions: Extension[] = [];

  #filenameError: string | null = null;
  #filenameFn: TemplateFunction | null = null;

  /** Compiled managed-frontmatter fields, memoized by the settings array
   *  reference (which changes only when the list is mutated). */
  #lastFrontmatterFields: readonly FrontmatterField[] | null = null;
  #compiledFrontmatterFields: readonly CompiledFrontmatterField[] = [];

  #flushTimer: ReturnType<typeof setTimeout> | null = null;
  #folderGeneration = 0;
  #loaded = false;

  #lastTemplateFolder = "";
  #lastAutoTrim: [AutoTrim, AutoTrim] = [false, false];
  #lastAutoPairEta = false;
  #lastFilename = "";

  ready: Promise<void>;

  constructor(options: TemplateServiceOptions) {
    super();
    this.#plugin = options.plugin;
    this.#app = options.app;
    this.#settings = options.settings;
    this.ready = this.#load();
  }

  get compileErrors(): ReadonlyMap<string, string> {
    return this.#compileErrors;
  }

  /** Synchronous readiness check for callers that can't await {@link ready} —
   *  e.g. `dragstart` and `selectSuggestion` handlers. */
  get loaded(): boolean {
    return this.#loaded;
  }

  /** The note-filename expression's compile error, or `null` when it is valid. */
  get filenameError(): string | null {
    return this.#filenameError;
  }

  /**
   * Managed-frontmatter fields compiled from `note.frontmatter-fields`,
   * recompiled on settings change. Consumed by the note feature when writing a
   * note's frontmatter; reserved system keys are already filtered out.
   */
  get frontmatterFields(): readonly CompiledFrontmatterField[] {
    return this.#compiledFrontmatterFields;
  }

  on<K extends keyof TemplateServiceEvents>(
    event: K,
    cb: TemplateServiceEvents[K],
  ): () => void {
    return this.#emitter.on(event, cb);
  }

  /**
   * @throws when the named template has a recorded compile error; or `EtaError`
   *   when the engine cannot resolve or render it — including an `include()` of
   *   a template that failed to compile (such a template is left undefined, so
   *   rendering never silently falls back to a default).
   */
  render<T extends object>(name: string, data: T): string {
    this.#requireLoaded("render");
    const compileError = this.#compileErrors.get(name);
    if (compileError !== undefined) {
      throw new Error(
        `Template '${name}' has a compile error:\n${compileError}`,
      );
    }
    return this.#engine.render(name, data);
  }

  /**
   * Render the configured note-filename expression, compiled once on settings
   * change rather than per call.
   *
   * @returns the rendered name, or `""` when no filename expression is set (the
   *   caller falls back to the item key).
   * @throws when the filename expression has a compile error — note creation
   *   must fail loudly rather than silently name files from a broken template.
   */
  renderFilename<T extends object>(data: T): string {
    this.#requireLoaded("renderFilename");
    if (this.#filenameError !== null) {
      throw new Error(
        `Note filename template has a compile error:\n${this.#filenameError}`,
      );
    }
    if (this.#filenameFn === null) return "";
    return this.#engine.render(this.#filenameFn, data);
  }

  /** @returns `null` when valid, or the error message when the source fails to compile. */
  validateSource(source: string): string | null {
    return this.#compileSource(source).error;
  }

  /** Compile `source`, returning either the compiled function or the compile-error message — never both. */
  #compileSource(
    source: string,
  ): { fn: TemplateFunction; error: null } | { fn: null; error: string } {
    try {
      return { fn: this.#engine.compile(source), error: null };
    } catch (error) {
      return { fn: null, error: errorMessage(error) };
    }
  }

  async #load(): Promise<void> {
    const snapshot = await this.#settings.loaded;
    this.#lastTemplateFolder = normalizeVaultPath(snapshot["template.folder"]);
    this.#lastAutoTrim = [
      snapshot["template.auto-trim-leading"],
      snapshot["template.auto-trim-trailing"],
    ];
    this.#lastAutoPairEta = snapshot["template.auto-pair-eta"];
    this.#lastFilename = snapshot["template.filename"];
    this.#engine.setAutoTrim(this.#lastAutoTrim);
    this.#compileFilename(this.#lastFilename);
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
    const filename = settings["template.filename"];

    const folderChanged = folder !== this.#lastTemplateFolder;
    const autoTrimChanged =
      autoTrim[0] !== this.#lastAutoTrim[0] ||
      autoTrim[1] !== this.#lastAutoTrim[1];
    const autoPairChanged = autoPairEta !== this.#lastAutoPairEta;

    const filenameChanged = filename !== this.#lastFilename;
    const frontmatterFields = settings["note.frontmatter-fields"];

    this.#lastTemplateFolder = folder;
    this.#lastAutoTrim = autoTrim;
    this.#lastAutoPairEta = autoPairEta;
    this.#lastFilename = filename;

    if (frontmatterFields !== this.#lastFrontmatterFields) {
      this.#compileFrontmatter(frontmatterFields);
    }

    if (autoTrimChanged) {
      this.#engine.setAutoTrim(autoTrim);
      logger.debug("Template autoTrim changed", { autoTrim });
    }

    if (folderChanged) {
      void this.#rebuildFolder(folder).catch((error) => {
        logger.warn("Template folder rebuild failed", { error, folder });
      });
    }

    // The compiled filename fn embeds the active autoTrim, so recompile it
    // whenever either the expression or the trim config changes.
    if (filenameChanged || autoTrimChanged) this.#compileFilename(filename);

    if (autoPairChanged) this.#setAutoPairEnabled(autoPairEta, true);
  }

  async #rebuildFolder(folder: string): Promise<void> {
    const generation = ++this.#folderGeneration;
    this.#cancelFlush();
    this.#pendingFlush.clear();

    const root =
      folder === ""
        ? this.#app.vault.getRoot()
        : this.#app.vault.getFolderByPath(folder);

    const files: TFile[] = [];
    if (root) {
      for (const child of root.children) {
        if (
          child instanceof TFile &&
          templateNameFromPath(child.path) !== null
        ) {
          files.push(child);
        }
      }
    } else {
      logger.debug("Template folder not found; embedded defaults remain", {
        folder,
      });
    }

    const entries = await Promise.all(
      files.map(async (file) => {
        const content = await this.#app.vault.cachedRead(file);
        return [templateNameFromPath(file.path), content] as const;
      }),
    );
    if (generation !== this.#folderGeneration) return;

    this.#loadTemplates(entries);
    this.#emitter.emit("compile-status-changed");
    logger.debug("Template folder rebuilt", {
      folder,
      count: entries.length,
    });
  }

  #onCreateOrModify(file: TAbstractFile): void {
    if (!(file instanceof TFile)) return;
    const path = normalizeVaultPath(file.path);
    if (!this.#isWatchedTemplatePath(path)) return;
    this.#pendingFlush.add(path);
    this.#scheduleFlush();
  }

  #onRename(file: TAbstractFile, oldPathRaw: string): void {
    const oldPath = normalizeVaultPath(oldPathRaw);
    const oldWatched = this.#isWatchedTemplatePath(oldPath);
    const newPath = normalizeVaultPath(file.path);
    const newWatched =
      file instanceof TFile && this.#isWatchedTemplatePath(newPath);

    if (oldWatched) {
      this.#dropTemplatePath(oldPath);
      // The new side, when watched, emits after its flush; otherwise emit the
      // drop now so the setting tab reflects the revert to the package default.
      if (!newWatched) this.#emitter.emit("compile-status-changed");
    }

    if (newWatched) {
      this.#pendingFlush.add(newPath);
      this.#scheduleFlush();
    }
  }

  #onDelete(file: TAbstractFile): void {
    const path = normalizeVaultPath(file.path);
    if (!this.#isWatchedTemplatePath(path)) return;
    this.#dropTemplatePath(path);
    this.#emitter.emit("compile-status-changed");
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
    const paths = [...this.#pendingFlush];
    this.#pendingFlush.clear();
    await Promise.all(
      paths.map((path) => this.#readAndStore(path, generation)),
    );

    if (generation !== this.#folderGeneration) return;

    this.#emitter.emit("compile-status-changed");
    logger.debug("Template flush completed", { count: paths.length });
  }

  async #readAndStore(path: string, generation: number): Promise<void> {
    // Folder changes rebuild the full template set; stale reads from the old
    // folder must not redefine or drop templates loaded by the newer rebuild.
    if (generation !== this.#folderGeneration) return;

    const file = this.#app.vault.getFileByPath(path);
    if (!file || !this.#isWatchedTemplatePath(file.path)) {
      if (generation !== this.#folderGeneration) return;
      this.#dropTemplatePath(path);
      return;
    }

    const name = templateNameFromPath(path);
    if (!name) return;

    let content: string;
    try {
      content = await this.#app.vault.cachedRead(file);
    } catch (error) {
      if (generation !== this.#folderGeneration) return;
      this.#dropTemplatePath(path);
      logger.warn("Failed to read template file", { error, path });
      return;
    }

    if (generation !== this.#folderGeneration) return;
    this.#defineTemplate(name, content);
  }

  /**
   * Compile and register a vault template, recording any compile error. A
   * template that fails to compile is removed from the engine and never falls
   * back to a package default: it fails loudly through {@link render} and
   * through any template that `include()`s it, and surfaces in the setting tab.
   */
  #defineTemplate(name: string, content: string): void {
    try {
      this.#engine.define(name, content);
      this.#compileErrors.delete(name);
    } catch (error) {
      this.#compileErrors.set(name, errorMessage(error));
      logger.warn("Failed to compile vault template", { error, name });
      this.#engine.remove(name);
    }
  }

  /** Use a canonical name's package default when no vault override exists, else remove a non-canonical one. */
  #useDefault(name: string): void {
    if (!isTemplateName(name)) {
      this.#engine.remove(name);
      return;
    }
    try {
      this.#engine.define(name, DEFAULT_TEMPLATES[name]);
      this.#compileErrors.delete(name);
    } catch (error) {
      this.#compileErrors.set(name, errorMessage(error));
      logger.error("Built-in default template failed to compile", {
        error,
        name,
      });
      this.#engine.remove(name);
    }
  }

  #isWatchedTemplatePath(path: string): boolean {
    const currentFolder =
      this.#settings.current?.["template.folder"] ?? this.#lastTemplateFolder;
    return isWatchedTemplatePath(path, currentFolder);
  }

  #dropTemplatePath(path: string): void {
    this.#pendingFlush.delete(path);
    const name = templateNameFromPath(path);
    if (!name) return;
    this.#compileErrors.delete(name);
    this.#useDefault(name);
  }

  /** Replace the engine's entire template set with the folder's overrides, filling any canonical name they don't cover with its package default. */
  #loadTemplates(
    entries: ReadonlyArray<readonly [string | null, string]>,
  ): void {
    this.#engine.reset();
    this.#compileErrors.clear();
    const provided = new Set<string>();
    for (const [name, content] of entries) {
      if (!name) continue;
      provided.add(name);
      this.#defineTemplate(name, content);
    }
    for (const name of TEMPLATE_NAMES) {
      if (!provided.has(name)) this.#useDefault(name);
    }
  }

  #setAutoPairEnabled(enabled: boolean, updateWorkspace: boolean): void {
    this.#autoPairExtensions.length = 0;
    if (enabled) {
      this.#autoPairExtensions.push(bracketExtension(this.#app.vault));
    }
    if (updateWorkspace) this.#app.workspace.updateOptions();
  }

  /** Compile the filename expression with the active autoTrim, holding the
   *  function for reuse and recording any compile error. */
  #compileFilename(filename: string): void {
    if (filename) {
      const { fn, error } = this.#compileSource(filename);
      this.#filenameFn = fn;
      this.#filenameError = error;
    } else {
      this.#filenameFn = null;
      this.#filenameError = null;
    }
    this.#emitter.emit("compile-status-changed");
  }

  /** Compile the managed-frontmatter fields, dropping reserved keys the system
   *  owns so user and system keys stay disjoint, and hold them for reuse. */
  #compileFrontmatter(fields: readonly FrontmatterField[]): void {
    this.#lastFrontmatterFields = fields;
    this.#compiledFrontmatterFields = compileFrontmatterFields(
      fields.filter((field) => !RESERVED_KEYS.has(field.key)),
    );
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

/** A watched template is a `zotlit-<name>.eta.md` file directly inside `folder` (no recursion). */
function isWatchedTemplatePath(path: string, folder: string): boolean {
  const normalized = normalizeVaultPath(path);
  return (
    templateNameFromPath(normalized) !== null &&
    normalizeVaultPath(dirname(normalized)) === normalizeVaultPath(folder)
  );
}
