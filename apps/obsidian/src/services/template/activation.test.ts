import type { App } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PROFILE } from "@/lib/profile-stamp";
import { ProfileService } from "@/services/profile/service";
import { SettingsService } from "@/services/settings/service";

import { LiteratureNoteTemplateMigrationService } from "./migration";
import { TemplateService } from "./service";
import { MockVault, PluginStub } from "./test-vault";

async function makeHarness(
  files: Record<string, string>,
  options?: { javascriptTemplates?: boolean; storedSettings?: unknown },
) {
  const vault = new MockVault();
  for (const [path, content] of Object.entries(files)) {
    vault.addFile(path, content);
  }
  const localStorage = new Map<string, unknown>(
    options?.javascriptTemplates ? [["zotlit-javascript-templates", "1"]] : [],
  );
  let layoutReady: (() => void) | undefined;
  const trashFile = vi.fn(async (file: { path: string }) => {
    vault.deleteFile(file.path);
  });
  const app = {
    vault,
    workspace: {
      updateOptions: vi.fn(),
      onLayoutReady: (callback: () => void) => {
        layoutReady = callback;
      },
    },
    fileManager: { trashFile },
    loadLocalStorage: (key: string) => localStorage.get(key) ?? null,
    saveLocalStorage: (key: string, data: unknown) => {
      if (data === null) localStorage.delete(key);
      else localStorage.set(key, data);
    },
  } as unknown as App;
  const plugin = new PluginStub(
    app,
    options?.storedSettings ?? { __VERSION__: 1 },
  );
  const noMigration = (raw: unknown) => raw;
  // Each service is owned from the moment it is constructed, so a startup that
  // fails halfway still disposes what it already built.
  await using stack = new AsyncDisposableStack();
  const settings = stack.use(
    new SettingsService({
      plugin,
      migrateLegacy: noMigration,
      migrateV1: noMigration,
      migrateV2: noMigration,
      migrateV3: noMigration,
      migrateV4: noMigration,
      migrateV5: noMigration,
      migrateV6: noMigration,
      migrateV7: noMigration,
      migrateV8: noMigration,
      migrateV9: noMigration,
    }),
  );
  await settings.ready;
  const template = stack.use(new TemplateService({ app, settings }));
  await template.ready;
  const openPrompt = vi.fn();
  const service = stack.use(
    new LiteratureNoteTemplateMigrationService({
      app,
      settings,
      template,
      loadVerificationData: async () => ({
        note: { title: "Paper" },
        filename: { citationKey: "smith2024" },
        annotation: null,
        citation: [{ citationKey: "smith2024" }],
      }),
      openPrompt,
    }),
  );
  await service.ready;
  const owned = stack.move();
  return {
    app,
    layoutReady: () => layoutReady?.(),
    openPrompt,
    service,
    settings,
    template,
    vault,
    plugin,
    trashFile,
    storedSettings: () => structuredClone(plugin.data),
    [Symbol.asyncDispose]: () => owned[Symbol.asyncDispose](),
  };
}

const legacyFiles = {
  "templates/zotlit-note.liquid.md": "Original note: {% render 'badge' %}",
  "templates/zotlit-cite.liquid.md": "Original citation: {% render 'badge' %}",
  "templates/zotlit-badge.liquid.md": "original badge",
};
const documents = [
  { path: "templates/zotlit-partial.badge.md", source: "accepted badge" },
  {
    path: "templates/zotlit-citation.md",
    source: "Accepted citation: {% render 'badge' %}",
  },
];

function originalRendering(template: TemplateService) {
  expect(template.render("note", {})).toBe("Original note: original badge");
  expect(template.render("cite", {})).toBe("Original citation: original badge");
  expect(template.getTemplateFileStatuses().length).toBeGreaterThan(0);
}

