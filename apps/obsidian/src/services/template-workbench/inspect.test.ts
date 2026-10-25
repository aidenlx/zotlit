import { it } from "@effect/vitest";
import { Stream } from "effect";
import { Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import type { CachedMetadata, CliData } from "obsidian";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";

import { fakeCliHost } from "@/lib/__fixtures__/cli-host";
import { testRuntime } from "@/lib/__fixtures__/runtime";
import { profileServiceFixture } from "@/services/profile/__fixtures__/service";

import { workbenchRegistrationDeps } from "./__fixtures__";
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
  let nextRead = Promise.withResolvers<void>();
  const read = vi.fn(async (path: string) => {
    readSignal.resolve();
    nextRead.resolve();
    const value = disk.get(path);
    if (value === undefined)
      throw Object.assign(new Error("Missing file"), { code: "ENOENT" });
    return value;
  });
  Object.assign(f.vault, {
    getName: () => "Inspection fixture",
    adapter: { getBasePath: () => "/fixture", read },
  });
  const { host, command } = fakeCliHost();
  registerTemplateWorkbench(
    { ...host, manifest: { version: "test" } },
    workbenchRegistrationDeps({
      runtime: testRuntime(),
      app: f.app,
      templates: f.template,
      settings: f.settings,
      bridge: f.bridge,
      profile: f.profile,
      zoteroPref: {
        sourceId: "fixture-source",
        databasePath: "/fixture/db",
        dataDir: "/fixture",
        baseAttachmentPath: null,
      },
    }),
  );
  const inspect = (params: CliData = {}) =>
    command(TEMPLATE_INSPECT_COMMAND)
      .handler(params)
      .pipe(Effect.map((output) => assertRefusalsHint(output)));
  const guide = () =>
    command("zotlit:template-guide").handler({ topic: "inspect" });
  const cleanup = stack.move();
  return {
    ...f,
    disk,
    read,
    readSignal,
    /** Settles once the adapter is next read. */
    nextRead: () => {
      nextRead = Promise.withResolvers<void>();
      return nextRead.promise;
    },
    [Symbol.asyncDispose]: () => cleanup.disposeAsync(),
    inspect,
    guide,
    // The cases that wait out TemplateService's reconciliation debounce stay
    // Promise code: the debounce is a window timer that only Vitest's fake
    // timers advance, which an it.effect case may not use. They run the
    // command as Obsidian does, outside any test Effect.
    inspectNow: (params?: CliData) => Effect.runPromise(inspect(params)),
  };
}

/** {@link fixture}, closed when the test's scope closes. */
const scopedFixture = (files?: Record<string, string>) =>
  Effect.acquireDisposable(Effect.tryPromise(() => fixture(files)));

/** The parsed answer, once it holds that every refusal carries a hint. */
function assertRefusalsHint(output: string) {
  const answer = JSON.parse(output);
  // The Workbench Guide tells a caller to follow `diagnostic.hint` on
  // failure, so every refusal this suite reaches carries one.
  const refusals = [answer].filter(
    (entry) => entry.ok === false && entry.diagnostic,
  );
  expect(refusals).toEqual(
    refusals.map(() =>
      expect.objectContaining({
        diagnostic: expect.objectContaining({ hint: expect.any(String) }),
      }),
    ),
  );
  return answer;
}

