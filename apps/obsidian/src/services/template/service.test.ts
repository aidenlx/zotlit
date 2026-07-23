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

import { evalFrontmatterFields } from "@zotlit/templates/frontmatter";

import { SettingsService } from "@/services/settings/service";

import { DEFAULT_TEMPLATES, templatePath } from "./defaults";
import { InertTemplateError } from "./errors";
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
  localStorage: Map<string, unknown>;
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
        notes: [],
      }),
    ).toContain("# Paper");
  });

  it("renders a vault template when present", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.eta.md", "custom <%= zt.title %>");
    const { service } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });

    expect(service.render("note", { title: "Paper" })).toBe("custom Paper");
  });

  it("fails loudly for a broken vault template instead of falling back to the default", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.eta.md", "broken <%= ) %>");
    const { service } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });

    expect(() => service.render("note", { title: "Paper" })).toThrow();
    expect(service.compileErrors.get("note")).toBeDefined();
  });

  it("propagates a broken included template instead of rendering its default", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-content.eta.md", "broken <%= ) %>");
    const { service } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });

    expect(() =>
      service.render("note", {
        title: "Paper",
        backlink: "zotero://select/items/1",
        attachments: [],
        annotations: [],
        notes: [],
      }),
    ).toThrow();
    expect(service.compileErrors.get("content")).toBeDefined();
  });

  it("records a compile error when a built-in default itself fails to compile", async () => {
    const original = DEFAULT_TEMPLATES.note;
    DEFAULT_TEMPLATES.note = "{% if zt.title %}";
    try {
      const { service } = await makeHarness();

      expect(() => service.render("note", { title: "Paper" })).toThrow();
      expect(service.compileErrors.get("note")).toBeDefined();
    } finally {
      DEFAULT_TEMPLATES.note = original;
    }
  });

  it("recovers once a broken template is fixed by a later modify event", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.eta.md", "broken <%= ) %>");
    const { service } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });

    expect(() => service.render("note", { title: "A" })).toThrow();

    vault.modifyFile("templates/zotlit-note.eta.md", "fixed <%= zt.title %>");
    await vi.advanceTimersByTimeAsync(500);

    expect(service.render("note", { title: "B" })).toBe("fixed B");
    expect(service.compileErrors.get("note")).toBeUndefined();
  });

  it("refreshes compiled templates after debounced vault modify events", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.eta.md", "first <%= zt.title %>");
    const { service } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });

    expect(service.render("note", { title: "A" })).toBe("first A");
    vault.modifyFile("templates/zotlit-note.eta.md", "second <%= zt.title %>");

    await vi.advanceTimersByTimeAsync(500);

    expect(service.render("note", { title: "B" })).toBe("second B");
  });

  it("refreshes a modified liquid template after debounced vault modify events", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.liquid.md", "first {{ zt.title }}");
    const { service } = await makeHarness({ vault });

    expect(service.render("note", { title: "A" })).toBe("first A");
    vault.modifyFile(
      "templates/zotlit-note.liquid.md",
      "second {{ zt.title }}",
    );

    await vi.advanceTimersByTimeAsync(500);

    expect(service.render("note", { title: "B" })).toBe("second B");
  });

  it("rebuilds templates when the template folder setting changes", async () => {
    const vault = new MockVault();
    vault.addFile("OtherTemplates/zotlit-note.eta.md", "other <%= zt.title %>");
    const { service, settings } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });

    settings.update({ "template.folder": "OtherTemplates" });
    await flushAsync();

    expect(service.render("note", { title: "Paper" })).toBe("other Paper");
  });

  it("ignores stale template reads after the template folder setting changes", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.eta.md", "first <%= zt.title %>");
    vault.addFile("OtherTemplates/zotlit-note.eta.md", "other <%= zt.title %>");
    const { service, settings } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });
    const staleRead = deferred<string>();

    vault.cachedRead.mockImplementation(async (file) => {
      if (file.path === "templates/zotlit-note.eta.md") {
        return await staleRead.promise;
      }
      return vault.contents.get(file.path) ?? "";
    });

    vault.modifyFile("templates/zotlit-note.eta.md", "stale <%= zt.title %>");
    await vi.advanceTimersByTimeAsync(500);

    settings.update({ "template.folder": "OtherTemplates" });
    await flushAsync();

    expect(service.render("note", { title: "A" })).toBe("other A");

    staleRead.resolve("stale <%= zt.title %>");
    await flushAsync();

    expect(service.render("note", { title: "B" })).toBe("other B");
  });

  it("ignores stale template read failures after the template folder setting changes", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.eta.md", "first <%= zt.title %>");
    vault.addFile("OtherTemplates/zotlit-note.eta.md", "other <%= zt.title %>");
    const { service, settings } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });
    const staleRead = deferred<string>();

    vault.cachedRead.mockImplementation(async (file) => {
      if (file.path === "templates/zotlit-note.eta.md") {
        return await staleRead.promise;
      }
      return vault.contents.get(file.path) ?? "";
    });

    vault.modifyFile("templates/zotlit-note.eta.md", "stale <%= zt.title %>");
    await vi.advanceTimersByTimeAsync(500);

    settings.update({ "template.folder": "OtherTemplates" });
    await flushAsync();

    expect(service.render("note", { title: "A" })).toBe("other A");

    staleRead.reject(new Error("stale read failed"));
    await flushAsync();

    expect(service.render("note", { title: "B" })).toBe("other B");
  });

  it("drops non-canonical templates from the previous folder when it changes", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-custom.eta.md", "custom <%= zt.title %>");
    const { service, settings } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });

    expect(service.render("custom", { title: "Paper" })).toBe("custom Paper");

    settings.update({ "template.folder": "OtherTemplates" });
    await flushAsync();

    expect(() => service.render("custom", { title: "Paper" })).toThrow();
  });

  it("ignores template files in nested subfolders", async () => {
    const vault = new MockVault();
    vault.addFile(
      "templates/nested/zotlit-note.eta.md",
      "nested <%= zt.title %>",
    );
    const { service } = await makeHarness({ vault });

    expect(
      service.render("note", {
        title: "Paper",
        backlink: "zotero://select/items/1",
        attachments: [],
        annotations: [],
        notes: [],
      }),
    ).toContain("# Paper");
  });

  it("renders a liquid override in place of the default", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.liquid.md", "custom {{ zt.title }}");
    const { service } = await makeHarness({ vault });

    expect(service.render("note", { title: "Paper" })).toBe("custom Paper");
  });

  it("prefers the liquid file over an eta file for the same name and reports the shadow", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.liquid.md", "L {{ zt.title }}");
    vault.addFile("templates/zotlit-note.eta.md", "E <%= zt.title %>");
    const { service } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });

    expect(service.render("note", { title: "Paper" })).toBe("L Paper");
    expect(service.shadowedFiles.get("note")).toBe(
      "templates/zotlit-note.eta.md",
    );
  });

  it("falls back to the eta file and clears the shadow when the liquid file is deleted", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.liquid.md", "L {{ zt.title }}");
    vault.addFile("templates/zotlit-note.eta.md", "E <%= zt.title %>");
    const { service } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });

    vault.deleteFile("templates/zotlit-note.liquid.md");
    await vi.advanceTimersByTimeAsync(500);

    expect(service.render("note", { title: "Paper" })).toBe("E Paper");
    expect(service.shadowedFiles.get("note")).toBeUndefined();
  });

  it("flips to a newly created liquid file over an existing eta override via the watcher", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.eta.md", "E <%= zt.title %>");
    const { service } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });

    expect(service.render("note", { title: "Paper" })).toBe("E Paper");

    vault.createFile("templates/zotlit-note.liquid.md", "L {{ zt.title }}");
    await vi.advanceTimersByTimeAsync(500);

    expect(service.render("note", { title: "Paper" })).toBe("L Paper");
    expect(service.shadowedFiles.get("note")).toBe(
      "templates/zotlit-note.eta.md",
    );
  });

  it("flips a name's language when its file is renamed across extensions", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.eta.md", "custom {{ zt.title }}");
    const { service } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });

    expect(service.render("note", { title: "Paper" })).toBe(
      "custom {{ zt.title }}",
    );

    vault.renameFile(
      "templates/zotlit-note.eta.md",
      "templates/zotlit-note.liquid.md",
    );
    await vi.advanceTimersByTimeAsync(500);

    expect(service.render("note", { title: "Paper" })).toBe("custom Paper");
  });

  it("fails loudly for a broken liquid winner without falling back to a healthy eta file", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.liquid.md", "{% if zt.title %}");
    vault.addFile("templates/zotlit-note.eta.md", "E <%= zt.title %>");
    const { service } = await makeHarness({ vault });

    expect(() => service.render("note", { title: "Paper" })).toThrow();
    expect(service.compileErrors.get("note")).toBeDefined();
  });

  it("renders an ejected default liquid file the same as the embedded default", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.liquid.md", DEFAULT_TEMPLATES.note);
    const { service } = await makeHarness({ vault });

    expect(
      service.render("note", {
        title: "Paper",
        backlink: "zotero://select/items/1",
        attachments: [],
        annotations: [],
        notes: [],
      }),
    ).toContain("# Paper");
  });

  it("templatePath emits the extension for the requested language", () => {
    expect(templatePath("templates", "note")).toBe(
      "templates/zotlit-note.liquid.md",
    );
    expect(templatePath("", "note", "eta")).toBe("zotlit-note.eta.md");
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
    vault.addFile("templates/zotlit-note.eta.md", "first <%= zt.title %>");
    const { service } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });

    await service[Symbol.asyncDispose]();
    vault.modifyFile("templates/zotlit-note.eta.md", "second <%= zt.title %>");
    await vi.advanceTimersByTimeAsync(500);

    expect(vault.cachedRead).toHaveBeenCalledTimes(1);
  });

  describe("filename template", () => {
    it("renders the embedded default when no filename file exists", async () => {
      const { service } = await makeHarness();

      expect(
        service.renderFilename({
          citationKey: "smith2024",
          DOI: null,
          title: "Paper",
          key: "AB12CD34",
        }),
      ).toBe("smith2024%zt-suffix:6:_:%");
      expect(
        service.renderFilename({
          citationKey: null,
          DOI: null,
          title: null,
          key: "AB12CD34",
        }),
      ).toBe("AB12CD34%zt-suffix:6:_:%");
    });

    it("renders a vault filename file in place of the default", async () => {
      const vault = new MockVault();
      vault.addFile(
        "templates/zotlit-filename.liquid.md",
        "custom-{{ zt.title }}",
      );
      const { service } = await makeHarness({ vault });

      expect(
        service.renderFilename({
          citationKey: null,
          DOI: null,
          title: "Paper",
          key: "AB12CD34",
        }),
      ).toBe("custom-Paper");
    });

    it("applies filename file edits through the watcher", async () => {
      const vault = new MockVault();
      vault.addFile(
        "templates/zotlit-filename.liquid.md",
        "custom-{{ zt.title }}",
      );
      const { service } = await makeHarness({ vault });

      vault.modifyFile(
        "templates/zotlit-filename.liquid.md",
        "updated-{{ zt.title }}",
      );
      await vi.advanceTimersByTimeAsync(500);

      expect(
        service.renderFilename({
          citationKey: null,
          DOI: null,
          title: "Paper",
          key: "AB12CD34",
        }),
      ).toBe("updated-Paper");
    });

    it("collapses multi-line filename output to a single trimmed line", async () => {
      const vault = new MockVault();
      vault.addFile(
        "templates/zotlit-filename.liquid.md",
        "{{ zt.title }}\n{% suffix %}\n",
      );
      const { service } = await makeHarness({ vault });

      expect(
        service.renderFilename({
          citationKey: null,
          DOI: null,
          title: "Paper",
          key: "AB12CD34",
        }),
      ).toBe("Paper%zt-suffix:6:_:%");
    });

    it("fails loudly for a broken filename file instead of falling back to the default", async () => {
      const vault = new MockVault();
      vault.addFile("templates/zotlit-filename.liquid.md", "{% if zt.title %}");
      const { service } = await makeHarness({ vault });

      expect(() =>
        service.renderFilename({
          citationKey: null,
          DOI: null,
          title: "Paper",
          key: "AB12CD34",
        }),
      ).toThrow();
      expect(service.compileErrors.get("filename")).toBeDefined();
    });

    it("renders an eta filename file when no liquid edition exists", async () => {
      const vault = new MockVault();
      vault.addFile("templates/zotlit-filename.eta.md", "<%= zt.title %>-eta");
      const { service } = await makeHarness({
        vault,
        javascriptTemplates: true,
      });

      expect(
        service.renderFilename({
          citationKey: null,
          DOI: null,
          title: "Paper",
          key: "AB12CD34",
        }),
      ).toBe("Paper-eta");
    });

    it("throws InertTemplateError for an eta-only filename file when the gate is off", async () => {
      const vault = new MockVault();
      vault.addFile("templates/zotlit-filename.eta.md", "<%= zt.title %>-eta");
      const { service } = await makeHarness({ vault });

      expect(() =>
        service.renderFilename({
          citationKey: null,
          DOI: null,
          title: "Paper",
          key: "AB12CD34",
        }),
      ).toThrow(InertTemplateError);
    });
  });
});

