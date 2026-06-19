import { dirname } from "node:path/posix";
import {
  TFile,
  TFolder,
  type App,
  type EventRef,
  type Plugin,
  type TAbstractFile,
} from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsService } from "@/services/settings/service";

import { TemplateService } from "./service";

type VaultEvent = "create" | "modify" | "rename" | "delete";
type VaultCallback = (...args: unknown[]) => void;

class MockVault {
  readonly root = makeFolder("", null, this);
  readonly files = new Map<string, TFile>();
  readonly folders = new Map<string, TFolder>([["", this.root]]);
  readonly contents = new Map<string, string>();
  readonly cachedRead = vi.fn(async (file: TFile) => {
    return this.contents.get(file.path) ?? "";
  });

  #mtime = 1;
  readonly #listeners: Record<VaultEvent, Set<VaultCallback>> = {
    create: new Set(),
    modify: new Set(),
    rename: new Set(),
    delete: new Set(),
  };

  getRoot(): TFolder {
    return this.root;
  }

  getFolderByPath(path: string): TFolder | null {
    return this.folders.get(path) ?? null;
  }

  getFileByPath(path: string): TFile | null {
    return this.files.get(path) ?? null;
  }

  getConfig(name: "autoPairBrackets" | "autoPairMarkdown"): boolean {
    return name === "autoPairBrackets" || name === "autoPairMarkdown";
  }

  on(name: VaultEvent, callback: VaultCallback): EventRef {
    this.#listeners[name].add(callback);
    return { e: this, name, callback } as unknown as EventRef;
  }

  offref(ref: EventRef): void {
    const eventRef = ref as unknown as {
      name: VaultEvent;
      callback: VaultCallback;
    };
    this.#listeners[eventRef.name].delete(eventRef.callback);
  }

  addFile(path: string, content: string): TFile {
    const file = makeFile(path, this.#nextStat(content), this);
    this.files.set(path, file);
    this.contents.set(path, content);
    this.#ensureFolder(dirname(path)).children.push(file);
    return file;
  }

  createFile(path: string, content: string): TFile {
    const file = this.addFile(path, content);
    this.#emit("create", file);
    return file;
  }

  modifyFile(path: string, content: string): void {
    const file = this.files.get(path);
    if (!file) throw new Error(`Missing file: ${path}`);
    file.stat = this.#nextStat(content);
    this.contents.set(path, content);
    this.#emit("modify", file);
  }

  renameFile(oldPath: string, newPath: string): void {
    const file = this.files.get(oldPath);
    const content = this.contents.get(oldPath);
    if (!file || content === undefined)
      throw new Error(`Missing file: ${oldPath}`);

    this.#detach(file);
    this.files.delete(oldPath);
    this.contents.delete(oldPath);

    file.path = newPath;
    file.name = basename(newPath);
    file.basename = file.name.replace(/\.[^.]+$/, "");
    file.extension = file.name.split(".").at(-1) ?? "";
    file.parent = this.#ensureFolder(dirname(newPath));
    file.parent.children.push(file);
    this.files.set(newPath, file);
    this.contents.set(newPath, content);
    this.#emit("rename", file, oldPath);
  }

  deleteFile(path: string): void {
    const file = this.files.get(path);
    if (!file) throw new Error(`Missing file: ${path}`);
    this.#detach(file);
    this.files.delete(path);
    this.contents.delete(path);
    this.#emit("delete", file);
  }

  #ensureFolder(path: string): TFolder {
    const normalized = path === "." ? "" : path;
    const existing = this.folders.get(normalized);
    if (existing) return existing;

    const parent = this.#ensureFolder(dirname(normalized));
    const folder = makeFolder(normalized, parent, this);
    parent.children.push(folder);
    this.folders.set(normalized, folder);
    return folder;
  }

  #detach(file: TAbstractFile): void {
    const siblings = file.parent?.children;
    if (!siblings) return;
    const index = siblings.indexOf(file);
    if (index >= 0) siblings.splice(index, 1);
  }

  #nextStat(content: string) {
    const now = this.#mtime++;
    return {
      type: "file" as const,
      ctime: now,
      mtime: now,
      size: content.length,
    };
  }

  #emit(name: VaultEvent, ...args: unknown[]): void {
    for (const callback of this.#listeners[name]) {
      callback(...args);
    }
  }
}

