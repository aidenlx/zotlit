import { TestClock } from "effect/testing";
import { stringifyYaml } from "obsidian";
import { describe, expect, vi } from "vitest";

import { TemplateFacade } from "@zotlit/templates/facade";

import { Effect } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";
import * as m from "@/lib/i18n/generated/messages";
import { PROFILE_ID_LENGTH } from "@/lib/profile-stamp";
import type { ProfileId } from "@/lib/profile-stamp";

import { profileServiceFixture as harness } from "./__fixtures__/service";

const BOOKS = "Bk3Qn7XvT2Lp" as ProfileId;
const parseLiteratureNoteTemplate = (source: string) =>
  new TemplateFacade().parseLiteratureNoteTemplate(source);

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

/** A note's text: its Properties block over `body`. */
function noteText(properties: Record<string, unknown>, body: string): string {
  return `---\n${stringifyYaml(properties)}---\n${body}`;
}

describe("PlainProfile", () => {
  it.effect(
    "prepares Default sharing with one fresh identity and frozen effective bindings, without writing",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const f = yield* Effect.acquireDisposable(
          Effect.tryPromise(() => harness(undefined, undefined, context)),
        );
        f.bridge.runSync(
          f.settings.updateDefaultLiteratureNoteProfileBindings({
            "note.literature-folder": "Reading",
            "note.import-folder": "Imported",
            "citation.references-style": "http://www.zotero.org/styles/apa",
          }),
        );
        const before = new Map(f.vault.contents);
        const plan = yield* Effect.promise(() =>
          f.profile.prepareShare("default"),
        );
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
        f.bridge.runSync(
          f.settings.updateDefaultLiteratureNoteProfileBindings({
            "note.literature-folder": "Later",
          }),
        );
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
        expect(
          (yield* Effect.promise(() => f.profile.prepareShare("default")))
            .manifest.id,
        ).not.toBe(exported.manifest.id);
      }),
  );

  it.effect(
    "shares an ejected Default and an installed Profile's own body, partials and identity",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const defaultSource = document("default", "", "Default look");
        const booksSource = document(BOOKS).replace(
          "Managed",
          '{% render "summary" %}',
        );
        const f = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            harness(
              {
                "templates/zotlit-profile.default.md": defaultSource,
                "templates/zotlit-profile.books.md": booksSource,
                "templates/zotlit-partial.summary.md": "Shared partial",
              },
              undefined,
              context,
            ),
          ),
        );
        const before = new Map(f.vault.contents);
        const plan = yield* Effect.promise(() => f.profile.prepareShare(BOOKS));
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
            (yield* Effect.promise(() =>
              f.profile.prepareShare("default"),
            )).render({
              version: "1.0.0",
              author: "",
              description: "",
            }),
          ).body,
        ).toBe(parseLiteratureNoteTemplate(defaultSource).body);
        expect(f.vault.contents).toEqual(before);
      }),
  );

  it.effect(
    "bundles a partial the JavaScript gate left inert rather than reporting it absent",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const f = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            harness(
              {
                "templates/zotlit-profile.books.md": document(BOOKS).replace(
                  "Managed",
                  '{% render "scripted" %}',
                ),
                "templates/zotlit-partial.scripted.md":
                  "---\nlanguage: eta\n---\nScripted partial",
              },
              undefined,
              context,
            ),
          ),
        );
        const plan = yield* Effect.promise(() => f.profile.prepareShare(BOOKS));

        expect(plan.partials).toEqual(["scripted"]);
        expect(plan.missing).toEqual([]);
        expect(plan.reachable).toEqual(["scripted"]);
        expect(
          parseLiteratureNoteTemplate(
            plan.render({ version: "2.0.0", author: "", description: "" }),
          ).manifest.partials,
        ).toEqual([
          { name: "scripted", language: "eta", source: "Scripted partial" },
        ]);
      }),
  );

  it.effect(
    "discovers direct Profile documents, inherits absent bindings, and preserves explicit null",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const fixture = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            harness(
              {
                "templates/zotlit-profile.books.md": document(
                  BOOKS,
                  "folder: Books\ncitationStyle: null",
                ),
                "templates/other.md": document("Other1234567"),
                "templates/nested/zotlit-profile.nested.md":
                  document("Nested123456"),
              },
              undefined,
              context,
            ),
          ),
        );
        const { bridge, profile, settings } = fixture;
        bridge.runSync(
          settings.updateDefaultLiteratureNoteProfileBindings({
            "citation.references-style": "apa",
            "note.import-folder": "My notes",
          }),
        );
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
        expect(
          profile.resolveProfile("Missing12345" as ProfileId),
        ).toBeUndefined();
      }),
  );
  it.effect(
    "keeps manifest identity across rename and excludes both copies of a duplicate ID",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const fixture = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            harness(
              {
                "templates/zotlit-profile.books.md": document(),
              },
              undefined,
              context,
            ),
          ),
        );
        const { vault, profile } = fixture;
        const update = yield* Effect.acquireDisposable(
          Effect.sync(() => vi.spyOn(fixture.settings, "update")),
        );
        vault.renameFile(
          "templates/zotlit-profile.books.md",
          "templates/zotlit-profile.reading.md",
        );
        yield* TestClock.adjust(500);
        expect(profile.resolveProfile(BOOKS)?.document).toBe(
          "zotlit-profile.reading.md",
        );
        vault.createFile("templates/zotlit-profile.copy.md", document());
        yield* TestClock.adjust(500);
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
        yield* TestClock.adjust(500);
        expect(profile.resolveProfile(BOOKS)?.label).toBe("Books");
        vault.renameFile(
          "templates/zotlit-profile.reading.md",
          "templates/reading.md",
        );
        yield* TestClock.adjust(500);
        expect(profile.profiles).toEqual([]);
      }),
  );

  it.effect(
    "imports one file with its incoming identity, metadata, and embedded partials, without touching notes",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const f = yield* Effect.acquireDisposable(
          Effect.tryPromise(() => harness(undefined, undefined, context)),
        );
        const write = yield* Effect.acquireDisposable(
          Effect.sync(() => vi.spyOn(f.vault, "process")),
        );
        const source = document(
          BOOKS,
          "folder: Sender\nimportFolder: Sender notes\npartials:\n  - name: shared\n    language: liquid\n    source: Shared body",
        );
        const plan = yield* Effect.promise(() =>
          f.profile.prepareImport(source, {
            folder: "Reading",
            stripFolders: true,
            citationStyle: null,
          }),
        );
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
        expect(plan.partials).toEqual([
          {
            name: "shared",
            verdict: "write",
            document: "---\nlanguage: liquid\n---\nShared body",
          },
        ]);
        const pending = plan.import();
        // Two debounced template-folder reconciles: the one the import settles on
        // before it reads its target, then the one the files it writes raise.
        yield* TestClock.adjust(500);
        yield* TestClock.adjust(500);
        const imported = yield* Effect.promise(() => pending);
        expect(imported.id).toBe(BOOKS);
        // The bundle's partial becomes a file of its own, and the transport copy
        // it travelled in goes with it.
        expect([...f.vault.files.keys()].sort()).toEqual([
          "templates/zotlit-partial.shared.md",
          "templates/zotlit-profile.books.md",
        ]);
        expect(f.vault.contents.get("templates/zotlit-partial.shared.md")).toBe(
          "---\nlanguage: liquid\n---\nShared body",
        );
        expect(f.vault.contents.get(imported.path)).not.toContain(
          "Shared body",
        );
        expect(write).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    "skips a partial the vault already matches and replaces only the one approved",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const f = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            harness(
              {
                "templates/zotlit-partial.summary.md":
                  "---\nlanguage: liquid\n---\nShared body",
                "templates/zotlit-partial.authors.md": "Mine",
              },
              undefined,
              context,
            ),
          ),
        );
        const source = document(
          BOOKS,
          [
            "partials:",
            "  - name: summary",
            "    language: liquid",
            "    source: Shared body",
            "  - name: authors",
            "    language: liquid",
            "    source: Theirs",
          ].join("\n"),
        );
        const plan = yield* Effect.promise(() =>
          f.profile.prepareImport(source),
        );
        expect(
          plan.partials.map(({ name, verdict }) => `${name}:${verdict}`),
        ).toEqual(["summary:unchanged", "authors:conflict"]);

        // Nothing approved: the reader's own authors file stands untouched, and
        // its entry goes all the same — their document answers that name now.
        const pending = plan.import();
        // Two debounced template-folder reconciles: the one the import settles on
        // before it reads its target, then the one the files it writes raise.
        yield* TestClock.adjust(500);
        yield* TestClock.adjust(500);
        const imported = yield* Effect.promise(() => pending);
        expect(
          f.vault.contents.get("templates/zotlit-partial.authors.md"),
        ).toBe("Mine");
        expect(
          parseLiteratureNoteTemplate(f.vault.contents.get(imported.path)!)
            .manifest.partials,
        ).toBeUndefined();

        const replace = yield* Effect.promise(() =>
          f.profile.prepareImport(source),
        );
        const second = replace.import({ replacePartials: ["authors"] });
        yield* TestClock.adjust(500);
        yield* TestClock.adjust(500);
        const replaced = yield* Effect.promise(() => second);
        expect(
          f.vault.contents.get("templates/zotlit-partial.authors.md"),
        ).toBe("---\nlanguage: liquid\n---\nTheirs");
        expect(
          parseLiteratureNoteTemplate(f.vault.contents.get(replaced.path)!)
            .manifest.partials,
        ).toBeUndefined();
      }),
  );

  it.effect(
    "prepares a kept partial from the reader's file and a replacement from the bundle",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const f = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            harness(
              {
                "templates/zotlit-partial.authors.md": "Mine",
              },
              undefined,
              context,
            ),
          ),
        );
        const source = document(
          BOOKS,
          [
            "partials:",
            "  - name: summary",
            "    language: liquid",
            "    source: Their summary",
            "  - name: authors",
            "    language: liquid",
            "    source: Their authors",
          ].join("\n"),
        ).replace("Managed", '{% render "summary" %} {% render "authors" %}');
        const plan = yield* Effect.promise(() =>
          f.profile.prepareImport(source),
        );
        expect(
          parseLiteratureNoteTemplate(
            plan.previewSource(),
          ).manifest.partials?.map(({ name }) => name),
        ).toEqual(["summary"]);
        expect(
          parseLiteratureNoteTemplate(
            plan.previewSource({ replacePartials: ["authors"] }),
          ).manifest.partials?.map(({ name }) => name),
        ).toEqual(["summary", "authors"]);
      }),
  );

  it.effect(
    "renders a kept partial from the reader's own file, and the rest from the bundle",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const f = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            harness(
              {
                "templates/zotlit-partial.authors.md": "Mine",
              },
              undefined,
              context,
            ),
          ),
        );
        const source = document(
          BOOKS,
          [
            "partials:",
            "  - name: summary",
            "    language: liquid",
            "    source: Their summary",
            "  - name: authors",
            "    language: liquid",
            "    source: Their authors",
          ].join("\n"),
        ).replace("Managed", '{% render "summary" %} {% render "authors" %}');
        const plan = yield* Effect.promise(() =>
          f.profile.prepareImport(source),
        );
        const pending = plan.import();
        yield* TestClock.adjust(500);
        yield* TestClock.adjust(500);
        yield* Effect.promise(() => pending);

        // The reader kept their authors, so the Profile calls their file — and
        // summary, unpacked to a file of its own, still answers.
        expect(
          f.template
            .getLiteratureNoteTemplate("zotlit-profile.books.md")!
            .renderForCreate({ title: "First" }),
        ).toContain("Their summary Mine");
      }),
  );

  it.effect(
    "offers Replace with the held version and real note counts, then changes only that document",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const paper = noteText(
          { "zotero-key": "PAPER234", "zotlit-profile": BOOKS },
          "Paper",
        );
        const note = noteText(
          { "zotero-note-key": "NTE23456", "zotlit-profile": BOOKS },
          "Note",
        );
        const f = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            harness(
              {
                "templates/zotlit-profile.renamed.md": document(),
                "Books/Paper.md": paper,
                "Imports/Note.md": note,
              },
              undefined,
              context,
            ),
          ),
        );
        const source = document(BOOKS, "folder: New", "Books revised").replace(
          "version: 1.0.0",
          "version: 2.0.0",
        );
        const plan = yield* Effect.promise(() =>
          f.profile.prepareImport(source),
        );
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
        yield* TestClock.adjust(500);
        yield* Effect.promise(() => pending);
        expect(plan.path).toBe("templates/zotlit-profile.renamed.md");
        expect(f.vault.contents.get(plan.path)).toContain("version: 2.0.0");
        expect(f.vault.contents.get("Books/Paper.md")).toBe(paper);
        expect(f.vault.contents.get("Imports/Note.md")).toBe(note);
      }),
  );

  it.effect(
    "preserves included folders, supports clearing a folder, and refuses reserved or excluded IDs",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const f = yield* Effect.acquireDisposable(
          Effect.tryPromise(() => harness(undefined, undefined, context)),
        );
        const source = document(
          BOOKS,
          "folder: Sender\nimportFolder: Sender notes",
        );
        expect(
          (yield* Effect.promise(() => f.profile.prepareImport(source)))
            .manifest,
        ).toMatchObject({
          folder: "Sender",
          importFolder: "Sender notes",
        });
        expect(
          (yield* Effect.promise(() =>
            f.profile.prepareImport(source, { folder: null }),
          )).manifest.folder,
        ).toBeUndefined();
        yield* Effect.promise(() =>
          expect(f.profile.prepareImport(document("default"))).rejects.toThrow(
            m.profile_import_default(),
          ),
        );
        // The catalog states the length as its own literal, so hold it to the
        // pattern PROFILE_ID_LENGTH builds rather than letting the copy drift.
        expect(m.settings_profile_id_invalid()).toContain(
          String(PROFILE_ID_LENGTH),
        );
        yield* Effect.promise(() =>
          expect(
            f.profile.prepareImport(document("my-profile-1")),
          ).rejects.toThrow(m.settings_profile_id_invalid()),
        );
        f.vault.createFile("templates/zotlit-profile.one.md", document());
        f.vault.createFile("templates/zotlit-profile.two.md", document());
        yield* TestClock.adjust(500);
        yield* Effect.promise(() =>
          expect(f.profile.prepareImport(source)).rejects.toThrow(
            m.profile_import_excluded(),
          ),
        );
        expect(f.profile.profiles).toEqual([]);
      }),
  );

  it.effect(
    "refuses a stale Replace decision without overwriting a newer file",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const f = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            harness(
              {
                "templates/zotlit-profile.books.md": document(),
              },
              undefined,
              context,
            ),
          ),
        );
        const plan = yield* Effect.promise(() =>
          f.profile.prepareImport(document().replace("1.0.0", "2.0.0")),
        );
        const newer = document().replace("1.0.0", "3.0.0");
        f.vault.modifyFile(plan.path, newer);
        const rejected = expect(plan.import()).rejects.toThrow(
          m.profile_import_changed(),
        );
        yield* Effect.all(
          [TestClock.adjust(500), Effect.promise(() => rejected)],
          { concurrency: "unbounded" },
        );
        expect(f.vault.contents.get(plan.path)).toBe(newer);
      }),
  );

  it.effect(
    "refuses a fresh import if its ID arrived while consent was open",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const f = yield* Effect.acquireDisposable(
          Effect.tryPromise(() => harness(undefined, undefined, context)),
        );
        const plan = yield* Effect.promise(() =>
          f.profile.prepareImport(document()),
        );
        f.vault.createFile("templates/zotlit-profile.arrived.md", document());
        const rejected = expect(plan.import()).rejects.toThrow(
          m.profile_import_changed(),
        );
        yield* Effect.all(
          [TestClock.adjust(500), Effect.promise(() => rejected)],
          { concurrency: "unbounded" },
        );
        expect([...f.vault.files.keys()]).toEqual([
          "templates/zotlit-profile.arrived.md",
        ]);
      }),
  );

  it.effect(
    "creates shareable documents with fresh IDs and refuses repeated or reserved labels",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const fixture = yield* Effect.acquireDisposable(
          Effect.tryPromise(() => harness(undefined, undefined, context)),
        );
        const { profile, vault } = fixture;
        const created = profile.create({
          label: "Reading group",
          bindings: { folder: "Reading" },
        });
        yield* TestClock.adjust(500);
        const entry = yield* Effect.promise(() => created);
        expect(entry.id).toMatch(/^[A-Za-z0-9]{12}$/);
        expect(entry.document).toBe("zotlit-profile.reading-group.md");
        expect(vault.contents.get(entry.path)).toContain(`id: ${entry.id}`);
        expect(
          profile.resolveProfile(entry.id)?.bindings["note.literature-folder"],
        ).toBe("Reading");
        yield* Effect.promise(() =>
          expect(
            profile.create({
              label: "Reading group",
              bindings: { folder: "Reading" },
            }),
          ).rejects.toThrow(),
        );
        yield* Effect.promise(() =>
          expect(profile.create({ label: "Default" })).rejects.toThrow(),
        );
      }),
  );

  it.effect.each(["liquid", "eta"])(
    "discovers %s Profile documents during initial scan and creation",
    (name) =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const fixture = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            harness(
              {
                [`templates/zotlit-profile.${name}.md`]: document(),
              },
              undefined,
              context,
            ),
          ),
        );
        const { profile, vault } = fixture;
        expect(profile.resolveProfile(BOOKS)?.document).toBe(
          `zotlit-profile.${name}.md`,
        );
        vault.deleteFile(`templates/zotlit-profile.${name}.md`);
        yield* TestClock.adjust(500);
        const pending = profile.create({
          label: name,
          bindings: { folder: "Reading" },
        });
        yield* TestClock.adjust(500);
        expect((yield* Effect.promise(() => pending)).document).toBe(
          `zotlit-profile.${name}.md`,
        );
      }),
  );

  it.effect(
    "explains an unavailable look and a missing source document with recovery text",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const fixture = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            harness(
              {
                "templates/zotlit-profile.books.md": document(),
              },
              undefined,
              context,
            ),
          ),
        );
        const unknown = "Qw8Er5Ty2Ui9" as ProfileId;
        yield* Effect.promise(() =>
          expect(fixture.profile.getSource(unknown)).rejects.toThrow(
            m.settings_profile_source_unavailable({ profile: unknown }),
          ),
        );
        fixture.vault.deleteFile("templates/zotlit-profile.books.md");
        yield* Effect.promise(() =>
          expect(fixture.profile.getSource(BOOKS)).rejects.toThrow(
            m.settings_profile_source_missing({
              document: "zotlit-profile.books.md",
            }),
          ),
        );
      }),
  );

  it.effect("reports creation constraints separately from saving", () =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const fixture = yield* Effect.acquireDisposable(
        Effect.tryPromise(() => harness(undefined, undefined, context)),
      );
      const unnamed = yield* Effect.promise(() =>
        fixture.profile.prepareCreate({ label: "" }),
      );
      expect(unnamed.constraint?.kind).toBe("invalid-name");
      yield* Effect.promise(() =>
        expect(unnamed.create()).rejects.toThrow(
          m.settings_profile_name_invalid(),
        ),
      );
      expect([...fixture.vault.files.keys()]).toEqual([]);
    }),
  );

  it.effect(
    "prepares the effective Default look and writes only differing bindings with the previewed stamp",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const fixture = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            harness(
              {
                "templates/zotlit-profile.default.md": document(
                  "default",
                ).replace("# {{", "# Default {{"),
              },
              undefined,
              context,
            ),
          ),
        );
        const { profile, vault } = fixture;
        const draft = yield* Effect.promise(() =>
          profile.prepareCreate({
            label: "Reading",
            bindings: {
              folder: "Reading",
              citationStyle:
                profile.resolveProfile("default")!.bindings[
                  "citation.references-style"
                ],
            },
          }),
        );
        expect(draft.source).toContain("# Default {{");
        expect(draft.source).not.toContain("citationStyle:");
        expect(draft.profile.stamp).toBe(`Reading (${draft.profile.selector})`);
        expect(vault.files.has("templates/zotlit-profile.reading.md")).toBe(
          false,
        );
        const pending = draft.create();
        yield* TestClock.adjust(500);
        const created = yield* Effect.promise(() => pending);
        expect(created.id).toBe(draft.profile.selector);
        expect(vault.contents.get(created.path)).toBe(draft.source);
      }),
  );

  it.effect(
    "creates a Profile from a copied look identical to Default without its source Profile's bindings",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const fixture = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            harness(
              {
                "templates/zotlit-profile.default.md": document("default"),
                "templates/zotlit-profile.books.md": document(
                  BOOKS,
                  "folder: Books",
                ),
              },
              undefined,
              context,
            ),
          ),
        );
        const draft = yield* Effect.promise(() =>
          fixture.profile.prepareCreate({
            label: "Same",
            look: BOOKS,
          }),
        );
        expect(draft.inherited).toEqual(["folder", "citationStyle", "look"]);
        const pending = draft.create();
        yield* TestClock.adjust(500);
        const created = yield* Effect.promise(() => pending);
        expect(fixture.vault.contents.get(created.path)).not.toContain(
          "folder: Books",
        );
      }),
  );

  it.effect(
    "accepts a look whose Annotation Section alone differs from Default",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const fixture = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            harness(
              {
                "templates/zotlit-profile.default.md": document("default"),
              },
              undefined,
              context,
            ),
          ),
        );
        const source = document("default");
        const section = parseLiteratureNoteTemplate(source).annotationSection;
        const draft = yield* Effect.promise(() =>
          fixture.profile.prepareCreate({
            label: "Annotations",
            source: `${source.slice(0, section.start)}Custom annotation`,
          }),
        );
        expect(draft.inherited).not.toContain("look");
        const pending = draft.create();
        yield* TestClock.adjust(500);
        const created = yield* Effect.promise(() => pending);
        expect(
          parseLiteratureNoteTemplate(fixture.vault.contents.get(created.path)!)
            .annotationSection.source,
        ).toBe("Custom annotation");
      }),
  );

  it.effect("gives the built-in Default document a create-once body", () =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const fixture = yield* Effect.acquireDisposable(
        Effect.tryPromise(() => harness(undefined, undefined, context)),
      );
      const document = parseLiteratureNoteTemplate(
        yield* Effect.promise(() => fixture.profile.getSource("default")),
      );
      const { body } = document;

      expect(document.managedBlock).toBeNull();
      expect(body).toContain("## Annotations\n\n```zotquery\n");
      expect(body).not.toContain("## Notes");
    }),
  );

  it.effect(
    "duplicates the built-in Default body without ejecting Default",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const fixture = yield* Effect.acquireDisposable(
          Effect.tryPromise(() => harness(undefined, undefined, context)),
        );
        const source = yield* Effect.promise(() =>
          fixture.profile.getSource("default"),
        );
        const pending = fixture.profile.duplicate("default");
        yield* TestClock.adjust(500);
        const copied = yield* Effect.promise(() => pending);
        expect(copied.id).not.toBe("default");
        expect(
          fixture.vault.contents.get(copied.path)?.split("---").at(-1),
        ).toBe(source.split("---").at(-1));
        expect(
          fixture.vault.files.has("templates/zotlit-profile.default.md"),
        ).toBe(false);
      }),
  );

  it.effect(
    "uses the dialog bindings as a replacement while inheriting omitted values",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const fixture = yield* Effect.acquireDisposable(
          Effect.tryPromise(() => harness(undefined, undefined, context)),
        );
        const { profile, vault } = fixture;
        const pending = profile.create({
          label: "New Profile",
          source: document(
            BOOKS,
            "folder: Sender\ncitationStyle: apa\nimportFolder: Sender notes\nimportColoredHighlights: true\nimportAnnotationsAsTemplate: true",
          ),
          bindings: { citationStyle: null },
        });
        yield* TestClock.adjust(500);
        const created = yield* Effect.promise(() => pending);
        expect(profile.resolveProfile(created.id)?.bindings).toEqual({
          "note.literature-folder": "literatures",
          "citation.references-style": null,
          "note.import-folder": "zotero_notes",
          "note.import-colored-highlights": false,
          "note.import-annotations-as-template": false,
        });
        expect(vault.contents.get(created.path)).not.toContain("Sender");
      }),
  );

  it.effect(
    "numbers a duplicate label when a case-insensitive copy name exists",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const fixture = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            harness(
              {
                "templates/zotlit-profile.books.md": document(),
                "templates/zotlit-profile.copy.md": document(
                  "Rz9Wm4YfH6Kd",
                  "",
                  "books copy",
                ),
              },
              undefined,
              context,
            ),
          ),
        );
        const pending = fixture.profile.duplicate(BOOKS);
        const result = expect(pending).resolves.toMatchObject({
          label: "Books copy 2",
          document: "zotlit-profile.books-copy-2.md",
        });
        yield* Effect.all(
          [TestClock.adjust(500), Effect.promise(() => result)],
          { concurrency: "unbounded" },
        );
      }),
  );

  it.effect(
    "keeps repeated labels usable and diagnoses invalid documents",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const fixture = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            harness(
              {
                "templates/zotlit-profile.one.md": document(),
                "templates/zotlit-profile.two.md": document("Rz9Wm4YfH6Kd"),
                "templates/zotlit-profile.broken.md": document("invalid"),
              },
              undefined,
              context,
            ),
          ),
        );
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
      }),
  );

  it.effect(
    "duplicates the body and bindings with a fresh identity and a free filename",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const fixture = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            harness(
              {
                "templates/zotlit-profile.books.md": document(
                  BOOKS,
                  "folder: Library\ncitationStyle: apa",
                ),
              },
              undefined,
              context,
            ),
          ),
        );
        const { profile, vault } = fixture;
        vault.createFile("templates/zotlit-profile.books-copy.md", "User file");
        yield* TestClock.adjust(500);
        const pending = profile.duplicate(BOOKS);
        yield* TestClock.adjust(500);
        const copy = yield* Effect.promise(() => pending);
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
        expect(
          vault.contents.get("templates/zotlit-profile.books-copy.md"),
        ).toBe("User file");
      }),
  );

  it.effect(
    "ejects and restores the default look without storing a document pointer",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const fixture = yield* Effect.acquireDisposable(
          Effect.tryPromise(() => harness(undefined, undefined, context)),
        );
        const { bridge, profile, vault, settings } = fixture;
        expect(profile.resolveProfile("default")?.document).toBeUndefined();
        const pending = profile.ejectDefault();
        yield* TestClock.adjust(500);
        expect((yield* Effect.promise(() => pending)).path).toBe(
          "templates/zotlit-profile.default.md",
        );
        expect(profile.resolveProfile("default")?.document).toBe(
          "zotlit-profile.default.md",
        );
        expect(
          vault.contents.get("templates/zotlit-profile.default.md"),
        ).toContain("id: default");
        expect(
          bridge.runSync(settings.current)?.["note.default-profile"],
        ).not.toHaveProperty("document");
        const restore = profile.restoreDefault();
        yield* TestClock.adjust(500);
        yield* Effect.promise(() => restore);
        expect(vault.files.has("templates/zotlit-profile.default.md")).toBe(
          false,
        );
        expect(profile.resolveProfile("default")?.document).toBeUndefined();
      }),
  );

  it.effect("creates Default atomically and preserves a competing file", () =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const fixture = yield* Effect.acquireDisposable(
        Effect.tryPromise(() => harness(undefined, undefined, context)),
      );
      const { profile, vault } = fixture;
      const source = yield* Effect.promise(() => profile.getSource("default"));
      expect(vault.files.has("templates/zotlit-profile.default.md")).toBe(
        false,
      );
      const edited = `${source}\nA custom annotation suffix.\n`;
      const first = profile.materializeDefault();
      const competing = profile.materializeDefault();
      yield* TestClock.adjust(500);
      const results = yield* Effect.promise(() =>
        Promise.all([first, competing]),
      );
      expect(
        results
          .map(({ created }) => created)
          .sort((a, b) => Number(a) - Number(b)),
      ).toEqual([false, true]);
      expect(results[0]!.file).toBe(results[1]!.file);
      expect(vault.contents.get("templates/zotlit-profile.default.md")).toBe(
        source,
      );
      vault.contents.set("templates/zotlit-profile.default.md", edited);
      const second = profile.materializeDefault();
      yield* TestClock.adjust(500);
      expect(yield* Effect.promise(() => second)).toMatchObject({
        created: false,
      });
      expect(vault.contents.get("templates/zotlit-profile.default.md")).toBe(
        edited,
      );
    }),
  );

  it.effect(
    "carries the configured frontmatter fields into the ejected Default document",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const fixture = yield* Effect.acquireDisposable(
          Effect.tryPromise(() => harness(undefined, undefined, context)),
        );
        const { bridge, profile, vault, settings } = fixture;
        bridge.runSync(
          settings.update({
            "note.frontmatter-fields": [
              {
                key: "reading-status",
                expr: "'unread'",
                merge: "keep",
                language: "liquid",
              },
            ],
          }),
        );
        const pending = profile.ejectDefault();
        yield* TestClock.adjust(500);
        yield* Effect.promise(() => pending);
        const source = vault.contents.get(
          "templates/zotlit-profile.default.md",
        )!;
        expect(source).toContain("key: reading-status");
        expect(source).toContain("merge: keep");
        expect(source).not.toContain("key: title");
      }),
  );

  it.effect(
    "uses a renamed Default document for eject and restore actions",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const fixture = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            harness(
              {
                "templates/zotlit-profile.default.md": document("default"),
              },
              undefined,
              context,
            ),
          ),
        );
        const { vault, profile } = fixture;
        vault.renameFile(
          "templates/zotlit-profile.default.md",
          "templates/zotlit-profile.custom.md",
        );
        yield* TestClock.adjust(500);
        expect(profile.resolveProfile("default")?.document).toBe(
          "zotlit-profile.custom.md",
        );
        const eject = profile.ejectDefault();
        yield* TestClock.adjust(500);
        expect((yield* Effect.promise(() => eject)).path).toBe(
          "templates/zotlit-profile.custom.md",
        );
        expect(profile.diagnostics).toEqual([]);
        const restore = profile.restoreDefault();
        yield* TestClock.adjust(500);
        yield* Effect.promise(() => restore);
        expect(vault.files.has("templates/zotlit-profile.custom.md")).toBe(
          false,
        );
        expect(profile.resolveProfile("default")?.document).toBeUndefined();
      }),
  );

  it.effect.each([
    document("default", "folder: Books"),
    document("default").replace("\n--- zotlit:annotation ---\nAnnotation", ""),
  ])("excludes an invalid renamed Default from a cold scan", (source) =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const fixture = yield* Effect.acquireDisposable(
        Effect.tryPromise(() =>
          harness(
            {
              "templates/zotlit-profile.custom.md": source,
            },
            undefined,
            context,
          ),
        ),
      );
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
    }),
  );

  it.effect("refuses default resolution while two documents claim its ID", () =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const fixture = yield* Effect.acquireDisposable(
        Effect.tryPromise(() =>
          harness(
            {
              "templates/zotlit-profile.default.md": document("default"),
              "templates/zotlit-profile.copy.md": document("default"),
            },
            undefined,
            context,
          ),
        ),
      );
      const { profile } = fixture;
      expect(profile.resolveProfile("default")).toBeUndefined();
      expect(profile.diagnostics.map(({ code }) => code)).toEqual([
        "duplicate-profile-id",
        "duplicate-profile-id",
      ]);
    }),
  );

  it.effect(
    "re-stamps Literature and Imported Notes before trashing the Profile document",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const fixture = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            harness(
              {
                "templates/zotlit-profile.books.md": document(),
                "Books/Paper.md": noteText(
                  {
                    "zotero-key": "PAPER234",
                    "zotlit-profile": "Books (Bk3Qn7XvT2Lp)",
                  },
                  "Paper",
                ),
                "Imports/Note.md": noteText(
                  { "zotero-note-key": "NTE23456", "zotlit-profile": BOOKS },
                  "Note",
                ),
                "Scratch.md": noteText({ "zotlit-profile": BOOKS }, "Scratch"),
              },
              undefined,
              context,
            ),
          ),
        );
        const { profile, vault } = fixture;
        const pending = profile.delete(BOOKS, "default");
        yield* TestClock.adjust(500);
        yield* Effect.promise(() => pending);
        expect(vault.contents.get("Books/Paper.md")).toBe(
          noteText({ "zotero-key": "PAPER234" }, "Paper"),
        );
        expect(vault.contents.get("Imports/Note.md")).toBe(
          noteText({ "zotero-note-key": "NTE23456" }, "Note"),
        );
        expect(vault.contents.get("Scratch.md")).toBe(
          noteText({ "zotlit-profile": BOOKS }, "Scratch"),
        );
        expect(vault.files.has("templates/zotlit-profile.books.md")).toBe(
          false,
        );
      }),
  );

  it.effect("keeps the document when a note cannot be re-stamped", () =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const fixture = yield* Effect.acquireDisposable(
        Effect.tryPromise(() =>
          harness(
            {
              "templates/zotlit-profile.books.md": document(),
              "Paper.md": noteText(
                { "zotero-key": "PAPER234", "zotlit-profile": BOOKS },
                "Paper",
              ),
            },
            undefined,
            context,
          ),
        ),
      );
      const { profile, vault } = fixture;
      const _write = yield* Effect.acquireDisposable(
        Effect.sync(() =>
          vi
            .spyOn(vault, "process")
            .mockRejectedValue(new Error("Read-only note")),
        ),
      );
      yield* Effect.promise(() =>
        expect(profile.delete(BOOKS, "default")).rejects.toThrow(
          "Read-only note",
        ),
      );
      expect(vault.files.has("templates/zotlit-profile.books.md")).toBe(true);
    }),
  );

  it.effect(
    "reports deletion counts and moves both note kinds with their subfolders before trashing only the Profile document",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const papers = "Rz9Wm4YfH6Kd" as ProfileId;
        const fixture = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            harness(
              {
                "templates/zotlit-profile.books.md": document(
                  BOOKS,
                  "folder: Books\nimportFolder: Imports",
                ),
                "templates/zotlit-profile.papers.md": document(
                  papers,
                  "folder: Papers\nimportFolder: Imported/Papers",
                  "Papers",
                ),
                "templates/shared.liquid.md": "Shared partial",
                "Books/2024/My title.md": noteText(
                  { "zotero-key": "PAPER234", "zotlit-profile": BOOKS },
                  "My reading text",
                ),
                "Imports/2024/Child.md": noteText(
                  { "zotero-note-key": "NTE23456", "zotlit-profile": BOOKS },
                  "Imported text",
                ),
              },
              undefined,
              context,
            ),
          ),
        );
        const { profile, vault, app } = fixture;
        const literature = vault.getFileByPath("Books/2024/My title.md")!;
        const imported = vault.getFileByPath("Imports/2024/Child.md")!;
        const order: string[] = [];
        app.fileManager.renameFile = async (file, path) => {
          order.push(path);
          vault.renameFile(file.path, path);
        };
        const _trash = yield* Effect.acquireDisposable(
          Effect.sync(() =>
            vi
              .spyOn(app.fileManager, "trashFile")
              .mockImplementation(async (file) => {
                order.push(file.path);
                vault.deleteFile(file.path);
              }),
          ),
        );
        const plan = yield* Effect.promise(() => profile.prepareDelete(BOOKS));
        expect(plan.literatureNotes).toEqual([literature]);
        expect(plan.importedNotes).toEqual([imported]);
        expect(plan.targets.map(({ profile }) => profile.selector)).toEqual([
          "default",
          papers,
        ]);
        const planned = plan.targets
          .find(({ profile }) => profile.selector === papers)!
          .files.map(({ path }) => path);
        expect(planned).toEqual([
          "Papers/2024/My title.md",
          "Imported/Papers/2024/Child.md",
        ]);
        const pending = profile.delete(BOOKS, papers, { move: true });
        yield* TestClock.adjust(500);
        yield* Effect.promise(() =>
          expect(pending).resolves.toEqual({
            literatureNotes: 1,
            importedNotes: 1,
            movedFiles: 2,
          }),
        );
        expect(order).toEqual([
          ...planned,
          "templates/zotlit-profile.books.md",
        ]);
        expect(vault.contents.get("Papers/2024/My title.md")).toBe(
          noteText(
            {
              "zotero-key": "PAPER234",
              "zotlit-profile": "Papers (Rz9Wm4YfH6Kd)",
            },
            "My reading text",
          ),
        );
        expect(vault.contents.get("Imported/Papers/2024/Child.md")).toBe(
          noteText(
            {
              "zotero-note-key": "NTE23456",
              "zotlit-profile": "Papers (Rz9Wm4YfH6Kd)",
            },
            "Imported text",
          ),
        );
        expect(vault.contents.get("templates/shared.liquid.md")).toBe(
          "Shared partial",
        );
        expect(profile.resolveProfile(BOOKS)).toBeUndefined();
      }),
  );

  it.effect(
    "removes a Profile when its document is removed outside ZotLit",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const fixture = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            harness(
              {
                "templates/zotlit-profile.books.md": document(),
              },
              undefined,
              context,
            ),
          ),
        );
        const { profile, vault } = fixture;
        vault.deleteFile("templates/zotlit-profile.books.md");
        yield* TestClock.adjust(500);
        expect(profile.resolveProfile(BOOKS)).toBeUndefined();
      }),
  );

  it.effect("keeps the Profile document when a requested note move fails", () =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const note = noteText(
        { "zotero-key": "PAPER234", "zotlit-profile": BOOKS },
        "User text",
      );
      const fixture = yield* Effect.acquireDisposable(
        Effect.tryPromise(() =>
          harness(
            {
              "templates/zotlit-profile.books.md": document(),
              "Books/Paper.md": note,
            },
            undefined,
            context,
          ),
        ),
      );
      const { profile, vault, app } = fixture;
      app.fileManager.renameFile = async () => {
        throw new Error("Destination occupied");
      };
      const pending = profile.delete(BOOKS, "default", { move: true });
      const refused = expect(pending).rejects.toThrow("Destination occupied");
      yield* TestClock.adjust(500);
      yield* Effect.promise(() => refused);
      expect(vault.contents.get("templates/zotlit-profile.books.md")).toBe(
        document(),
      );
      expect(vault.contents.get("Books/Paper.md")).toBe(note);
    }),
  );
});

