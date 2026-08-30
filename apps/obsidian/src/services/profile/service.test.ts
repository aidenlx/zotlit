import type { App, Plugin } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProfileId } from "@/lib/profile-stamp";
import { NoteIndex } from "@/services/note-index/service";
import { SettingsService } from "@/services/settings/service";
import { TemplateService } from "@/services/template/service";
import { MockVault, PluginStub } from "@/services/template/test-vault";

import { ProfileService } from "./service";

const BOOKS = "Bk3Qn7XvT2Lp" as ProfileId;
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function document(id = BOOKS as string, bindings = "", label = "Books") {
  return `---
id: ${id}
name: ${label}
version: 1.0.0
contract: 2
filename: "{{ zt.title }}"
${bindings}
---
# {{ zt.title }}
{% managed %}Managed{% endmanaged %}
{% annotation %}Annotation{% endannotation %}
`;
}

async function harness(files: Record<string, string> = {}) {
  await using stack = new AsyncDisposableStack();
  const vault = new MockVault();
  const metadataListeners = new Map<string, () => void>();
  for (const [path, source] of Object.entries(files))
    vault.addFile(path, source);
  const app = {
    vault,
    workspace: { updateOptions: vi.fn() },
    loadLocalStorage: () => null,
    metadataCache: {
      initialized: true,
      getFileCache: vi.fn(() => null),
      on: (name: string, callback: () => void) => {
        metadataListeners.set(name, callback);
        return { e: { offref: () => metadataListeners.delete(name) } };
      },
    },
    fileManager: {
      processFrontMatter: vi.fn(),
      trashFile: async (file: { path: string }) => vault.deleteFile(file.path),
    },
  } as unknown as App;
  const plugin = new PluginStub(app, { __VERSION__: 10 });
  const settings = stack.use(
    new SettingsService({
      plugin,
      migrateLegacy: (raw) => raw,
      migrateV1: (raw) => raw,
      migrateV2: (raw) => raw,
      migrateV3: (raw) => raw,
      migrateV4: (raw) => raw,
      migrateV5: (raw) => raw,
      migrateV6: (raw) => raw,
      migrateV7: (raw) => raw,
      migrateV8: (raw) => raw,
      migrateV9: (raw) => raw,
    }),
  );
  const template = stack.use(
    new TemplateService({ app, plugin: plugin as unknown as Plugin, settings }),
  );
  const noteIndex = stack.use(
    new NoteIndex({ app, plugin: plugin as unknown as Plugin }),
  );
  const profile = stack.use(
    new ProfileService({ app, settings, template, noteIndex }),
  );
  await profile.ready;
  const cleanup = stack.move();
  return {
    app,
    vault,
    settings,
    template,
    profile,
    indexNotes: () => metadataListeners.get("resolved")!(),
    [Symbol.asyncDispose]: () => cleanup.disposeAsync(),
  };
}