class PluginStub {
  readonly editorExtensions: unknown[] = [];
  readonly editorSuggests: unknown[] = [];

  constructor(
    readonly app: App,
    public data: unknown,
  ) {}

  loadData(): Promise<unknown> {
    return Promise.resolve(this.data);
  }

  async saveData(data: unknown): Promise<void> {
    this.data = data;
  }

  registerEditorExtension(extension: unknown): void {
    this.editorExtensions.push(extension);
  }

  registerEditorSuggest(suggest: unknown): void {
    this.editorSuggests.push(suggest);
  }
}

interface Harness {
  app: App & { workspace: { updateOptions: ReturnType<typeof vi.fn> } };
  plugin: PluginStub;
  service: TemplateService;
  settings: SettingsService;
  vault: MockVault;
}

let harnesses: Harness[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  harnesses = [];
});

afterEach(async () => {
  for (const { service, settings } of harnesses.reverse()) {
    await service[Symbol.asyncDispose]();
    await settings[Symbol.asyncDispose]();
  }
  vi.useRealTimers();
});

describe("TemplateService", () => {
  it("renders embedded defaults when no vault file exists", async () => {
    const { service } = await makeHarness();

    expect(
      service.render("note", {
        title: "Paper",
        backlink: "zotero://select/items/1",
        attachments: [],
        annotations: [],
      }),
    ).toContain("# Paper");
  });

  it("renders a vault template when present", async () => {
    const vault = new MockVault();
    vault.addFile("ZtTemplates/zotlit-note.eta.md", "custom <%= zt.title %>");
    const { service } = await makeHarness({ vault });

    expect(service.render("note", { title: "Paper" })).toBe("custom Paper");
  });

  it("fails loudly for a broken vault template instead of falling back to the default", async () => {
    const vault = new MockVault();
    vault.addFile("ZtTemplates/zotlit-note.eta.md", "broken <%= ) %>");
    const { service } = await makeHarness({ vault });

    expect(() => service.render("note", { title: "Paper" })).toThrow();
    expect(service.compileErrors.get("note")).toBeDefined();
  });

  it("propagates a broken included template instead of rendering its default", async () => {
    const vault = new MockVault();
    vault.addFile("ZtTemplates/zotlit-content.eta.md", "broken <%= ) %>");
    const { service } = await makeHarness({ vault });

    expect(() =>
      service.render("note", {
        title: "Paper",
        backlink: "zotero://select/items/1",
        attachments: [],
        annotations: [],
      }),
    ).toThrow();
    expect(service.compileErrors.get("content")).toBeDefined();
  });

  it("recovers once a broken template is fixed by a later modify event", async () => {
    const vault = new MockVault();
    vault.addFile("ZtTemplates/zotlit-note.eta.md", "broken <%= ) %>");
    const { service } = await makeHarness({ vault });

    expect(() => service.render("note", { title: "A" })).toThrow();

    vault.modifyFile("ZtTemplates/zotlit-note.eta.md", "fixed <%= zt.title %>");
    await vi.advanceTimersByTimeAsync(500);

    expect(service.render("note", { title: "B" })).toBe("fixed B");
    expect(service.compileErrors.get("note")).toBeUndefined();
  });

  it("refreshes compiled templates after debounced vault modify events", async () => {
    const vault = new MockVault();
    vault.addFile("ZtTemplates/zotlit-note.eta.md", "first <%= zt.title %>");
    const { service } = await makeHarness({ vault });

    expect(service.render("note", { title: "A" })).toBe("first A");
    vault.modifyFile(
      "ZtTemplates/zotlit-note.eta.md",
      "second <%= zt.title %>",
    );

    await vi.advanceTimersByTimeAsync(500);

    expect(service.render("note", { title: "B" })).toBe("second B");
  });

  it("rebuilds templates when the template folder setting changes", async () => {
    const vault = new MockVault();
    vault.addFile("OtherTemplates/zotlit-note.eta.md", "other <%= zt.title %>");
    const { service, settings } = await makeHarness({ vault });

    settings.update({ "template.folder": "OtherTemplates" });
    await flushAsync();

    expect(service.render("note", { title: "Paper" })).toBe("other Paper");
  });

  it("drops non-canonical templates from the previous folder when it changes", async () => {
    const vault = new MockVault();
    vault.addFile("ZtTemplates/zotlit-custom.eta.md", "custom <%= zt.title %>");
    const { service, settings } = await makeHarness({ vault });

    expect(service.render("custom", { title: "Paper" })).toBe("custom Paper");

    settings.update({ "template.folder": "OtherTemplates" });
    await flushAsync();

    expect(() => service.render("custom", { title: "Paper" })).toThrow();
  });

  it("ignores template files in nested subfolders", async () => {
    const vault = new MockVault();
    vault.addFile(
      "ZtTemplates/nested/zotlit-note.eta.md",
      "nested <%= zt.title %>",
    );
    const { service } = await makeHarness({ vault });

    expect(
      service.render("note", {
        title: "Paper",
        backlink: "zotero://select/items/1",
        attachments: [],
        annotations: [],
      }),
    ).toContain("# Paper");
  });

  it("toggles the auto-pair extension array from settings", async () => {
    const { app, plugin, settings } = await makeHarness();
    const extensions = plugin.editorExtensions[0] as unknown[];

    expect(extensions).toHaveLength(0);

    settings.update({ "template.auto-pair-eta": true });

    expect(extensions).toHaveLength(1);
    expect(app.workspace.updateOptions).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes vault events on dispose", async () => {
    const vault = new MockVault();
    vault.addFile("ZtTemplates/zotlit-note.eta.md", "first <%= zt.title %>");
    const { service } = await makeHarness({ vault });

    await service[Symbol.asyncDispose]();
    vault.modifyFile(
      "ZtTemplates/zotlit-note.eta.md",
      "second <%= zt.title %>",
    );
    await vi.advanceTimersByTimeAsync(500);

    expect(vault.cachedRead).toHaveBeenCalledTimes(1);
  });
});

