import type { CliHandler, Plugin } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { profileServiceFixture } from "@/services/profile/__fixtures__/service";

import { TEMPLATE_INSPECT_COMMAND } from "./inspect";
import { INSPECT_DIAGNOSTICS, inspectFlags } from "./inspect-contract";
import { registerTemplateWorkbench } from "./register";

const BOOKS = "templates/zotlit-profile.books.md";
const PARTIAL = "templates/zotlit-partial.summary.md";
const source = `---
id: Bk3Qn7XvT2Lp
name: Books
version: 1.0.0
contract: 2
filename: "{{ zt.title }}"
---
# {{ zt.title }}
{% managed %}Managed{% endmanaged %}
--- zotlit:annotation ---
Annotation`;

async function fixture(
  files: Record<string, string> = {
    [BOOKS]: source,
    [PARTIAL]: "Original partial",
  },
) {
  await using stack = new AsyncDisposableStack();
  const f = stack.use(await profileServiceFixture(files));
  const disk = new Map(f.vault.contents);
  const readSignal = Promise.withResolvers<void>();
  const read = vi.fn(async (path: string) => {
    readSignal.resolve();
    const value = disk.get(path);
    if (value === undefined)
      throw Object.assign(new Error("Missing file"), { code: "ENOENT" });
    return value;
  });
  Object.assign(f.vault, {
    getName: () => "Inspection fixture",
    adapter: { getBasePath: () => "/fixture", read },
  });
  const handlers = new Map<string, CliHandler>();
  registerTemplateWorkbench(
    {
      manifest: { version: "test" },
      registerCliHandler: (...args: Parameters<Plugin["registerCliHandler"]>) =>
        handlers.set(args[0], args[3]),
    } as unknown as Plugin,
    {
      app: f.app,
      templates: f.template,
      settings: f.settings,
      profile: f.profile,
      zoteroPref: {
        ready: Promise.resolve(),
        sourceId: "fixture-source",
        databasePath: "/fixture/db",
      },
    } as never,
  );
  const cleanup = stack.move();
  return {
    ...f,
    disk,
    read,
    readSignal,
    [Symbol.asyncDispose]: () => cleanup.disposeAsync(),
    inspect: async (params: Parameters<CliHandler>[0] = {}) => {
      const answer = JSON.parse(
        (await handlers.get(TEMPLATE_INSPECT_COMMAND)!(params)) as string,
      );
      // The Workbench Guide tells a caller to follow `diagnostic.hint` on
      // failure, so every refusal this suite reaches carries one.
      if (answer.ok === false && answer.diagnostic)
        expect(answer.diagnostic).toMatchObject({ hint: expect.any(String) });
      return answer;
    },
    guide: async () =>
      handlers.get("zotlit:template-guide")!({ topic: "inspect" }),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("registered template-inspect", () => {
  it.each([BOOKS, PARTIAL, "templates/zotlit-citation.md"])(
    "clears the loaded revision and preserves the read error after reconciliation cannot read %s",
    async (path) => {
      const saved = path === BOOKS ? source : "Previously loaded source";
      await using f = await fixture({ [path]: saved });
      expect(await f.inspect({ document: path })).toMatchObject({
        ok: true,
        freshness: { state: "current" },
      });
      f.vault.cachedRead.mockRejectedValue(
        Object.assign(new Error("Reconciliation read denied"), {
          code: "EACCES",
        }),
      );
      f.vault.modifyFile(path, saved);
      await vi.advanceTimersByTimeAsync(500);
      const attempt = f.inspect({ document: path, source: "full" });
      await vi.advanceTimersByTimeAsync(1001);
      const response = await attempt;
      expect(response).toMatchObject({
        ok: false,
        diagnostic: { code: "SOURCE_NOT_LOADED" },
        document: {
          problems: expect.arrayContaining([
            expect.objectContaining({ message: "Reconciliation read denied" }),
          ]),
        },
        freshness: {
          state: "timeout",
          versions: expect.arrayContaining([
            expect.objectContaining({ path, loaded: null }),
          ]),
        },
      });
      expect(response.source).toBeUndefined();
    },
  );

  it("lists all document kinds without source and resolves a Profile label", async () => {
    await using f = await fixture();
    const inventory = await f.inspect();
    expect(
      inventory.documents.map((entry: { kind: string }) => entry.kind),
    ).toEqual(["profile", "profile", "citation", "partial"]);
    expect(inventory.source).toBeUndefined();
    const result = await f.inspect({ profile: "Books" });
    expect(result).toMatchObject({
      ok: true,
      document: { path: BOOKS, profile: { id: "Bk3Qn7XvT2Lp" } },
      input: { origin: "saved" },
      freshness: { state: "current" },
      identity: { vault: { path: "/fixture" } },
    });
    expect(result.source).toBeUndefined();
    expect((await f.inspect({ document: BOOKS, source: "full" })).source).toBe(
      source,
    );
  });

  it("selects a twelve-character label and retains label ambiguity", async () => {
    const named = source.replace("name: Books", "name: ReadingBooks");
    await using f = await fixture({ [BOOKS]: named });
    expect(await f.inspect({ profile: "ReadingBooks" })).toMatchObject({
      ok: true,
      document: { path: BOOKS },
    });
    const other = "templates/zotlit-profile.other.md";
    f.vault.createFile(other, named.replace("Bk3Qn7XvT2Lp", "OtherBook1234"));
    await vi.advanceTimersByTimeAsync(500);
    expect(await f.inspect({ profile: "ReadingBooks" })).toMatchObject({
      ok: false,
      diagnostic: { code: "AMBIGUOUS_TARGET" },
    });
    expect(await f.inspect({ profile: "Bk3Qn7XvT2Lp" })).toMatchObject({
      ok: true,
      document: { path: BOOKS },
    });
  });

  it("keeps note stamps as strict identities even when another Profile label matches", async () => {
    await using f = await fixture({
      [BOOKS]: source.replace("name: Books", "name: MissingId123"),
    });
    f.vault.addFile("Reading/Book.md", "Existing note");
    vi.spyOn(f.app.metadataCache, "getFileCache").mockReturnValue({
      frontmatter: {
        "zotero-key": "ABCD2345",
        "zotlit-profile": "MissingId123",
      },
    } as never);
    expect(await f.inspect({ note: "Reading/Book.md" })).toMatchObject({
      ok: false,
      diagnostic: { code: "TARGET_NOT_FOUND" },
      matches: [],
    });
    expect(await f.inspect({ profile: "MissingId123" })).toMatchObject({
      ok: true,
      document: { path: BOOKS },
    });
  });

  it.each(["invalid", "duplicate"])(
    "resolves the note's stamped Profile through %s document inventory",
    async (state) => {
      const files: Record<string, string> =
        state === "invalid"
          ? {
              [BOOKS]: source.replace(
                "--- zotlit:annotation ---",
                "No Annotation Section",
              ),
            }
          : {
              [BOOKS]: source,
              "templates/zotlit-profile.duplicate.md": source,
            };
      await using f = await fixture(files);
      f.vault.addFile("Reading/Book.md", "Existing note");
      vi.spyOn(f.app.metadataCache, "getFileCache").mockReturnValue({
        frontmatter: {
          "zotero-key": "ABCD2345",
          "zotlit-profile": "Books (Bk3Qn7XvT2Lp)",
        },
      } as never);
      const response = await f.inspect({
        note: "Reading/Book.md",
        source: "full",
      });
      if (state === "duplicate")
        expect(response).toMatchObject({
          ok: false,
          diagnostic: { code: "AMBIGUOUS_TARGET" },
          matches: [
            { path: BOOKS },
            { path: "templates/zotlit-profile.duplicate.md" },
          ],
        });
      else {
        expect(response).toMatchObject({
          ok: true,
          note: { key: "ABCD2345" },
          document: { path: BOOKS, profileIdentity: { id: "Bk3Qn7XvT2Lp" } },
          source: files[BOOKS],
        });
        expect(response.problems.length).toBeGreaterThan(0);
      }
    },
  );

  it("reads invalid source and built-in Default without creating files", async () => {
    await using f = await fixture({ [BOOKS]: "---\nfilename: [\n---\nBroken" });
    const before = [...f.vault.contents];
    const invalid = await f.inspect({ document: BOOKS, source: "full" });
    expect(invalid).toMatchObject({
      ok: true,
      source: "---\nfilename: [\n---\nBroken",
      freshness: { state: "current" },
    });
    expect(invalid.problems.length).toBeGreaterThan(0);
    expect(invalid.problems[0].message).toEqual(expect.any(String));
    const builtin = await f.inspect({ profile: "default", source: "full" });
    expect(builtin.input.origin).toBe("built-in");
    expect(builtin.source).toContain("filename:");
    expect([...f.vault.contents]).toEqual(before);
  });

  it("resolves a note's item and owning Profile and rejects missing targets", async () => {
    await using f = await fixture();
    f.vault.addFile("Reading/Book.md", "My note");
    vi.spyOn(f.app.metadataCache, "getFileCache").mockReturnValue({
      frontmatter: {
        "zotero-key": "ABCD2345",
        "zotlit-profile": "Books (Bk3Qn7XvT2Lp)",
      },
    } as never);
    expect(await f.inspect({ note: "Reading/Book.md" })).toMatchObject({
      ok: true,
      note: { path: "Reading/Book.md", key: "ABCD2345" },
      document: { path: BOOKS },
    });
    expect(await f.inspect({ document: "absent.md" })).toMatchObject({
      ok: false,
      diagnostic: { code: "TARGET_NOT_FOUND" },
    });
    expect(
      await f.inspect({ profile: "Books", document: BOOKS }),
    ).toMatchObject({ ok: false, diagnostic: { code: "INVALID_SELECTOR" } });
  });

  it("waits for an external source and Shared Partial to reach reconciliation", async () => {
    await using f = await fixture();
    const edited = source.replace("Managed", "External marker");
    f.disk.set(BOOKS, edited);
    f.disk.set(PARTIAL, "External partial marker");
    const result = f.inspect({ document: BOOKS, source: "full" });
    await f.readSignal.promise;
    f.vault.modifyFile(BOOKS, edited);
    f.vault.modifyFile(PARTIAL, "External partial marker");
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toMatchObject({
      ok: true,
      source: edited,
      freshness: { state: "current" },
    });
    expect(f.template.getLoadedDocumentSource(PARTIAL)).toBe(
      "External partial marker",
    );
  });

  it("reports affected revisions when an external dependency is never observed", async () => {
    await using f = await fixture();
    f.disk.set(PARTIAL, "Unobserved marker");
    const result = f.inspect({ document: BOOKS, source: "full" });
    await f.readSignal.promise;
    await vi.advanceTimersByTimeAsync(1001);
    const response = await result;
    expect(response).toMatchObject({
      ok: false,
      diagnostic: { code: "SOURCE_NOT_LOADED" },
      freshness: { state: "timeout" },
    });
    const partial = response.freshness.versions.find(
      (entry: { path: string }) => entry.path === PARTIAL,
    );
    expect(partial.disk).not.toBe(partial.loaded);
    expect(response.source).toBeUndefined();
  });

  it("keeps saved and explicitly selected editor source distinct", async () => {
    await using f = await fixture();
    Object.assign(f.app.workspace, {
      getActiveViewOfType: () => ({
        file: { path: BOOKS },
        editor: { getValue: () => "Unsaved marker" },
      }),
    });
    expect((await f.inspect({ document: BOOKS, source: "full" })).source).toBe(
      source,
    );
    expect(
      await f.inspect({ document: BOOKS, source: "full", editor: "true" }),
    ).toMatchObject({
      source: "Unsaved marker",
      input: { origin: "editor" },
      contextOrigin: "saved",
      validation: { state: "not-checked" },
    });
    expect(
      await f.inspect({ document: PARTIAL, editor: "true" }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "EDITOR_TARGET_MISMATCH" },
    });
  });

  it("reports ambiguous note names without choosing a fallback", async () => {
    await using f = await fixture();
    f.vault.addFile("Reading/Book.md", "First");
    f.vault.addFile("Archive/Book.md", "Second");
    expect(await f.inspect({ note: "Book" })).toMatchObject({
      ok: false,
      diagnostic: { code: "AMBIGUOUS_TARGET" },
      matches: ["Reading/Book.md", "Archive/Book.md"],
    });
  });

  it("reports a superseded source instead of claiming the first request is current", async () => {
    await using f = await fixture();
    f.disk.set(BOOKS, source.replace("Managed", "Requested marker"));
    const result = f.inspect({ document: BOOKS });
    await f.readSignal.promise;
    f.disk.set(BOOKS, source.replace("Managed", "Superseding marker"));
    f.vault.modifyFile(BOOKS, f.disk.get(BOOKS)!);
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toMatchObject({
      ok: false,
      diagnostic: { code: "SOURCE_NOT_LOADED" },
      freshness: { state: "superseded" },
    });
  });

  it.each([
    ["templates/zotlit-profile.default.md", { profile: "default" }],
    ["templates/zotlit-citation.md", { document: "citation" }],
  ] as const)(
    "checks the canonical built-in customization path %s before claiming current",
    async (path, selection) => {
      await using f = await fixture({});
      const builtin = await f.inspect(selection);
      expect(builtin.freshness.versions).toContainEqual({
        path,
        requested: null,
        disk: null,
        loaded: null,
      });
      f.disk.set(path, "External customization not observed");
      const attempt = f.inspect(selection);
      await vi.advanceTimersByTimeAsync(1001);
      expect(await attempt).toMatchObject({
        ok: false,
        diagnostic: { code: "SOURCE_NOT_LOADED" },
        freshness: { state: "timeout" },
      });
    },
  );

  it("returns adapter errors with their path and original errno instead of waiting for missing source", async () => {
    await using f = await fixture();
    const timersBefore = vi.getTimerCount();
    f.read.mockRejectedValue(
      Object.assign(new Error("Permission denied by adapter"), {
        code: "EACCES",
      }),
    );
    const response = await f.inspect({ document: BOOKS });
    expect(response).toMatchObject({
      ok: false,
      diagnostic: { code: "SOURCE_READ_FAILED" },
      freshness: {
        state: "read-failed",
        errors: expect.arrayContaining([
          {
            path: BOOKS,
            code: "EACCES",
            message: "Permission denied by adapter",
          },
        ]),
      },
    });
    expect(vi.getTimerCount()).toBe(timersBefore);
  });

  it("preserves invalid document error messages and nested causes in JSON", async () => {
    await using f = await fixture();
    const statuses = f.template.getLiteratureNoteTemplateStatuses();
    vi.spyOn(f.template, "getLiteratureNoteTemplateStatuses").mockReturnValue(
      statuses.map((entry) => ({
        ...entry,
        validation: {
          state: "invalid",
          manifestId: "Bk3Qn7XvT2Lp",
          error: {
            code: "unknown",
            message: "Invalid document envelope",
            recovery: "Repair its YAML",
            cause: new Error("Original YAML parser evidence", {
              cause: new Error("Nested cause"),
            }),
          },
        },
      })),
    );
    expect(await f.inspect({ document: BOOKS })).toMatchObject({
      problems: [
        {
          message: "Invalid document envelope",
          cause: {
            message: "Original YAML parser evidence",
            cause: { message: "Nested cause" },
          },
        },
      ],
    });
  });

  it("preserves duplicate Profile IDs for targeted and direct document inspection", async () => {
    const duplicate = "templates/zotlit-profile.duplicate.md";
    await using f = await fixture({ [BOOKS]: source, [duplicate]: source });
    expect(await f.inspect({ profile: "Bk3Qn7XvT2Lp" })).toMatchObject({
      ok: false,
      diagnostic: { code: "AMBIGUOUS_TARGET" },
      matches: [{ path: BOOKS }, { path: duplicate }],
    });
    const direct = await f.inspect({ document: BOOKS });
    expect(direct.document.profileIdentity).toEqual({
      id: "Bk3Qn7XvT2Lp",
      label: "Books",
    });
    expect(direct.problems).toContainEqual(
      expect.objectContaining({
        code: "duplicate-profile-id",
        paths: [BOOKS, duplicate],
      }),
    );
    expect(direct.profileDiagnostics).toHaveLength(2);
  });

  it("returns reserved Shared Partial source and its naming problem", async () => {
    const path = "templates/zotlit-partial.citation.md";
    await using f = await fixture({ [path]: "Reserved source marker" });
    expect(await f.inspect({ document: path, source: "full" })).toMatchObject({
      ok: true,
      source: "Reserved source marker",
      problems: [{ code: "RESERVED_PARTIAL_NAME" }],
      freshness: { state: "current" },
    });
  });

  it("serves inspection flags and diagnostics through the registered guide and checks expect-source", async () => {
    await using f = await fixture();
    const guide = String(await f.guide());
    const [, flagsText, diagnosticsText] = guide
      .split("\nFLAGS\n")
      .flatMap((section) => section.split("\nDIAGNOSTICS\n"));
    const indexRows = (text: string) =>
      Object.fromEntries(
        text
          .trim()
          .split("\n")
          .map((line) => {
            const separator = line.indexOf(": ");
            return [line.slice(0, separator).trim(), line.slice(separator + 2)];
          }),
      );
    expect(indexRows(flagsText!)).toEqual(
      Object.fromEntries(
        Object.entries(inspectFlags).map(([name, flag]) => [
          name,
          flag.description,
        ]),
      ),
    );
    expect(indexRows(diagnosticsText!)).toEqual(
      Object.fromEntries(
        Object.entries(INSPECT_DIAGNOSTICS).map(([code, entry]) => [
          code,
          `${entry.message} ${entry.hint}`,
        ]),
      ),
    );
    expect(
      await f.inspect({ profile: "Books", "expect-source": "wrong-source" }),
    ).toMatchObject({ ok: false, diagnostic: { code: "TARGET_MISMATCH" } });
    expect(
      await f.inspect({ profile: "Books", "expect-source": "fixture-source" }),
    ).toMatchObject({ ok: true });
  });

  it.each([
    ["valid", "Original partial", "{% if %}"],
    ["invalid", "{% if %}", "Repaired partial marker"],
  ])(
    "refreshes dependency problems after an initially %s partial reconciles",
    async (_state, initial, edited) => {
      await using f = await fixture({ [BOOKS]: source, [PARTIAL]: initial! });
      f.disk.set(PARTIAL, edited!);
      const attempt = f.inspect({ document: BOOKS });
      await f.readSignal.promise;
      f.vault.modifyFile(PARTIAL, edited!);
      await vi.advanceTimersByTimeAsync(500);
      const result = await attempt;
      expect(result.ok).toBe(true);
      const dependency = result.dependencies.find(
        (entry: { path: string }) => entry.path === PARTIAL,
      );
      if (edited === "{% if %}")
        expect(dependency.problems).toEqual([
          expect.objectContaining({ message: expect.any(String) }),
        ]);
      else expect(dependency.problems).toEqual([]);
    },
  );
});