describe("javascript templates gate", () => {
  it("is off by default", async () => {
    const { service } = await makeHarness();

    expect(service.javascriptTemplatesEnabled).toBe(false);
  });

  it("throws InertTemplateError naming the file for an eta-only override when the gate is off", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.eta.md", "custom <%= zt.title %>");
    const { service } = await makeHarness({ vault });

    expect(() =>
      service.render("note", {
        title: "Paper",
        backlink: "zotero://select/items/1",
        attachments: [],
        annotations: [],
        notes: [],
      }),
    ).toThrow(InertTemplateError);
    expect(() => service.render("note", { title: "Paper" })).toThrow(
      "templates/zotlit-note.eta.md",
    );
    expect(service.inertEtaFiles.get("note")).toBe(
      "templates/zotlit-note.eta.md",
    );
    expect(service.compileErrors.get("note")).toBeUndefined();
  });

  it("reports a shadowed eta file as shadowed, not inert, even when the gate is off", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.liquid.md", "L {{ zt.title }}");
    vault.addFile("templates/zotlit-note.eta.md", "E <%= zt.title %>");
    const { service } = await makeHarness({ vault });

    expect(service.render("note", { title: "Paper" })).toBe("L Paper");
    expect(service.shadowedFiles.get("note")).toBe(
      "templates/zotlit-note.eta.md",
    );
    expect(service.inertEtaFiles.get("note")).toBeUndefined();
  });

  it("renders the eta override when the gate is pre-seeded on", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.eta.md", "custom <%= zt.title %>");
    const { service } = await makeHarness({
      vault,
      javascriptTemplates: true,
    });

    expect(service.render("note", { title: "Paper" })).toBe("custom Paper");
    expect(service.inertEtaFiles.size).toBe(0);
  });

  it("takes effect live when toggled, without a reload", async () => {
    const vault = new MockVault();
    vault.addFile("templates/zotlit-note.eta.md", "custom <%= zt.title %>");
    const { service, localStorage } = await makeHarness({ vault });
    const data = {
      title: "Paper",
      backlink: "zotero://select/items/1",
      attachments: [],
      annotations: [],
      notes: [],
    };

    expect(() => service.render("note", data)).toThrow(InertTemplateError);

    await service.setJavascriptTemplatesEnabled(true);

    expect(service.render("note", { title: "Paper" })).toBe("custom Paper");
    expect(service.inertEtaFiles.size).toBe(0);
    expect(localStorage.get("zotlit-javascript-templates")).toBe("1");

    await service.setJavascriptTemplatesEnabled(false);

    expect(() => service.render("note", data)).toThrow(InertTemplateError);
    expect(localStorage.has("zotlit-javascript-templates")).toBe(false);
  });

  it("never persists the flag through synced plugin settings", async () => {
    const { service, plugin, settings } = await makeHarness();

    await service.setJavascriptTemplatesEnabled(true);

    expect(JSON.stringify(plugin.data)).not.toContain("javascript-templates");
    expect(JSON.stringify(settings.current)).not.toContain(
      "javascript-templates",
    );
  });
});

