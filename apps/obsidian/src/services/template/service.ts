import { type Extension } from "@codemirror/state";
import { EtaError } from "eta/core";
import {
  TFile,
  Vault,
  type App,
  type EventRef,
  type Plugin,
  type TAbstractFile,
} from "obsidian";

import { getLogger } from "@/lib/log";
import { Service } from "@/services/service-base";
import { type AutoTrim, type Settings } from "@/services/settings/schema";
import { type SettingsService } from "@/services/settings/service";

import { EMBEDDED_DEFAULTS, fromFilename } from "./defaults";
import { bracketExtension } from "./editor/bracket";
import { EtaSuggest } from "./editor/suggest";
import { ObsidianEta } from "./eta";
import { isEtaTemplatePath, isPathInFolder, normalizeVaultPath } from "./path";

const logger = getLogger("template");
const FLUSH_DEBOUNCE_MS = 500;

interface CompileSnapshot {
  mtime: number;
  size: number;
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
  readonly #eta;
  readonly #contentMap = new Map<string, string>();
  readonly #compileSnapshots = new Map<string, CompileSnapshot>();
  readonly #pendingFlush = new Set<string>();
  readonly #autoPairExtensions: Extension[] = [];

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
    this.#eta = new ObsidianEta({
      getAutoTrim: () => this.#lastAutoTrim,
      getTemplateFolder: () => this.#lastTemplateFolder,
      prepareTemplate: (path) => this.#prepareTemplate(path),
      readTemplateContent: (path) => this.#readTemplateContent(path),
    });
    this.ready = this.#load();
  }

  /**
   * @throws EtaError when the template cannot be resolved, compiled, or
   *   rendered.
   */
  render<T>(name: string, data: T): string {
    this.#requireLoaded("render");
    return this.#eta.render(name, data as object);
  }

  /**
   * @throws EtaError when the source cannot be compiled or rendered.
   */
  renderString<T>(source: string, data: T): string {
    this.#requireLoaded("renderString");
    return this.#eta.renderString(source, data as object);
  }

  async #load(): Promise<void> {
    const snapshot = await this.#settings.loaded;
    this.#lastTemplateFolder = normalizeVaultPath(snapshot["template.folder"]);
    this.#lastAutoTrim = [
      snapshot["template.auto-trim-leading"],
      snapshot["template.auto-trim-trailing"],
    ];
    this.#lastAutoPairEta = snapshot["template.auto-pair-eta"];

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

    this.#lastTemplateFolder = folder;
    this.#lastAutoTrim = autoTrim;
    this.#lastAutoPairEta = autoPairEta;

    if (folderChanged) {
      void this.#rebuildFolder(folder).catch((error) => {
        logger.warn("Template folder rebuild failed", { error, folder });
      });
    } else if (autoTrimChanged) {
      this.#resetCompileCache();
      logger.debug("Template autoTrim changed; compile cache reset", {
        autoTrim,
      });
    }

    if (autoPairChanged) this.#setAutoPairEnabled(autoPairEta, true);
  }

  async #rebuildFolder(folder: string): Promise<void> {
    const generation = ++this.#folderGeneration;
    this.#cancelFlush();
    this.#pendingFlush.clear();
    this.#contentMap.clear();
    this.#compileSnapshots.clear();
    this.#resetCompileCache();

    const root =
      folder === ""
        ? this.#app.vault.getRoot()
        : this.#app.vault.getFolderByPath(folder);

    if (!root) {
      logger.debug("Template folder not found; embedded defaults remain", {
        folder,
      });
      return;
    }

    const files: TFile[] = [];
    Vault.recurseChildren(root, (file) => {
      if (file instanceof TFile && isWatchedTemplatePath(file.path, folder)) {
        files.push(file);
      }
    });

    const entries = await Promise.all(
      files.map(async (file) => {
        const content = await this.#app.vault.cachedRead(file);
        return [normalizeVaultPath(file.path), content] as const;
      }),
    );
    if (generation !== this.#folderGeneration) return;

    for (const [path, content] of entries) this.#contentMap.set(path, content);
    logger.debug("Template folder rebuilt", {
      folder,
      count: this.#contentMap.size,
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
      const previousContent = this.#contentMap.get(oldPath);
      this.#dropTemplatePath(oldPath);
      if (newWatched && previousContent !== undefined) {
        this.#contentMap.set(newPath, previousContent);
      }
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
  }

  #scheduleFlush(): void {
    if (this.#flushTimer !== null) return;
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      void this.#flushPending();
    }, FLUSH_DEBOUNCE_MS);
  }

  async #flushPending(): Promise<void> {
    const paths = [...this.#pendingFlush];
    this.#pendingFlush.clear();
    await Promise.all(paths.map((path) => this.#readAndStore(path)));

    for (const path of paths) this.#invalidateCompiled(path);
    logger.debug("Template flush completed", { count: paths.length });
  }

  async #readAndStore(path: string): Promise<void> {
    const file = this.#app.vault.getFileByPath(path);
    if (!file || !this.#isWatchedTemplatePath(file.path)) {
      this.#contentMap.delete(path);
      return;
    }

    try {
      this.#contentMap.set(path, await this.#app.vault.cachedRead(file));
    } catch (error) {
      this.#contentMap.delete(path);
      logger.warn("Failed to read template file", { error, path });
    }
  }

  #prepareTemplate(path: string): void {
    const normalizedPath = normalizeVaultPath(path);
    const file = this.#app.vault.getFileByPath(normalizedPath);
    if (!file) {
      this.#compileSnapshots.delete(normalizedPath);
      return;
    }

    const next = { mtime: file.stat.mtime, size: file.stat.size };
    const previous = this.#compileSnapshots.get(normalizedPath);
    if (
      !previous ||
      previous.mtime !== next.mtime ||
      previous.size !== next.size
    ) {
      this.#eta.templatesSync.remove(normalizedPath);
      this.#compileSnapshots.set(normalizedPath, next);
    }
  }

  #readTemplateContent(path: string): string {
    const normalizedPath = normalizeVaultPath(path);
    const loaded = this.#contentMap.get(normalizedPath);
    if (loaded !== undefined) return loaded;

    const fallback = fromFilename(normalizedPath, this.#lastTemplateFolder);
    if (fallback) {
      logger.debug("Using embedded template fallback", {
        template: fallback,
        path: normalizedPath,
      });
      return EMBEDDED_DEFAULTS[fallback];
    }

    throw new EtaError(`File '${normalizedPath}' not found`);
  }

  #isWatchedTemplatePath(path: string): boolean {
    const currentFolder =
      this.#settings.current?.["template.folder"] ?? this.#lastTemplateFolder;
    return isWatchedTemplatePath(path, currentFolder);
  }

  #dropTemplatePath(path: string): void {
    this.#pendingFlush.delete(path);
    this.#contentMap.delete(path);
    this.#invalidateCompiled(path);
  }

  #invalidateCompiled(path: string): void {
    this.#eta.templatesSync.remove(path);
    this.#compileSnapshots.delete(path);
  }

  #resetCompileCache(): void {
    this.#eta.templatesSync.reset();
    this.#eta.templatesAsync.reset();
    this.#eta.filepathCache = {};
  }

  #setAutoPairEnabled(enabled: boolean, updateWorkspace: boolean): void {
    this.#autoPairExtensions.length = 0;
    if (enabled) {
      this.#autoPairExtensions.push(bracketExtension(this.#app.vault));
    }
    if (updateWorkspace) this.#app.workspace.updateOptions();
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

function isWatchedTemplatePath(path: string, folder: string): boolean {
  return isEtaTemplatePath(path) && isPathInFolder(path, folder);
}