describe("registered template-inspect", () => {
  it.effect(
    "lists all document kinds without source and resolves a Profile label",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture();
        const inventory = yield* f.inspect();
        expect(
          inventory.documents.map((entry: { kind: string }) => entry.kind),
        ).toEqual(["profile", "profile", "citation", "partial"]);
        expect(inventory.source).toBeUndefined();
        const result = yield* f.inspect({ profile: "Books" });
        expect(result).toMatchObject({
          ok: true,
          document: { path: BOOKS, profile: { id: "Bk3Qn7XvT2Lp" } },
          input: { origin: "saved" },
          freshness: { state: "current" },
          identity: { vault: { path: "/fixture" } },
        });
        expect(result.source).toBeUndefined();
        expect(
          (yield* f.inspect({ document: BOOKS, source: "full" })).source,
        ).toBe(source);
      }),
  );

  it.effect(
    "keeps note stamps as strict identities even when another Profile label matches",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture({
          [BOOKS]: source.replace("name: Books", "name: MissingId123"),
        });
        f.vault.addFile("Reading/Book.md", "Existing note");
        const cache: CachedMetadata = {
          frontmatter: {
            "zotero-key": "ABCD2345",
            "zotlit-profile": "MissingId123",
          },
        };
        vi.spyOn(f.app.metadataCache, "getFileCache").mockReturnValue(cache);
        expect(yield* f.inspect({ note: "Reading/Book.md" })).toMatchObject({
          ok: false,
          diagnostic: { code: "TARGET_NOT_FOUND" },
          matches: [],
        });
        expect(yield* f.inspect({ profile: "MissingId123" })).toMatchObject({
          ok: true,
          document: { path: BOOKS },
        });
      }),
  );

  const inspectStampedNote = (files: Record<string, string>) =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* scopedFixture(files);
        f.vault.addFile("Reading/Book.md", "Existing note");
        const cache: CachedMetadata = {
          frontmatter: {
            "zotero-key": "ABCD2345",
            "zotlit-profile": "Books (Bk3Qn7XvT2Lp)",
          },
        };
        vi.spyOn(f.app.metadataCache, "getFileCache").mockReturnValue(cache);
        return yield* f.inspect({ note: "Reading/Book.md", source: "full" });
      }),
    );

  it.effect(
    "resolves the note's stamped Profile through invalid document inventory",
    () =>
      Effect.gen(function* () {
        const invalid = source.replace(
          "--- zotlit:annotation ---",
          "No Annotation Section",
        );
        const response = yield* inspectStampedNote({ [BOOKS]: invalid });
        expect(response).toMatchObject({
          ok: true,
          note: { key: "ABCD2345" },
          document: { path: BOOKS, profileIdentity: { id: "Bk3Qn7XvT2Lp" } },
          source: invalid,
        });
        expect(response.problems.length).toBeGreaterThan(0);
      }),
  );

  it.effect(
    "resolves the note's stamped Profile through duplicate document inventory",
    () =>
      Effect.gen(function* () {
        expect(
          yield* inspectStampedNote({
            [BOOKS]: source,
            "templates/zotlit-profile.duplicate.md": source,
          }),
        ).toMatchObject({
          ok: false,
          diagnostic: { code: "AMBIGUOUS_TARGET" },
          matches: [
            { path: BOOKS },
            { path: "templates/zotlit-profile.duplicate.md" },
          ],
        });
      }),
  );

  it.effect(
    "reads invalid source and built-in Default without creating files",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture({
          [BOOKS]: "---\nfilename: [\n---\nBroken",
        });
        const before = [...f.vault.contents];
        const invalid = yield* f.inspect({ document: BOOKS, source: "full" });
        expect(invalid).toMatchObject({
          ok: true,
          source: "---\nfilename: [\n---\nBroken",
          freshness: { state: "current" },
        });
        expect(invalid.problems.length).toBeGreaterThan(0);
        expect(invalid.problems[0].message).toEqual(expect.any(String));
        const builtin = yield* f.inspect({
          profile: "default",
          source: "full",
        });
        expect(builtin.input.origin).toBe("built-in");
        expect(builtin.source).toContain("filename:");
        expect([...f.vault.contents]).toEqual(before);
      }),
  );

  it.effect(
    "resolves a note's item and owning Profile and rejects missing targets",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture();
        f.vault.addFile("Reading/Book.md", "My note");
        const cache: CachedMetadata = {
          frontmatter: {
            "zotero-key": "ABCD2345",
            "zotlit-profile": "Books (Bk3Qn7XvT2Lp)",
          },
        };
        vi.spyOn(f.app.metadataCache, "getFileCache").mockReturnValue(cache);
        expect(yield* f.inspect({ note: "Reading/Book.md" })).toMatchObject({
          ok: true,
          note: { path: "Reading/Book.md", key: "ABCD2345" },
          document: { path: BOOKS },
        });
        expect(yield* f.inspect({ document: "absent.md" })).toMatchObject({
          ok: false,
          diagnostic: { code: "TARGET_NOT_FOUND" },
        });
        expect(
          yield* f.inspect({ profile: "Books", document: BOOKS }),
        ).toMatchObject({
          ok: false,
          diagnostic: {
            code: "INVALID_SELECTOR",
            details: { parameter: "document" },
          },
        });
        expect(
          yield* f.inspect({ note: "Reading/Book.md", profile: "Books" }),
        ).toMatchObject({
          ok: false,
          diagnostic: {
            code: "INVALID_SELECTOR",
            details: { parameter: "profile" },
          },
        });
      }),
  );

  it.effect(
    "reports affected revisions when an external dependency is never observed",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture();
        f.disk.set(PARTIAL, "Unobserved marker");
        const attempt = yield* Effect.forkChild(
          f.inspect({ document: BOOKS, source: "full" }),
        );
        // The wait's deadline is set before the first read.
        yield* Effect.promise(() => f.readSignal.promise);
        yield* TestClock.adjust(1001);
        const response = yield* Fiber.join(attempt);
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
      }),
  );

  it.effect("keeps saved and explicitly selected editor source distinct", () =>
    Effect.gen(function* () {
      const f = yield* scopedFixture();
      Object.assign(f.app.workspace, {
        getActiveViewOfType: () => ({
          file: { path: BOOKS },
          editor: { getValue: () => "Unsaved marker" },
        }),
      });
      expect(
        (yield* f.inspect({ document: BOOKS, source: "full" })).source,
      ).toBe(source);
      expect(
        yield* f.inspect({ document: BOOKS, source: "full", editor: "true" }),
      ).toMatchObject({
        source: "Unsaved marker",
        input: { origin: "editor" },
        contextOrigin: "saved",
        validation: { state: "not-checked" },
      });
      expect(
        yield* f.inspect({ document: PARTIAL, editor: "true" }),
      ).toMatchObject({
        ok: false,
        diagnostic: { code: "EDITOR_TARGET_MISMATCH" },
      });
    }),
  );

  it.effect("reports ambiguous note names without choosing a fallback", () =>
    Effect.gen(function* () {
      const f = yield* scopedFixture();
      f.vault.addFile("Reading/Book.md", "First");
      f.vault.addFile("Archive/Book.md", "Second");
      expect(yield* f.inspect({ note: "Book" })).toMatchObject({
        ok: false,
        diagnostic: { code: "AMBIGUOUS_TARGET" },
        matches: ["Reading/Book.md", "Archive/Book.md"],
      });
    }),
  );

  it.effect.each([
    ["templates/zotlit-profile.default.md", { profile: "default" }],
    ["templates/zotlit-citation.md", { document: "citation" }],
  ] as const)(
    "checks the canonical built-in customization path %s before claiming current",
    ([path, selection]) =>
      Effect.gen(function* () {
        const f = yield* scopedFixture({});
        const builtin = yield* f.inspect(selection);
        expect(builtin.freshness.versions).toContainEqual({
          path,
          requested: null,
          disk: null,
          loaded: null,
        });
        f.disk.set(path, "External customization not observed");
        const read = f.nextRead();
        const attempt = yield* Effect.forkChild(f.inspect(selection));
        // The wait's deadline is set before the first read.
        yield* Effect.promise(() => read);
        yield* TestClock.adjust(1001);
        expect(yield* Fiber.join(attempt)).toMatchObject({
          ok: false,
          diagnostic: { code: "SOURCE_NOT_LOADED" },
          freshness: { state: "timeout" },
        });
      }),
  );

  it.effect(
    "preserves invalid document error messages and nested causes in JSON",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture();
        const statuses = f.template.getLiteratureNoteTemplateStatuses();
        vi.spyOn(
          f.template,
          "getLiteratureNoteTemplateStatuses",
        ).mockReturnValue(
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
        expect(yield* f.inspect({ document: BOOKS })).toMatchObject({
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
      }),
  );

  it.effect(
    "preserves duplicate Profile IDs for targeted and direct document inspection",
    () =>
      Effect.gen(function* () {
        const duplicate = "templates/zotlit-profile.duplicate.md";
        const f = yield* scopedFixture({
          [BOOKS]: source,
          [duplicate]: source,
        });
        expect(yield* f.inspect({ profile: "Bk3Qn7XvT2Lp" })).toMatchObject({
          ok: false,
          diagnostic: { code: "AMBIGUOUS_TARGET" },
          matches: [{ path: BOOKS }, { path: duplicate }],
        });
        const direct = yield* f.inspect({ document: BOOKS });
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
      }),
  );

  it.effect(
    "returns reserved Shared Partial source and its naming problem",
    () =>
      Effect.gen(function* () {
        const path = "templates/zotlit-partial.citation.md";
        const f = yield* scopedFixture({ [path]: "Reserved source marker" });
        expect(
          yield* f.inspect({ document: path, source: "full" }),
        ).toMatchObject({
          ok: true,
          source: "Reserved source marker",
          problems: [{ code: "RESERVED_PARTIAL_NAME" }],
          freshness: { state: "current" },
        });
      }),
  );

  it.effect(
    "serves inspection flags and diagnostics through the registered guide and checks expect-source",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture();
        const guide = String(yield* f.guide());
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
                return [
                  line.slice(0, separator).trim(),
                  line.slice(separator + 2),
                ];
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
          yield* f.inspect({
            profile: "Books",
            "expect-source": "wrong-source",
          }),
        ).toMatchObject({ ok: false, diagnostic: { code: "TARGET_MISMATCH" } });
        expect(
          yield* f.inspect({
            profile: "Books",
            "expect-source": "fixture-source",
          }),
        ).toMatchObject({ ok: true });
      }),
  );

  it.effect(
    "stops reading and watching saved source when the inspection is interrupted",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture();
        const watching = vi.fn();
        const original = f.template["compile-status-changed"];
        Object.defineProperty(f.template, "compile-status-changed", {
          value: Stream.unwrap(
            Effect.acquireRelease(
              Effect.sync(() => {
                watching(true);
                return original;
              }),
              () => Effect.sync(() => watching(false)),
            ),
          ),
        });
        // The first read never answers, so the inspection is still at work.
        f.read.mockImplementation(() => {
          f.readSignal.resolve();
          return new Promise<string>(() => {});
        });
        const attempt = yield* Effect.forkChild(f.inspect({ document: BOOKS }));
        yield* Effect.promise(() => f.readSignal.promise);
        const reads = f.read.mock.calls.length;

        yield* Fiber.interrupt(attempt);

        expect(Exit.hasInterrupts(yield* Fiber.await(attempt))).toBe(true);
        expect(watching.mock.calls).toEqual([[true], [false]]);
        yield* TestClock.adjust(1001);
        expect(f.read).toHaveBeenCalledTimes(reads);
      }),
  );
});