describe("ProfileService", () => {
  it("discovers direct Profile documents, inherits absent bindings, and preserves explicit null", async () => {
    await using fixture = await harness({
      "templates/zotlit-profile.books.md": document(
        BOOKS,
        "folder: Books\ncitationStyle: null",
      ),
      "templates/other.md": document("Other1234567"),
      "templates/nested/zotlit-profile.nested.md": document("Nested123456"),
    });
    const { profile, settings } = fixture;
    settings.updateDefaultLiteratureNoteProfileBindings({
      "citation.references-style": "apa",
      "note.import-folder": "My notes",
    });
    expect(
      profile.profiles.map(({ id, document }) => ({ id, document })),
    ).toEqual([{ id: BOOKS, document: "zotlit-profile.books.md" }]);
    expect(profile.resolveProfile(BOOKS)).toMatchObject({
      stamp: "Books (Bk3Qn7XvT2Lp)",
      bindings: {
        "note.literature-folder": "Books",
        "citation.references-style": null,
        "note.import-folder": "My notes",
      },
    });
    expect(profile.resolveProfile("Missing12345" as ProfileId)).toBeUndefined();
  });
  it("keeps manifest identity across rename and excludes both copies of a duplicate ID", async () => {
    await using fixture = await harness({
      "templates/zotlit-profile.books.md": document(),
    });
    const { vault, profile } = fixture;
    fixture.settings.update({ "note.last-used-profile": BOOKS });
    vault.renameFile(
      "templates/zotlit-profile.books.md",
      "templates/zotlit-profile.reading.md",
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(profile.resolveProfile(BOOKS)?.document).toBe(
      "zotlit-profile.reading.md",
    );
    vault.createFile("templates/zotlit-profile.copy.md", document());
    await vi.advanceTimersByTimeAsync(500);
    expect(profile.resolveProfile(BOOKS)).toBeUndefined();
    expect(fixture.settings.current!["note.last-used-profile"]).toBeNull();
    expect(profile.diagnostics).toEqual([
      expect.objectContaining({
        code: "duplicate-profile-id",
        path: "templates/zotlit-profile.copy.md",
        paths: [
          "templates/zotlit-profile.copy.md",
          "templates/zotlit-profile.reading.md",
        ],
      }),
      expect.objectContaining({
        code: "duplicate-profile-id",
        path: "templates/zotlit-profile.reading.md",
      }),
    ]);
    vault.deleteFile("templates/zotlit-profile.copy.md");
    await vi.advanceTimersByTimeAsync(500);
    expect(profile.resolveProfile(BOOKS)?.label).toBe("Books");
    vault.renameFile(
      "templates/zotlit-profile.reading.md",
      "templates/reading.md",
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(profile.profiles).toEqual([]);
  });

  it("creates shareable documents with fresh IDs and refuses repeated or reserved labels", async () => {
    await using fixture = await harness();
    const { profile, vault } = fixture;
    const created = profile.create({ label: "Reading group" });
    await vi.advanceTimersByTimeAsync(500);
    const entry = await created;
    expect(entry.id).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(entry.document).toBe("zotlit-profile.reading-group.md");
    expect(vault.contents.get(entry.path)).toContain(`id: ${entry.id}`);
    expect(
      profile.resolveProfile(entry.id)?.bindings["note.literature-folder"],
    ).toBe("literatures");
    await expect(profile.create({ label: "Reading group" })).rejects.toThrow();
    await expect(profile.create({ label: "Default" })).rejects.toThrow();
  });

  it.each(["liquid", "eta"])(
    "discovers %s Profile documents during initial scan and creation",
    async (name) => {
      await using fixture = await harness({
        [`templates/zotlit-profile.${name}.md`]: document(),
      });
      const { profile, vault } = fixture;
      expect(profile.resolveProfile(BOOKS)?.document).toBe(
        `zotlit-profile.${name}.md`,
      );
      vault.deleteFile(`templates/zotlit-profile.${name}.md`);
      await vi.advanceTimersByTimeAsync(500);
      const pending = profile.create({ label: name });
      await vi.advanceTimersByTimeAsync(500);
      expect((await pending).document).toBe(`zotlit-profile.${name}.md`);
    },
  );

  it("uses the dialog bindings as a replacement while inheriting omitted values", async () => {
    await using fixture = await harness();
    const { profile, vault } = fixture;
    const pending = profile.create({
      label: "New Profile",
      source: document(
        BOOKS,
        "folder: Sender\ncitationStyle: apa\nimportFolder: Sender notes\nimportColoredHighlights: true\nimportAnnotationsAsTemplate: true",
      ),
      bindings: { citationStyle: null },
    });
    await vi.advanceTimersByTimeAsync(500);
    const created = await pending;
    expect(profile.resolveProfile(created.id)?.bindings).toEqual({
      "note.literature-folder": "literatures",
      "citation.references-style": null,
      "note.import-folder": "zotero_notes",
      "note.import-colored-highlights": false,
      "note.import-annotations-as-template": false,
    });
    expect(vault.contents.get(created.path)).not.toContain("Sender");
  });

  it("numbers a duplicate label when a case-insensitive copy name exists", async () => {
    await using fixture = await harness({
      "templates/zotlit-profile.books.md": document(),
      "templates/zotlit-profile.copy.md": document(
        "Rz9Wm4YfH6Kd",
        "",
        "books copy",
      ),
    });
    const pending = fixture.profile.duplicate(BOOKS);
    const result = expect(pending).resolves.toMatchObject({
      label: "Books copy 2",
      document: "zotlit-profile.books-copy-2.md",
    });
    await Promise.all([vi.advanceTimersByTimeAsync(500), result]);
  });

  it("keeps repeated labels usable and diagnoses invalid documents", async () => {
    await using fixture = await harness({
      "templates/zotlit-profile.one.md": document(),
      "templates/zotlit-profile.two.md": document("Rz9Wm4YfH6Kd"),
      "templates/zotlit-profile.broken.md": document("invalid"),
    });
    const { profile } = fixture;
    expect(profile.profiles.map(({ id }) => id)).toEqual([
      BOOKS,
      "Rz9Wm4YfH6Kd",
    ]);
    expect(profile.diagnostics).toEqual([
      expect.objectContaining({
        code: "invalid-profile-document",
        path: "templates/zotlit-profile.broken.md",
      }),
    ]);
  });

  it("duplicates the body and bindings with a fresh identity and a free filename", async () => {
    await using fixture = await harness({
      "templates/zotlit-profile.books.md": document(
        BOOKS,
        "folder: Library\ncitationStyle: apa",
      ),
    });
    const { profile, vault } = fixture;
    vault.createFile("templates/zotlit-profile.books-copy.md", "User file");
    await vi.advanceTimersByTimeAsync(500);
    const pending = profile.duplicate(BOOKS);
    await vi.advanceTimersByTimeAsync(500);
    const copy = await pending;
    expect(copy.id).not.toBe(BOOKS);
    expect(copy.document).toBe(`zotlit-profile.books-copy-${copy.id}.md`);
    expect(profile.resolveProfile(copy.id)).toMatchObject({
      label: "Books copy",
      bindings: {
        "note.literature-folder": "Library",
        "citation.references-style": "apa",
      },
    });
    expect(vault.contents.get(copy.path)?.split("---").at(-1)).toBe(
      document().split("---").at(-1),
    );
    expect(vault.contents.get("templates/zotlit-profile.books-copy.md")).toBe(
      "User file",
    );
  });

  it("ejects and restores the default look without storing a document pointer", async () => {
    await using fixture = await harness();
    const { profile, vault, settings } = fixture;
    expect(profile.resolveProfile("default")?.document).toBeUndefined();
    const pending = profile.ejectDefault();
    await vi.advanceTimersByTimeAsync(500);
    expect((await pending).path).toBe("templates/zotlit-profile.default.md");
    expect(profile.resolveProfile("default")?.document).toBe(
      "zotlit-profile.default.md",
    );
    expect(vault.contents.get("templates/zotlit-profile.default.md")).toContain(
      "id: default",
    );
    expect(settings.current?.["note.default-profile"]).not.toHaveProperty(
      "document",
    );
    const restore = profile.restoreDefault();
    await vi.advanceTimersByTimeAsync(500);
    await restore;
    expect(vault.files.has("templates/zotlit-profile.default.md")).toBe(false);
    expect(profile.resolveProfile("default")?.document).toBeUndefined();
  });

  it("uses a renamed Default document for eject and restore actions", async () => {
    await using fixture = await harness({
      "templates/zotlit-profile.default.md": document("default"),
    });
    const { vault, profile } = fixture;
    vault.renameFile(
      "templates/zotlit-profile.default.md",
      "templates/zotlit-profile.custom.md",
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(profile.resolveProfile("default")?.document).toBe(
      "zotlit-profile.custom.md",
    );
    const eject = profile.ejectDefault();
    await vi.advanceTimersByTimeAsync(500);
    expect((await eject).path).toBe("templates/zotlit-profile.custom.md");
    expect(profile.diagnostics).toEqual([]);
    const restore = profile.restoreDefault();
    await vi.advanceTimersByTimeAsync(500);
    await restore;
    expect(vault.files.has("templates/zotlit-profile.custom.md")).toBe(false);
    expect(profile.resolveProfile("default")?.document).toBeUndefined();
  });

  it.each([
    document("default", "folder: Books"),
    document("default").replace(
      "{% annotation %}Annotation{% endannotation %}",
      "",
    ),
  ])("excludes an invalid renamed Default from a cold scan", async (source) => {
    await using fixture = await harness({
      "templates/zotlit-profile.custom.md": source,
    });
    expect(fixture.profile.resolveProfile("default")).toBeUndefined();
    expect(fixture.profile.defaultDocumentPath).toBe(
      "templates/zotlit-profile.custom.md",
    );
    expect(fixture.profile.diagnostics).toEqual([
      expect.objectContaining({
        code: "invalid-profile-document",
        path: "templates/zotlit-profile.custom.md",
      }),
    ]);
  });

  it("refuses default resolution while two documents claim its ID", async () => {
    await using fixture = await harness({
      "templates/zotlit-profile.default.md": document("default"),
      "templates/zotlit-profile.copy.md": document("default"),
    });
    const { profile } = fixture;
    expect(profile.resolveProfile("default")).toBeUndefined();
    expect(profile.diagnostics.map(({ code }) => code)).toEqual([
      "duplicate-profile-id",
      "duplicate-profile-id",
    ]);
  });

  it("re-stamps Literature and Imported Notes before trashing the Profile document", async () => {
    await using fixture = await harness({
      "templates/zotlit-profile.books.md": document(),
      "Books/Paper.md": "Paper",
      "Imports/Note.md": "Note",
      "Scratch.md": "Scratch",
    });
    const { profile, vault, app } = fixture;
    const frontmatters: Record<string, Record<string, unknown>> = {
      "Books/Paper.md": {
        "zotero-key": "PAPER234",
        "zotlit-profile": "Books (Bk3Qn7XvT2Lp)",
      },
      "Imports/Note.md": {
        "zotero-note-key": "NTE23456",
        "zotlit-profile": BOOKS,
      },
      "Scratch.md": { "zotlit-profile": BOOKS },
    };
    vi.mocked(app.metadataCache.getFileCache).mockImplementation((file) => ({
      frontmatter: frontmatters[file.path],
    }));
    vi.mocked(app.fileManager.processFrontMatter).mockImplementation(
      async (file, edit) => {
        edit(frontmatters[file.path]!);
      },
    );
    fixture.indexNotes();
    fixture.settings.update({ "note.last-used-profile": BOOKS });
    const pending = profile.delete(BOOKS, "default");
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    expect(frontmatters["Books/Paper.md"]).toEqual({
      "zotero-key": "PAPER234",
    });
    expect(frontmatters["Imports/Note.md"]).toEqual({
      "zotero-note-key": "NTE23456",
    });
    expect(frontmatters["Scratch.md"]).toEqual({ "zotlit-profile": BOOKS });
    expect(vault.files.has("templates/zotlit-profile.books.md")).toBe(false);
    expect(fixture.settings.current!["note.last-used-profile"]).toBeNull();
  });

  it("keeps the document when a note cannot be re-stamped", async () => {
    await using fixture = await harness({
      "templates/zotlit-profile.books.md": document(),
      "Paper.md": "Paper",
    });
    const { profile, vault, app } = fixture;
    vi.mocked(app.metadataCache.getFileCache).mockReturnValue({
      frontmatter: { "zotero-key": "PAPER234", "zotlit-profile": BOOKS },
    });
    vi.mocked(app.fileManager.processFrontMatter).mockRejectedValue(
      new Error("Read-only note"),
    );
    fixture.indexNotes();
    await expect(profile.delete(BOOKS, "default")).rejects.toThrow(
      "Read-only note",
    );
    expect(vault.files.has("templates/zotlit-profile.books.md")).toBe(true);
  });
});