describe("validateFrontmatterExpr", () => {
  it("validates liquid in its declared language regardless of the gate", async () => {
    const { service } = await makeHarness();

    expect(service.validateFrontmatterExpr("zt.title", "liquid")).toBeNull();
    expect(service.validateFrontmatterExpr("1 +", "liquid")).toEqual(
      expect.any(String),
    );
  });

  it("validates javascript in its declared language when the gate is on", async () => {
    const { service } = await makeHarness({ javascriptTemplates: true });

    expect(
      service.validateFrontmatterExpr("zt.title", "javascript"),
    ).toBeNull();
    expect(service.validateFrontmatterExpr("1 +", "javascript")).toEqual(
      expect.any(String),
    );
  });

  it("never compile-validates javascript while the gate is off", async () => {
    const { service } = await makeHarness();

    expect(service.validateFrontmatterExpr("1 +", "javascript")).toBeNull();
  });
});

describe("frontmatter fields", () => {
  it("compiles the default liquid fields and evaluates typed values with the gate off", async () => {
    const { service } = await makeHarness();

    expect(service.javascriptTemplatesEnabled).toBe(false);
    const result = evalFrontmatterFields(service.frontmatterFields, {
      title: "A Study",
      relatedItems: [{ indexedKey: "A1", noteLink: () => "[[Related A]]" }],
      collections: [{ path: ["Top", "Sub"] }],
    });

    expect(result).toEqual({
      title: "A Study",
      related: ["[[Related A]]"],
      collections: ["Top/Sub"],
    });
  });

  it("throws InertTemplateError naming the field when a javascript field is inert with the gate off", async () => {
    const { service } = await makeHarness({
      settings: {
        "note.frontmatter-fields": [
          {
            key: "note_liquid",
            expr: "zt.title",
            merge: "replace",
            language: "liquid",
          },
          {
            key: "note_js",
            expr: "zt.title",
            merge: "replace",
            language: "javascript",
          },
        ],
      },
    });

    expect(() => service.frontmatterFields).toThrow(InertTemplateError);
    expect(() => service.frontmatterFields).toThrow("note_js");
  });

  it("compiles and evaluates a javascript field when the gate is pre-seeded on, with no throw", async () => {
    const { service } = await makeHarness({
      settings: {
        "note.frontmatter-fields": [
          {
            key: "note_liquid",
            expr: "zt.title",
            merge: "replace",
            language: "liquid",
          },
          {
            key: "note_js",
            expr: "zt.title",
            merge: "replace",
            language: "javascript",
          },
        ],
      },
      javascriptTemplates: true,
    });

    expect(service.frontmatterFields.map((field) => field.key)).toEqual([
      "note_liquid",
      "note_js",
    ]);

    const result = evalFrontmatterFields(service.frontmatterFields, {
      title: "Hi",
    });
    expect(result).toEqual({ note_liquid: "Hi", note_js: "Hi" });
  });

  it("recompiles when note.frontmatter-fields changes via settings.update", async () => {
    const { service, settings } = await makeHarness();

    expect(service.frontmatterFields.map((field) => field.key)).toEqual([
      "title",
      "related",
      "collections",
    ]);

    settings.update({
      "note.frontmatter-fields": [
        {
          key: "custom",
          expr: "zt.title",
          merge: "replace",
          language: "liquid",
        },
      ],
    });

    expect(service.frontmatterFields.map((field) => field.key)).toEqual([
      "custom",
    ]);
  });

  it("keeps throwing across settings updates and gate flips", async () => {
    const { service, settings } = await makeHarness({
      settings: {
        "note.frontmatter-fields": [
          {
            key: "js1",
            expr: "zt.title",
            merge: "replace",
            language: "javascript",
          },
        ],
      },
    });

    expect(() => service.frontmatterFields).toThrow(InertTemplateError);

    settings.update({
      "note.frontmatter-fields": [
        {
          key: "js1",
          expr: "zt.title",
          merge: "replace",
          language: "javascript",
        },
        {
          key: "js2",
          expr: "zt.title",
          merge: "replace",
          language: "javascript",
        },
      ],
    });
    expect(() => service.frontmatterFields).toThrow(InertTemplateError);

    await service.setJavascriptTemplatesEnabled(true);
    expect(service.frontmatterFields.map((field) => field.key)).toEqual([
      "js1",
      "js2",
    ]);

    await service.setJavascriptTemplatesEnabled(false);
    expect(() => service.frontmatterFields).toThrow(InertTemplateError);
  });
});

async function makeHarness(options?: {
  settings?: Record<string, unknown>;
  vault?: MockVault;
  javascriptTemplates?: boolean;
}): Promise<Harness> {
  const vault = options?.vault ?? new MockVault();
  const localStorage = new Map<string, unknown>();
  if (options?.javascriptTemplates) {
    localStorage.set("zotlit-javascript-templates", "1");
  }
  const app = {
    vault,
    workspace: { updateOptions: vi.fn() },
    loadLocalStorage: (key: string) => localStorage.get(key) ?? null,
    saveLocalStorage: (key: string, data: unknown) => {
      if (data === null) localStorage.delete(key);
      else localStorage.set(key, data);
    },
  } as unknown as Harness["app"];
  const plugin = new PluginStub(app, {
    __VERSION__: 1,
    ...options?.settings,
  });
  const settings = new SettingsService({
    plugin,
    migrateLegacy: (raw) => raw,
    migrateV1: (raw) => raw,
  });
  await settings.ready;

  const service = new TemplateService({
    plugin: plugin as unknown as Plugin,
    app,
    settings,
  });
  await service.ready;

  const harness = { app, plugin, service, settings, vault, localStorage };
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

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}