describe("conversion activation registry", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("holds original rendering during document creation and acceptance persistence", async () => {
    await using h = await makeHarness(legacyFiles, {
      storedSettings: {
        __VERSION__: 10,
        "template.folder": "templates",
        "note.template-conversion-pending": true,
      },
    });
    const created = Promise.withResolvers<void>();
    const continueCreate = Promise.withResolvers<void>();
    const flushEntered = Promise.withResolvers<void>();
    const continueFlush = Promise.withResolvers<void>();
    const create = h.vault.create.bind(h.vault);
    vi.spyOn(h.vault, "create").mockImplementation(async (path, source) => {
      const file = await create(path, source);
      if (path === documents[0]!.path) {
        created.resolve();
        await continueCreate.promise;
      }
      return file;
    });
    const save = h.plugin.saveData.bind(h.plugin);
    vi.spyOn(h.plugin, "saveData").mockImplementationOnce(async (data) => {
      flushEntered.resolve();
      await continueFlush.promise;
      await save(data);
    });
    const activation = h.service.activateDocuments({
      documents,
      legacyFiles: Object.keys(legacyFiles),
      kept: [],
      profilePath: null,
    });
    await created.promise;
    await vi.advanceTimersByTimeAsync(500);
    originalRendering(h.template);
    continueCreate.resolve();
    await flushEntered.promise;
    expect(h.settings.current?.["note.template-conversion-pending"]).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    originalRendering(h.template);
    continueFlush.resolve();
    await activation;
    expect(h.template.renderCitation([], "main")).toBe(
      "Accepted citation: accepted badge",
    );
    expect(h.template.render("badge", {})).toBe("accepted badge");
    expect(h.template.getTemplateFileStatuses()).toEqual([]);
  });

  it("publishes a coherent Profile, Citation, and Partial set when reconciliation reads are delayed", async () => {
    await using h = await makeHarness(legacyFiles, {
      storedSettings: {
        __VERSION__: 10,
        "template.folder": "templates",
        "note.template-conversion-pending": true,
      },
    });
    await using profiles = new ProfileService({
      app: h.app,
      settings: h.settings,
      template: h.template,
      libraryScope: {
        ready: Promise.resolve(),
        libraries: [],
        on: () => () => {},
      },
      noteIndex: {
        whenIndexed: async () => {},
        getNotesByProfile: () => ({ literatureNotes: [], importedNotes: [] }),
      },
    });
    await profiles.ready;
    const profile = {
      path: "templates/zotlit-profile.default.md",
      source: `---
id: default
name: Accepted
version: 1.0.0
author: ZotLit
description: Activation fixture
contract: 1
filename: accepted
---
Accepted note: {% render 'badge' %}
--- zotlit:annotation ---
Accepted annotation`,
    };
    const snapshot = () => {
      const selected = profiles.resolveProfile(DEFAULT_PROFILE)!;
      return [
        selected.settings["note.template-conversion-pending"]
          ? h.template.render("note", {})
          : selected.document
            ? (h.template
                .getLiteratureNoteTemplate(selected.document)
                ?.renderForCreate({}) ?? "missing profile")
            : "missing profile selection",
        h.template.renderCitation([{ citationKey: "original" }], "main"),
        h.template.render("badge", {}),
      ];
    };
    const original = snapshot();
    const observations: string[][] = [];
    const unsubscribe = h.settings.subscribe(() =>
      observations.push(snapshot()),
    );
    using _subscription = { [Symbol.dispose]: unsubscribe };
    using _profileEvents = {
      [Symbol.dispose]: profiles.on("changed", () =>
        observations.push(snapshot()),
      ),
    };
    let saved = false;
    const save = h.plugin.saveData.bind(h.plugin);
    vi.spyOn(h.plugin, "saveData").mockImplementation(async (data) => {
      await save(data);
      saved = true;
    });
    const readsAfterSave: string[] = [];
    const stagingReads: string[] = [];
    const entered = Promise.withResolvers<void>();
    const proceed = Promise.withResolvers<void>();
    const read = h.vault.cachedRead.getMockImplementation()!;
    h.vault.cachedRead.mockImplementation(async (file) => {
      if (saved) readsAfterSave.push(file.path);
      stagingReads.push(file.path);
      if (file.path === profile.path) {
        entered.resolve();
        await proceed.promise;
      }
      return read(file);
    });
    const activation = h.service.activateDocuments({
      documents: [...documents, profile],
      legacyFiles: Object.keys(legacyFiles),
      kept: [],
      profilePath: profile.path,
    });
    await entered.promise;
    observations.push(snapshot());
    proceed.resolve();
    await activation;
    const accepted = snapshot();
    expect(readsAfterSave).toEqual([]);
    expect(stagingReads).toContain("templates/zotlit-partial.badge.md");
    expect(stagingReads).not.toContain("templates/zotlit-badge.liquid.md");
    expect(accepted).toEqual([
      "Accepted note: accepted badge\n",
      "Accepted citation: accepted badge",
      "accepted badge",
    ]);
    for (const observed of observations) {
      expect([original, accepted]).toContainEqual(observed);
    }
  });

  it("preserves original rendering when a later document write fails", async () => {
    await using h = await makeHarness(legacyFiles, {
      storedSettings: {
        __VERSION__: 10,
        "template.folder": "templates",
        "note.template-conversion-pending": true,
      },
    });
    const entered = Promise.withResolvers<void>();
    const proceed = Promise.withResolvers<void>();
    const create = h.vault.create.bind(h.vault);
    vi.spyOn(h.vault, "create").mockImplementation(async (path, source) => {
      if (path === documents[1]!.path) {
        entered.resolve();
        await proceed.promise;
        throw new Error("Document write failed");
      }
      return create(path, source);
    });
    const activation = h.service.activateDocuments({
      documents,
      legacyFiles: Object.keys(legacyFiles),
      kept: [],
      profilePath: null,
    });
    const rejected = expect(activation).rejects.toThrow(
      "Document write failed",
    );
    await entered.promise;
    await vi.advanceTimersByTimeAsync(500);
    originalRendering(h.template);
    proceed.resolve();
    await rejected;
    originalRendering(h.template);
    expect(documents.map(({ path }) => h.vault.getFileByPath(path))).toEqual([
      null,
      null,
    ]);
    expect(h.settings.current?.["note.template-conversion-result"]).toBeNull();
  });

  it("preserves original rendering when acceptance persistence fails", async () => {
    await using h = await makeHarness(legacyFiles, {
      storedSettings: {
        __VERSION__: 10,
        "template.folder": "templates",
        "note.template-conversion-pending": true,
      },
    });
    const entered = Promise.withResolvers<void>();
    const proceed = Promise.withResolvers<void>();
    vi.spyOn(h.plugin, "saveData").mockImplementationOnce(async () => {
      entered.resolve();
      await proceed.promise;
      throw new Error("Acceptance save failed");
    });
    const activation = h.service.activateDocuments({
      documents,
      legacyFiles: Object.keys(legacyFiles),
      kept: [],
      profilePath: null,
    });
    const rejected = expect(activation).rejects.toThrow(
      "Acceptance save failed",
    );
    await entered.promise;
    await vi.advanceTimersByTimeAsync(500);
    originalRendering(h.template);
    proceed.resolve();
    await rejected;
    originalRendering(h.template);
    expect(documents.map(({ path }) => h.vault.getFileByPath(path))).toEqual([
      null,
      null,
    ]);
    expect(h.settings.current?.["note.template-conversion-result"]).toBeNull();
  });
});