describe("registered template-inspect across a reconciliation", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each([BOOKS, PARTIAL, "templates/zotlit-citation.md"])(
    "clears the loaded revision and preserves the read error after reconciliation cannot read %s",
    async (path) => {
      const saved = path === BOOKS ? source : "Previously loaded source";
      await using f = await fixture({ [path]: saved });
      expect(await f.inspectNow({ document: path })).toMatchObject({
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
      const attempt = f.inspectNow({ document: path, source: "full" });
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

  it("selects a twelve-character label and retains label ambiguity", async () => {
    const named = source.replace("name: Books", "name: ReadingBooks");
    await using f = await fixture({ [BOOKS]: named });
    expect(await f.inspectNow({ profile: "ReadingBooks" })).toMatchObject({
      ok: true,
      document: { path: BOOKS },
    });
    const other = "templates/zotlit-profile.other.md";
    f.vault.createFile(other, named.replace("Bk3Qn7XvT2Lp", "OtherBook1234"));
    await vi.advanceTimersByTimeAsync(500);
    expect(await f.inspectNow({ profile: "ReadingBooks" })).toMatchObject({
      ok: false,
      diagnostic: { code: "AMBIGUOUS_TARGET" },
    });
    expect(await f.inspectNow({ profile: "Bk3Qn7XvT2Lp" })).toMatchObject({
      ok: true,
      document: { path: BOOKS },
    });
  });

  it("waits for an external source and Shared Partial to reach reconciliation", async () => {
    await using f = await fixture();
    const edited = source.replace("Managed", "External marker");
    f.disk.set(BOOKS, edited);
    f.disk.set(PARTIAL, "External partial marker");
    const result = f.inspectNow({ document: BOOKS, source: "full" });
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

  it("reports a superseded source instead of claiming the first request is current", async () => {
    await using f = await fixture();
    f.disk.set(BOOKS, source.replace("Managed", "Requested marker"));
    const result = f.inspectNow({ document: BOOKS });
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

  it("returns adapter errors with their path and original errno instead of waiting for missing source", async () => {
    await using f = await fixture();
    const timersBefore = vi.getTimerCount();
    f.read.mockRejectedValue(
      Object.assign(new Error("Permission denied by adapter"), {
        code: "EACCES",
      }),
    );
    const response = await f.inspectNow({ document: BOOKS });
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

  it.each([
    {
      state: "valid",
      initial: "Original partial",
      edited: "{% if %}",
      problems: [expect.objectContaining({ message: expect.any(String) })],
    },
    {
      state: "invalid",
      initial: "{% if %}",
      edited: "Repaired partial marker",
      problems: [],
    },
  ])(
    "refreshes dependency problems after an initially $state partial reconciles",
    async ({ initial, edited, problems }) => {
      await using f = await fixture({ [BOOKS]: source, [PARTIAL]: initial });
      f.disk.set(PARTIAL, edited);
      const attempt = f.inspectNow({ document: BOOKS });
      await f.readSignal.promise;
      f.vault.modifyFile(PARTIAL, edited);
      await vi.advanceTimersByTimeAsync(500);
      const result = await attempt;
      expect(result.ok).toBe(true);
      const dependency = result.dependencies.find(
        (entry: { path: string }) => entry.path === PARTIAL,
      );
      expect(dependency.problems).toEqual(problems);
    },
  );
});