describe("Profile Match document writes", () => {
  it.effect.each(["\n", "\r\n"])(
    "updates and removes only match bytes with %j line endings, then refreshes the registry",
    (eol) =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const path = "templates/zotlit-profile.books.md";
        const source = document(
          BOOKS,
          "match:\n  and:\n    - 'tags.contains(\"Read\")'\n# Keep the next comment",
        )
          .replace("name: Books", "name :  Books  # Keep spacing")
          .replaceAll("\n", eol);
        const f = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            harness({ [path]: source }, undefined, context),
          ),
        );
        const save = f.profile.setMatch(BOOKS, { or: [] });
        yield* TestClock.adjust(500);
        yield* Effect.promise(() => save);
        expect(f.vault.contents.get(path)).toBe(
          source.replace(
            ["match:", "  and:", "    - 'tags.contains(\"Read\")'"].join(eol),
            `match:${eol}  {"or":[]}`,
          ),
        );
        expect(f.profile.profiles[0]!.match).toMatchObject({
          state: "evaluable",
          tree: { or: [] },
        });
        expect(f.profile.profiles[0]!.match.summary).toBe("false");
        const remove = f.profile.setMatch(BOOKS, undefined);
        yield* TestClock.adjust(500);
        yield* Effect.promise(() => remove);
        expect(f.vault.contents.get(path)).toBe(
          source.replace(
            ["match:", "  and:", "    - 'tags.contains(\"Read\")'", ""].join(
              eol,
            ),
            "",
          ),
        );
        expect(f.profile.profiles[0]!.match).toMatchObject({
          state: "absent",
          summary: m.profile_match_absent(),
        });
      }),
  );

  it.effect(
    "uses the latest document bytes and clears an invalid expression diagnostic",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const path = "templates/zotlit-profile.books.md";
        const f = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            harness(
              {
                [path]: document(BOOKS, "match: 'title ==' "),
              },
              undefined,
              context,
            ),
          ),
        );
        expect(f.profile.profiles[0]!.match.state).toBe("unevaluable");
        const edited = document(
          BOOKS,
          "match: 'title == \"Current\"'\n# A hand edit",
          "Current books",
        );
        f.vault.modifyFile(path, edited);
        const save = f.profile.setMatch(BOOKS, { and: [] });
        yield* TestClock.adjust(1000);
        yield* Effect.promise(() => save);
        expect(f.vault.contents.get(path)).toBe(
          edited.replace("match: 'title == \"Current\"'", 'match: {"and":[]}'),
        );
        expect(f.profile.profiles[0]).toMatchObject({
          label: "Current books",
          match: { state: "all", summary: m.profile_match_all() },
        });
        const remove = f.profile.setMatch(BOOKS, undefined);
        yield* TestClock.adjust(500);
        yield* Effect.promise(() => remove);
        expect(f.profile.profiles[0]!.match.state).toBe("absent");
      }),
  );

  it.effect(
    "keeps the current file when a document replacement changes its identity",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const path = "templates/zotlit-profile.books.md";
        const f = yield* Effect.acquireDisposable(
          Effect.tryPromise(() =>
            harness({ [path]: document() }, undefined, context),
          ),
        );
        const replacement = document("Other1234567");
        f.vault.modifyFile(path, replacement);
        const rejected = expect(
          f.profile.setMatch(BOOKS, { and: [] }),
        ).rejects.toThrow();
        yield* TestClock.adjust(500);
        yield* Effect.promise(() => rejected);
        expect(f.vault.contents.get(path)).toBe(replacement);
      }),
  );
});