async function makeHarness(options?: {
  settings?: Record<string, unknown>;
  vault?: MockVault;
}): Promise<Harness> {
  const vault = options?.vault ?? new MockVault();
  const app = {
    vault,
    workspace: { updateOptions: vi.fn() },
  } as unknown as Harness["app"];
  const plugin = new PluginStub(app, {
    __VERSION__: 1,
    ...options?.settings,
  });
  const settings = new SettingsService({
    plugin,
    migrateLegacy: (raw) => raw,
  });
  await settings.ready;

  const service = new TemplateService({
    plugin: plugin as unknown as Plugin,
    app,
    settings,
  });
  await service.ready;

  const harness = { app, plugin, service, settings, vault };
  harnesses.push(harness);
  return harness;
}

function makeFolder(
  path: string,
  parent: TFolder | null,
  vault: unknown,
): TFolder {
  const folder = new TFolder();
  folder.vault = vault as never;
  folder.path = path;
  folder.name = basename(path);
  folder.parent = parent;
  folder.children = [];
  return folder;
}

function makeFile(path: string, stat: TFile["stat"], vault: MockVault): TFile {
  const file = new TFile();
  file.vault = vault as never;
  file.path = path;
  file.name = basename(path);
  file.basename = file.name.replace(/\.[^.]+$/, "");
  file.extension = file.name.split(".").at(-1) ?? "";
  file.parent = vault.getFolderByPath(dirname(path)) ?? vault.getRoot();
  file.stat = stat;
  return file;
}

function basename(path: string): string {
  return path.split("/").at(-1) ?? "";
}

async function flushAsync(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}
