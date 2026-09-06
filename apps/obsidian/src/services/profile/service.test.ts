import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TemplateFacade } from "@zotlit/templates/facade";

import * as m from "@/lib/i18n/generated/messages";
import type { ProfileId } from "@/lib/profile-stamp";

import { profileServiceFixture as harness } from "./__fixtures__/service";

const BOOKS = "Bk3Qn7XvT2Lp" as ProfileId;
const booksRule = {
  id: "books",
  filter: 'itemType == "book"',
  profile: BOOKS,
} as const;
const parseLiteratureNoteTemplate = (source: string) =>
  new TemplateFacade().parseLiteratureNoteTemplate(source);
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
--- zotlit:annotation ---\nAnnotation`;
}

describe("ProfileService", () => {
  it("prepares Default sharing with one fresh identity and frozen effective bindings, without writing", async () => {
    await using f = await harness();
    f.settings.updateDefaultLiteratureNoteProfileBindings({
      "note.literature-folder": "Reading",
      "note.import-folder": "Imported",
      "citation.references-style": "http://www.zotero.org/styles/apa",
    });
    const before = new Map(f.vault.contents);
    const plan = await f.profile.prepareShare("default");
    const options = {
      version: "1.0.1",
      author: "Research group",
      description: "Reading notes",
    };
    const output = plan.render(options);
    const exported = parseLiteratureNoteTemplate(output);
    expect(exported.manifest.id).not.toBe("default");
    expect(exported.manifest.id).toHaveLength(12);
    expect(plan.filename).toBe(
      `zotlit-profile.default-${exported.manifest.id}.md`,
    );
    expect(exported.manifest).toMatchObject({
      version: "1.0.1",
      author: "Research group",
      description: "Reading notes",
      citationStyle: "http://www.zotero.org/styles/apa",
    });
    expect(exported.manifest.folder).toBeUndefined();
    expect(exported.manifest.importFolder).toBeUndefined();
    f.settings.updateDefaultLiteratureNoteProfileBindings({
      "note.literature-folder": "Later",
    });
    expect(plan.render(options)).toBe(output);
    expect(
      parseLiteratureNoteTemplate(
        plan.render({ ...options, includeFolders: true }),
      ).manifest,
    ).toMatchObject({
      id: exported.manifest.id,
      folder: "Reading",
      importFolder: "Imported",
    });
    expect(f.vault.contents).toEqual(before);
    expect((await f.profile.prepareShare("default")).manifest.id).not.toBe(
      exported.manifest.id,
    );
  });

  it("shares an ejected Default and an installed Profile's own body, partials and identity", async () => {
    const defaultSource = document("default", "", "Default look");
    const booksSource = document(BOOKS).replace(
      "Managed",
      '{% render "summary" %}',
    );
    await using f = await harness({
      "templates/zotlit-profile.default.md": defaultSource,
      "templates/zotlit-profile.books.md": booksSource,
      "templates/zotlit-summary.liquid.md": "Shared partial",
    });
    const before = new Map(f.vault.contents);
    const plan = await f.profile.prepareShare(BOOKS);
    expect(plan.manifest.id).toBe(BOOKS);
    expect(plan.partials).toEqual(["summary"]);
    const output = plan.render({
      version: "2.0.0",
      author: "",
      description: "",
    });
    expect(parseLiteratureNoteTemplate(output)).toMatchObject({
      manifest: {
        id: BOOKS,
        version: "2.0.0",
        partials: [{ name: "summary", source: "Shared partial" }],
      },
      body: parseLiteratureNoteTemplate(booksSource).body,
    });
    expect(
      parseLiteratureNoteTemplate(
        (await f.profile.prepareShare("default")).render({
          version: "1.0.0",
          author: "",
          description: "",
        }),
      ).body,
    ).toBe(parseLiteratureNoteTemplate(defaultSource).body);
    expect(f.vault.contents).toEqual(before);
  });

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
    using update = vi.spyOn(fixture.settings, "update");
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
    expect(update).not.toHaveBeenCalled();
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

  it("imports one file with its incoming identity, metadata, and embedded partials, without touching notes", async () => {
    await using f = await harness();
    using stamp = vi.spyOn(f.app.fileManager, "processFrontMatter");
    const source = document(
      BOOKS,
      "folder: Sender\nimportFolder: Sender notes\npartials:\n  - name: shared\n    language: liquid\n    source: Shared body",
    );
    const plan = await f.profile.prepareImport(source, {
      folder: "Reading",
      stripFolders: true,
      citationStyle: null,
    });
    expect(plan.kind).toBe("fresh");
    expect(plan.manifest).toMatchObject({
      id: BOOKS,
      name: "Books",
      version: "1.0.0",
      folder: "Reading",
      citationStyle: null,
      partials: [{ name: "shared", source: "Shared body" }],
    });
    expect(plan.manifest.importFolder).toBeUndefined();
    expect(f.vault.files.size).toBe(0);
    const pending = plan.import();
    await vi.advanceTimersByTimeAsync(500);
    const imported = await pending;
    expect(imported.id).toBe(BOOKS);
    expect([...f.vault.files.keys()]).toEqual([
      "templates/zotlit-profile.books.md",
    ]);
    expect(f.vault.contents.get(imported.path)).toContain("Shared body");
    expect(stamp).not.toHaveBeenCalled();
  });

  it("offers Replace with the held version and real note counts, then changes only that document", async () => {
    await using f = await harness({
      "templates/zotlit-profile.renamed.md": document(),
      "Books/Paper.md": "Paper",
      "Imports/Note.md": "Note",
    });
    using stamp = vi.spyOn(f.app.fileManager, "processFrontMatter");
    using _cache = vi
      .spyOn(f.app.metadataCache, "getFileCache")
      .mockImplementation((file) => ({
        frontmatter:
          file.path === "Books/Paper.md"
            ? { "zotero-key": "PAPER234", "zotlit-profile": BOOKS }
            : file.path === "Imports/Note.md"
              ? { "zotero-note-key": "NTE23456", "zotlit-profile": BOOKS }
              : undefined,
      }));
    f.indexNotes();
    const source = document(BOOKS, "folder: New", "Books revised").replace(
      "version: 1.0.0",
      "version: 2.0.0",
    );
    const plan = await f.profile.prepareImport(source);
    expect(plan.kind).toBe("replace");
    if (plan.kind !== "replace") throw new Error("Expected replacement");
    expect(plan.held).toMatchObject({
      label: "Books",
      version: "1.0.0",
      literatureNotes: 1,
      importedNotes: 1,
    });
    expect(f.vault.contents.get(plan.path)).toContain("version: 1.0.0");
    const pending = plan.import();
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    expect(plan.path).toBe("templates/zotlit-profile.renamed.md");
    expect(f.vault.contents.get(plan.path)).toContain("version: 2.0.0");
    expect(f.vault.contents.get("Books/Paper.md")).toBe("Paper");
    expect(f.vault.contents.get("Imports/Note.md")).toBe("Note");
    expect(stamp).not.toHaveBeenCalled();
  });

  it("preserves included folders, supports clearing a folder, and refuses reserved or excluded IDs", async () => {
    await using f = await harness();
    const source = document(
      BOOKS,
      "folder: Sender\nimportFolder: Sender notes",
    );
    expect((await f.profile.prepareImport(source)).manifest).toMatchObject({
      folder: "Sender",
      importFolder: "Sender notes",
    });
    expect(
      (await f.profile.prepareImport(source, { folder: null })).manifest.folder,
    ).toBeUndefined();
    await expect(f.profile.prepareImport(document("default"))).rejects.toThrow(
      m.profile_import_default(),
    );
    f.vault.createFile("templates/zotlit-profile.one.md", document());
    f.vault.createFile("templates/zotlit-profile.two.md", document());
    await vi.advanceTimersByTimeAsync(500);
    await expect(f.profile.prepareImport(source)).rejects.toThrow(
      m.profile_import_excluded(),
    );
    expect(f.profile.profiles).toEqual([]);
  });

  it("refuses a stale Replace decision without overwriting a newer file", async () => {
    await using f = await harness({
      "templates/zotlit-profile.books.md": document(),
    });
    const plan = await f.profile.prepareImport(
      document().replace("1.0.0", "2.0.0"),
    );
    const newer = document().replace("1.0.0", "3.0.0");
    f.vault.modifyFile(plan.path, newer);
    const rejected = expect(plan.import()).rejects.toThrow(
      m.profile_import_changed(),
    );
    await Promise.all([vi.advanceTimersByTimeAsync(500), rejected]);
    expect(f.vault.contents.get(plan.path)).toBe(newer);
  });

  it("refuses a fresh import if its ID arrived while consent was open", async () => {
    await using f = await harness();
    const plan = await f.profile.prepareImport(document());
    f.vault.createFile("templates/zotlit-profile.arrived.md", document());
    const rejected = expect(plan.import()).rejects.toThrow(
      m.profile_import_changed(),
    );
    await Promise.all([vi.advanceTimersByTimeAsync(500), rejected]);
    expect([...f.vault.files.keys()]).toEqual([
      "templates/zotlit-profile.arrived.md",
    ]);
  });

  it("creates shareable documents with fresh IDs and refuses repeated or reserved labels", async () => {
    await using fixture = await harness();
    const { profile, vault } = fixture;
    const created = profile.create({
      label: "Reading group",
      bindings: { folder: "Reading" },
    });
    await vi.advanceTimersByTimeAsync(500);
    const entry = await created;
    expect(entry.id).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(entry.document).toBe("zotlit-profile.reading-group.md");
    expect(vault.contents.get(entry.path)).toContain(`id: ${entry.id}`);
    expect(
      profile.resolveProfile(entry.id)?.bindings["note.literature-folder"],
    ).toBe("Reading");
    await expect(
      profile.create({
        label: "Reading group",
        bindings: { folder: "Reading" },
      }),
    ).rejects.toThrow();
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
      const pending = profile.create({
        label: name,
        bindings: { folder: "Reading" },
      });
      await vi.advanceTimersByTimeAsync(500);
      expect((await pending).document).toBe(`zotlit-profile.${name}.md`);
    },
  );

  it("explains an unavailable look and a missing source document with recovery text", async () => {
    await using fixture = await harness({
      "templates/zotlit-profile.books.md": document(),
    });
    const unknown = "Qw8Er5Ty2Ui9" as ProfileId;
    await expect(fixture.profile.getSource(unknown)).rejects.toThrow(
      m.settings_profile_source_unavailable({ profile: unknown }),
    );
    fixture.vault.deleteFile("templates/zotlit-profile.books.md");
    await expect(fixture.profile.getSource(BOOKS)).rejects.toThrow(
      m.settings_profile_source_missing({
        document: "zotlit-profile.books.md",
      }),
    );
  });

  it("prepares the effective Default look and writes only differing bindings with the previewed stamp", async () => {
    await using fixture = await harness({
      "templates/zotlit-profile.default.md": document("default").replace(
        "# {{",
        "# Default {{",
      ),
    });
    const { profile, vault } = fixture;
    const draft = await profile.prepareCreate({
      label: "Reading",
      bindings: {
        folder: "Reading",
        citationStyle:
          profile.resolveProfile("default")!.bindings[
            "citation.references-style"
          ],
      },
    });
    expect(draft.source).toContain("# Default {{");
    expect(draft.source).not.toContain("citationStyle:");
    expect(draft.profile.stamp).toBe(`Reading (${draft.profile.selector})`);
    expect(vault.files.has("templates/zotlit-profile.reading.md")).toBe(false);
    const pending = draft.create();
    await vi.advanceTimersByTimeAsync(500);
    const created = await pending;
    expect(created.id).toBe(draft.profile.selector);
    expect(vault.contents.get(created.path)).toBe(draft.source);
  });

  it("refuses creation when explicit choices still equal Default", async () => {
    await using fixture = await harness();
    const base = fixture.profile.resolveProfile("default")!;
    await expect(
      fixture.profile.create({
        label: "Same",
        bindings: {
          folder: base.bindings["note.literature-folder"],
          citationStyle: base.bindings["citation.references-style"],
        },
      }),
    ).rejects.toThrow();
  });

  it("refuses a copied look identical to Default even when its source Profile has bindings", async () => {
    await using fixture = await harness({
      "templates/zotlit-profile.default.md": document("default"),
      "templates/zotlit-profile.books.md": document(BOOKS, "folder: Books"),
    });
    const draft = await fixture.profile.prepareCreate({
      label: "Same",
      look: BOOKS,
    });
    expect(draft.inherited).toEqual(["folder", "citationStyle", "look"]);
    await expect(draft.create()).rejects.toThrow();
    expect(fixture.vault.files.has("templates/zotlit-profile.same.md")).toBe(
      false,
    );
  });

  it("accepts a look whose Annotation Section alone differs from Default", async () => {
    await using fixture = await harness({
      "templates/zotlit-profile.default.md": document("default"),
    });
    const source = document("default");
    const section = parseLiteratureNoteTemplate(source).annotationSection;
    const draft = await fixture.profile.prepareCreate({
      label: "Annotations",
      source: `${source.slice(0, section.start)}Custom annotation`,
    });
    expect(draft.inherited).not.toContain("look");
    const pending = draft.create();
    await vi.advanceTimersByTimeAsync(500);
    const created = await pending;
    expect(
      parseLiteratureNoteTemplate(fixture.vault.contents.get(created.path)!)
        .annotationSection.source,
    ).toBe("Custom annotation");
  });

  it("duplicates the built-in Default body without ejecting Default", async () => {
    await using fixture = await harness();
    const source = await fixture.profile.getSource("default");
    const pending = fixture.profile.duplicate("default");
    await vi.advanceTimersByTimeAsync(500);
    const copied = await pending;
    expect(copied.id).not.toBe("default");
    expect(fixture.vault.contents.get(copied.path)?.split("---").at(-1)).toBe(
      source.split("---").at(-1),
    );
    expect(fixture.vault.files.has("templates/zotlit-profile.default.md")).toBe(
      false,
    );
  });

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

  it("carries the configured frontmatter fields into the ejected Default document", async () => {
    await using fixture = await harness();
    const { profile, vault, settings } = fixture;
    settings.update({
      "note.frontmatter-fields": [
        {
          key: "reading-status",
          expr: "'unread'",
          merge: "keep",
          language: "liquid",
        },
      ],
    });
    const pending = profile.ejectDefault();
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    const source = vault.contents.get("templates/zotlit-profile.default.md")!;
    expect(source).toContain("key: reading-status");
    expect(source).toContain("merge: keep");
    expect(source).not.toContain("key: title");
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
    document("default").replace("\n--- zotlit:annotation ---\nAnnotation", ""),
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

  it("reports deletion counts and moves both note kinds before trashing only the Profile document", async () => {
    const papers = "Rz9Wm4YfH6Kd" as ProfileId;
    await using fixture = await harness({
      "templates/zotlit-profile.books.md": document(),
      "templates/zotlit-profile.papers.md": document(
        papers,
        "folder: Papers\nimportFolder: Imported/Papers",
        "Papers",
      ),
      "templates/shared.liquid.md": "Shared partial",
      "Books/My title.md": "My reading text",
      "Imports/Child.md": "Imported text",
    });
    const { profile, vault, app } = fixture;
    const literature = vault.getFileByPath("Books/My title.md")!;
    const imported = vault.getFileByPath("Imports/Child.md")!;
    const frontmatters = new Map([
      [literature, { "zotero-key": "PAPER234", "zotlit-profile": BOOKS }],
      [imported, { "zotero-note-key": "NTE23456", "zotlit-profile": BOOKS }],
    ]);
    using _cache = vi
      .spyOn(app.metadataCache, "getFileCache")
      .mockImplementation((file) => ({ frontmatter: frontmatters.get(file) }));
    using _write = vi
      .spyOn(app.fileManager, "processFrontMatter")
      .mockImplementation(async (file, edit) => edit(frontmatters.get(file)!));
    const order: string[] = [];
    app.fileManager.renameFile = async (file, path) => {
      order.push(path);
      vault.renameFile(file.path, path);
    };
    using _trash = vi
      .spyOn(app.fileManager, "trashFile")
      .mockImplementation(async (file) => {
        order.push(file.path);
        vault.deleteFile(file.path);
      });
    fixture.indexNotes();
    const papersRule = { ...booksRule, id: "papers", profile: papers };
    fixture.settings.update({
      "profile.selection-rules": [booksRule, papersRule],
    });
    const plan = await profile.prepareDelete(BOOKS);
    expect(plan.literatureNotes).toEqual([literature]);
    expect(plan.importedNotes).toEqual([imported]);
    expect(plan.targets.map(({ profile }) => profile.selector)).toEqual([
      "default",
      papers,
    ]);
    // Only the rules that select Books are affected.
    expect(plan.rules).toEqual([booksRule]);
    const pending = profile.delete(BOOKS, papers, { move: true });
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toEqual({
      literatureNotes: 1,
      importedNotes: 1,
      movedFiles: 2,
    });
    expect(order).toEqual([
      "Papers/My title.md",
      "Imported/Papers/Child.md",
      "templates/zotlit-profile.books.md",
    ]);
    expect(frontmatters.get(literature)?.["zotlit-profile"]).toBe(
      "Papers (Rz9Wm4YfH6Kd)",
    );
    expect(frontmatters.get(imported)?.["zotlit-profile"]).toBe(
      "Papers (Rz9Wm4YfH6Kd)",
    );
    expect(vault.contents.get("Papers/My title.md")).toBe("My reading text");
    expect(vault.contents.get("templates/shared.liquid.md")).toBe(
      "Shared partial",
    );
    // The replacement moved the notes only: the rule still targets Books.
    expect(fixture.settings.current?.["profile.selection-rules"]).toEqual([
      booksRule,
      papersRule,
    ]);
    expect(profile.resolveProfile(BOOKS)).toBeUndefined();
  });

  it("lists referencing rules for a Profile no note uses and keeps them after deletion", async () => {
    await using fixture = await harness({
      "templates/zotlit-profile.books.md": document(),
    });
    const { profile, vault, settings } = fixture;
    settings.update({ "profile.selection-rules": [booksRule] });
    fixture.indexNotes();
    const plan = await profile.prepareDelete(BOOKS);
    expect(plan.literatureNotes).toEqual([]);
    expect(plan.importedNotes).toEqual([]);
    expect(plan.rules).toEqual([booksRule]);
    const pending = profile.delete(BOOKS, "default");
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toEqual({
      literatureNotes: 0,
      importedNotes: 0,
      movedFiles: 0,
    });
    expect(vault.files.has("templates/zotlit-profile.books.md")).toBe(false);
    expect(settings.current?.["profile.selection-rules"]).toEqual([booksRule]);
  });

  it("keeps rule references when the Profile document is removed outside ZotLit", async () => {
    await using fixture = await harness({
      "templates/zotlit-profile.books.md": document(),
    });
    const { profile, vault, settings } = fixture;
    settings.update({ "profile.selection-rules": [booksRule] });
    vault.deleteFile("templates/zotlit-profile.books.md");
    await vi.advanceTimersByTimeAsync(500);
    expect(profile.resolveProfile(BOOKS)).toBeUndefined();
    expect(settings.current?.["profile.selection-rules"]).toEqual([booksRule]);
  });

  it("keeps the Profile document when a requested note move fails", async () => {
    await using fixture = await harness({
      "templates/zotlit-profile.books.md": document(),
      "Books/Paper.md": "User text",
    });
    const { profile, vault, app } = fixture;
    using _cache = vi.spyOn(app.metadataCache, "getFileCache").mockReturnValue({
      frontmatter: { "zotero-key": "PAPER234", "zotlit-profile": BOOKS },
    });
    app.fileManager.renameFile = async () => {
      throw new Error("Destination occupied");
    };
    fixture.indexNotes();
    await expect(
      profile.delete(BOOKS, "default", { move: true }),
    ).rejects.toThrow("Destination occupied");
    expect(vault.contents.get("templates/zotlit-profile.books.md")).toBe(
      document(),
    );
    expect(vault.contents.get("Books/Paper.md")).toBe("User text");
  });
});
