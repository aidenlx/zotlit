import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { CliData } from "obsidian";
import { beforeEach, describe, expect, vi } from "vitest";
import { parse } from "yaml";

import { withAnnotationCitation } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";
import { TemplateError } from "@zotlit/templates/facade";

import { fakeCliHost } from "@/lib/__fixtures__/cli-host";
import { testRuntime } from "@/lib/__fixtures__/runtime";
import { Deferred, Effect, Exit, Fiber } from "@/lib/effect";
import { acquireAsyncDisposable } from "@/lib/effect-scope";
import { it } from "@/lib/effect-vitest";
import { profileServiceFixture } from "@/services/profile/__fixtures__/service";
import { getProfileBinding } from "@/services/profile/bindings";
import {
  inProcessReadsService,
  sharedClientOpener,
} from "@/services/zotero-reads/test-utils";

import { TEMPLATE_CHECK_COMMAND } from "./check";
import { readTemplateData } from "./data";
import { registerTemplateWorkbench } from "./register";

vi.mock("./data", async (original) => ({
  ...(await original<typeof import("./data")>()),
  readTemplateData: vi.fn(),
}));

const PATH = "templates/zotlit-profile.books.md";
const SOURCE = `---
id: Bk3Qn7XvT2Lp
name: Books
version: 1.0.0
contract: 5
filename: "{{ zt.title }}"
frontmatter:
  - key: title
    value: "\u0024{zt.title}"
  - value: { tags: [first] }
  - key: tags
    merge: append
    value: [second]
---
# {{ zt.title }}
{% managed %}Managed{% endmanaged %}
--- zotlit:annotation ---
{{ zt.comment }}`;

async function fixture(
  source = SOURCE,
  notes: Record<string, string> = {},
  client?: NodeDatabaseClient,
) {
  await using stack = new AsyncDisposableStack();
  const f = stack.use(await profileServiceFixture({ [PATH]: source }));
  const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
  await mkdir(resolve(workspaceRoot, ".scratch"), { recursive: true });
  const scratch = await mkdtemp(
    resolve(workspaceRoot, ".scratch/check-draft-"),
  );
  stack.defer(() => rm(scratch, { recursive: true, force: true }));
  Object.assign(f.vault, {
    read: async (file: { path: string }) => f.vault.contents.get(file.path)!,
    getName: () => "Check fixture",
    adapter: {
      getBasePath: () => "/fixture",
      read: async (path: string) => {
        const text = f.vault.contents.get(path);
        if (text === undefined)
          throw Object.assign(new Error("Missing"), { code: "ENOENT" });
        return text;
      },
    },
  });
  const { host, command } = fakeCliHost();
  const noteFiles = Object.entries(notes).map(([path, text]) =>
    f.vault.addFile(path, text),
  );
  const noteIndex = {
    whenIndexed: async () => {},
    getNotesByItemKey: (key: string) => (key === "ABCD2345" ? noteFiles : []),
    getImportedNoteByNoteKey: () => [],
  };
  const zoteroPref = {
    sourceId: "fixture",
    databasePath: "/fixture/db",
    dataDir: "/fixture",
    baseAttachmentPath: null,
  };
  registerTemplateWorkbench({ ...host, manifest: { version: "test" } }, {
    runtime: testRuntime(),
    app: f.app,
    templates: f.template,
    settings: f.settings,
    profile: f.profile,
    zoteroPref,
    noteIndex,
    zoteroReads:
      client && stack.use(inProcessReadsService(sharedClientOpener(client))),
  } as never);
  const cleanup = stack.move();
  return {
    ...f,
    zoteroPref,
    draft: (text: string) =>
      Effect.promise(async () => {
        const path = resolve(scratch, "draft.md");
        await writeFile(path, text);
        return path;
      }),
    check: (params: CliData = {}) =>
      command(TEMPLATE_CHECK_COMMAND)
        .handler({ ...params })
        .pipe(Effect.map(assertRefusalsHint)),
    [Symbol.asyncDispose]: () => cleanup.disposeAsync(),
  };
}

/** {@link fixture}, closed when the test's scope closes. */
const scopedFixture = (...args: Parameters<typeof fixture>) =>
  acquireAsyncDisposable(() => fixture(...args));

/** The parsed answer, once it holds that every refusal carries a hint. */
function assertRefusalsHint(output: string) {
  const answer = JSON.parse(output);
  // The Workbench Guide tells a caller that a failed check answers with
  // `diagnostic.hint`, so every refusal this suite reaches carries one.
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

describe("plain document checks", () => {
  it.effect("rejects a -- token and gives the name=value form", () =>
    Effect.gen(function* () {
      const f = yield* scopedFixture();
      const refused = yield* f.check({ "--key": "ABCD2345" });
      expect(refused).toMatchObject({
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          message: "Parameter '--key' is not valid: use key=<value>.",
          hint: "Run the command with key=<value>, without --.",
          details: { parameter: "--key" },
        },
      });
    }),
  );

  it.effect(
    "recovers from a source assertion on retained lookup without rerunning the check",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture();
        const checked = yield* f.check({
          profile: "Books",
          key: "ABCD2345",
          "expect-source": "fixture",
        });
        expect(checked.ok).toBe(true);
        const refused = yield* f.check({
          attempt: checked.attempt,
          "expect-source": "fixture",
        });
        expect(refused).toMatchObject({
          ok: false,
          diagnostic: {
            code: "INVALID_SELECTOR",
            message:
              "An attempt lookup takes only attempt, output, and evidence.",
            details: { parameter: "expect-source" },
          },
        });
        expect(refused.diagnostic.hint).toContain("omit expect-source");
        expect(
          yield* f.check({
            attempt: checked.attempt,
            profile: "Books",
            output: "bogus",
          }),
        ).toMatchObject({
          ok: false,
          diagnostic: {
            code: "INVALID_SELECTOR",
            message:
              "An attempt lookup takes only attempt, output, and evidence.",
            hint: expect.stringContaining("omit expect-source"),
            details: { parameter: "profile" },
          },
        });
        expect(refused.diagnostic.hint).toContain(
          "attempt=<id> evidence=full output=all",
        );
        f.zoteroPref.sourceId = "later-source";
        const recovered = yield* f.check({
          attempt: checked.attempt,
          evidence: "full",
          output: "all",
        });
        expect(recovered).toMatchObject({ ok: true, attempt: checked.attempt });
        expect(recovered.identity).toEqual(checked.identity);
        expect(recovered.outputs.body).toContain("Paper");
        expect(recovered.checks).toEqual(checked.checks);
      }),
  );

  it.effect(
    "preserves an unreadable binding Profile path in dependency failure evidence",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture();
        const draft = yield* f.draft("Scratch");
        const read = f.app.vault.adapter.read.bind(f.app.vault.adapter);
        vi.spyOn(f.app.vault.adapter, "read").mockImplementation(
          async (path) => {
            if (path === PATH) throw new Error("Unavailable Profile");
            return read(path);
          },
        );
        const result = yield* f.check({
          document: "partial:new",
          draft,
          profile: "Books",
          root: "note",
          key: "ABCD2345",
        });
        expect(result).toMatchObject({
          ok: false,
          diagnostic: { code: "SOURCE_READ_FAILED" },
          bindingContext: {
            freshness: {
              errors: [{ path: PATH, message: "Unavailable Profile" }],
            },
          },
        });
      }),
  );

  it.effect(
    "omits superseded partial output from responses and retained attempts",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture();
        yield* Effect.promise(() =>
          f.template.createPartial("changing", { source: "Before" }),
        );
        const original = f.template.renderPartialSource.bind(f.template);
        vi.spyOn(f.template, "renderPartialSource").mockImplementationOnce(
          (...args) => {
            const output = original(...args);
            f.vault.modifyFile("templates/zotlit-partial.changing.md", "After");
            return output;
          },
        );
        const result = yield* f.check({
          document: "partial:changing",
          root: "note",
          key: "ABCD2345",
          output: "all",
        });
        expect(result).toMatchObject({
          ok: false,
          diagnostic: { code: "SOURCE_SUPERSEDED" },
        });
        expect(result.outputs).toBeUndefined();
        expect(
          (yield* f.check({ attempt: result.attempt, output: "all" })).outputs,
        ).toBeUndefined();
      }),
  );

  it.effect(
    "checks a draft without reading the replaced installed partial",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture();
        yield* Effect.promise(() =>
          f.template.createPartial("replaced", { source: "Installed" }),
        );
        const path = "templates/zotlit-partial.replaced.md";
        f.vault.contents.set(path, "Saved but not reconciled");
        const draft = yield* f.draft("Scratch");
        const result = yield* f.check({
          document: "partial:replaced",
          draft,
          root: "note",
          key: "ABCD2345",
          output: "all",
        });
        expect(result).toMatchObject({
          ok: true,
          outputs: { partial: "Scratch" },
        });
        expect(
          result.bindingContext.freshness.versions.map(
            (entry: { path: string }) => entry.path,
          ),
        ).not.toContain(path);
      }),
  );

  it.effect(
    "keeps an unused annotation Citation lazy and records caller identity on failure",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture();
        const citation = vi.fn(() => {
          throw new Error("Broken derived citation");
        });
        vi.mocked(readTemplateData).mockReturnValue(
          Effect.succeed({
            kind: "data",
            data: Object.defineProperty(
              { comment: "Selected annotation" },
              "citation",
              { get: citation, enumerable: true },
            ),
          }),
        );
        const draft = yield* f.draft("{{ zt.comment }}");
        expect(
          yield* f.check({
            document: "partial:lazy",
            draft,
            root: "annotation",
            key: "ANNQ2345",
            output: "all",
          }),
        ).toMatchObject({
          ok: true,
          outputs: { partial: "Selected annotation" },
        });
        expect(citation).not.toHaveBeenCalled();
        yield* f.draft("{{ zt.citation }}");
        const failed = yield* f.check({
          document: "partial:lazy",
          draft,
          root: "annotation",
          key: "ANNQ2345",
          profile: "Books",
          evidence: "full",
        });
        expect(
          failed.checks.partial.diagnostics[0].report.identity,
        ).toMatchObject({
          partialContext: "annotation",
          partialProfile: "Bk3Qn7XvT2Lp",
        });
      }),
  );

  it.effect(
    "rejects conflicting Profile selectors and supplies gate recovery with Citation identity",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture();
        expect(
          yield* f.check({ document: PATH, profile: "default" }),
        ).toMatchObject({
          ok: false,
          diagnostic: { code: "INVALID_SELECTOR" },
        });
        const draft = yield* f.draft(
          "---\nlanguage: eta\n---\n<%= zt.variant %>",
        );
        const result = yield* f.check({
          document: "citation",
          draft,
          example: "two-items",
          variant: "alt",
          evidence: "full",
        });
        expect(result.diagnostic).toMatchObject({
          hint: expect.any(String),
          evidence: { kind: "javascript-gate" },
          report: {
            identity: { citationVariant: "alt", citationExample: "two-items" },
          },
        });
      }),
  );

  it.effect(
    "checks a new partial draft with selected Profile bindings and retains failed dependency evidence",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture(
          SOURCE.replace("name: Books", "name: Books\nfolder: Selected folder"),
        );
        const before = new Map(f.vault.contents);
        const draft = yield* f.draft(
          "---\nlanguage: liquid\n---\n{{ zt.title }}",
        );
        const result = yield* f.check({
          document: "partial:new",
          draft,
          profile: "Books",
          root: "note",
          key: "ABCD2345",
          output: "all",
        });
        expect(result).toMatchObject({
          ok: true,
          input: { origin: "draft" },
          selectedProfile: { id: "Bk3Qn7XvT2Lp" },
          outputs: { partial: "Paper" },
        });
        expect(
          vi.mocked(readTemplateData).mock.calls.at(-1)?.[0].settings.current,
        ).toMatchObject({ "note.literature-folder": "Selected folder" });
        yield* f.draft("---\nlanguage: liquid\n---\n{% render 'missing' %}");
        const failed = yield* f.check({
          document: "partial:new",
          draft,
          root: "note",
          key: "ABCD2345",
        });
        expect(failed.ok).toBe(false);
        expect(failed.checks.partial.status).toBe("failed");
        const evidence = yield* f.check({
          attempt: failed.attempt,
          evidence: "full",
        });
        expect(evidence.checks.partial.diagnostics[0].report).toBeDefined();
        expect(f.vault.contents).toEqual(before);
      }),
  );

  it.effect("refuses Eta drafts and invalid caller selectors", () =>
    Effect.gen(function* () {
      const f = yield* scopedFixture();
      const draft = yield* f.draft(
        "---\nlanguage: eta\n---\n<%= zt.variant %>",
      );
      expect(
        yield* f.check({ document: "citation", draft, example: "one-item" }),
      ).toMatchObject({
        ok: false,
        diagnostic: { code: "ETA_OPT_IN_REQUIRED" },
      });
      expect(
        yield* f.check({ document: "citation", example: "bad" }),
      ).toMatchObject({ ok: false, diagnostic: { code: "INVALID_SELECTOR" } });
      expect(
        yield* f.check({ document: "citation", root: "note", key: "ABCD2345" }),
      ).toMatchObject({ ok: false, diagnostic: { code: "INVALID_SELECTOR" } });
      expect(
        yield* f.check({ profile: "Books", key: "not-a-key" }),
      ).toMatchObject({
        ok: false,
        diagnostic: { code: "INVALID_SELECTOR", details: { parameter: "key" } },
      });
    }),
  );

  it.effect(
    "takes a baseline in update mode only, and update mode needs a key",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture();
        expect(
          yield* f.check({
            profile: "Books",
            key: "ABCD2345",
            note: "Notes/Paper.md",
          }),
        ).toMatchObject({
          ok: false,
          diagnostic: {
            code: "INVALID_SELECTOR",
            details: { parameter: "mode" },
          },
        });
        expect(
          yield* f.check({ profile: "Books", mode: "update" }),
        ).toMatchObject({
          ok: false,
          diagnostic: {
            code: "INVALID_SELECTOR",
            details: { parameter: "key" },
          },
        });
        expect(
          yield* f.check({
            profile: "Books",
            mode: "update",
            key: "ABCD2345",
            existing: "",
          }),
        ).toMatchObject({ ok: true, baseline: { kind: "supplied" } });
      }),
  );

  it.effect.each([
    { variant: "main", saved: "Saved primary: 2", draft: "Draft primary: 1" },
    {
      variant: "alt",
      saved: "Saved alternate: 2",
      draft: "Draft alternate: 1",
    },
  ])(
    "checks a saved Citation and a scratch draft with variant $variant",
    ({ variant, saved: savedOutput, draft: draftOutput }) =>
      Effect.gen(function* () {
        const f = yield* scopedFixture();
        f.vault.createFile(
          "templates/zotlit-citation.md",
          "---\nlanguage: liquid\n---\nSaved {% if zt.variant == 'alt' %}alternate{% else %}primary{% endif %}: {{ zt.citations.size }}",
        );
        yield* Effect.promise(() => f.template.waitUntilSettled(1000));
        const before = new Map(f.vault.contents);
        const saved = yield* f.check({
          document: "citation",
          example: "two-items",
          variant,
          output: "citation",
        });
        expect(saved.ok).toBe(true);
        expect(saved.checks.citation.status).toBe("passed");
        expect(saved.outputs.citation).toBe(savedOutput);
        const draft = yield* f.draft(
          "---\nlanguage: liquid\n---\nDraft {% if zt.variant == 'alt' %}alternate{% else %}primary{% endif %}: {{ zt.citations.size }}",
        );
        const checked = yield* f.check({
          document: "citation",
          draft,
          example: "one-item",
          variant,
          output: "all",
        });
        expect(checked.ok).toBe(true);
        expect(checked.input.origin).toBe("draft");
        expect(checked.outputs.citation).toBe(draftOutput);
        expect(f.vault.contents).toEqual(before);
      }),
  );

  it.effect.each(["note", "annotation", "citation"])(
    "checks a Shared Partial from the %s root",
    (root) =>
      Effect.gen(function* () {
        const f = yield* scopedFixture();
        yield* Effect.promise(() =>
          f.template.createPartial("example", {
            source: "Partial",
            language: "liquid",
          }),
        );
        const selection: Record<string, string> =
          root === "citation"
            ? { example: "one-item" }
            : { key: root === "annotation" ? "ANNQ2345" : "ABCD2345" };
        const compact = yield* f.check({
          document: "partial:example",
          root,
          ...selection,
        });
        expect(compact, JSON.stringify(compact)).toMatchObject({ ok: true });
        expect(compact.checks.partial.status).toBe("passed");
        expect(compact.outputs).toBeUndefined();
        const full = yield* f.check({
          attempt: compact.attempt,
          output: "partial",
        });
        expect(full.outputs.partial).toBe("Partial");
        const draft = yield* f.draft("---\nlanguage: liquid\n---\n");
        const empty = yield* f.check({
          document: "partial:example",
          draft,
          root,
          ...selection,
          output: "all",
        });
        expect(empty.ok).toBe(true);
        expect(empty.outputs.partial).toBe("");
      }),
  );
});

beforeEach(() => {
  vi.mocked(readTemplateData).mockImplementation((_deps, _key, root) =>
    Effect.succeed({
      kind: "data",
      data:
        root === "filename"
          ? { title: "Paper", indexedKey: "ABCD2345" }
          : root === "annotation"
            ? {
                indexedKey: "ANNQ2345",
                comment: "An observation",
                citation: "(Paper)",
              }
            : {
                indexedKey: "ABCD2345",
                title: "Paper",
                annotations: [
                  { indexedKey: "ANNQ2345", comment: "An observation" },
                ],
              },
    }),
  );
});

describe("registered template-check", () => {
  it.effect(
    "checks a targeted scratch draft and leaves installed source, notes, and settings unchanged",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture();
        f.vault.addFile("notes/existing.md", "Existing note");
        const before = [...f.vault.contents];
        const settings = JSON.stringify(
          yield* Effect.sync(() => f.settings.current),
        );
        const draft = yield* f.draft(
          SOURCE.replace("# {{ zt.title }}", "# Draft {{ zt.title }}"),
        );
        const result = yield* f.check({
          profile: "Books",
          draft,
          key: "ABCD2345",
          output: "all",
        });
        expect(result).toMatchObject({
          ok: true,
          input: { origin: "draft", path: draft },
          document: { profile: { id: "Bk3Qn7XvT2Lp" } },
          outputs: { body: expect.stringContaining("# Draft Paper") },
        });
        expect(result.input.revision).toHaveLength(64);
        expect(result.attemptContext.sourceRevision).toBe(
          result.input.revision,
        );
        expect([...f.vault.contents]).toEqual(before);
        expect(
          JSON.stringify(yield* Effect.sync(() => f.settings.current)),
        ).toBe(settings);
        expect(f.profile.profiles).toHaveLength(1);
        expect(f.template.getLoadedDocumentSource(PATH)).toBe(SOURCE);
        const structural = yield* f.check({ profile: "Books", draft });
        expect(structural).toMatchObject({
          ok: true,
          rendering: "not-checked",
        });
      }),
  );

  it.effect(
    "checks new standalone identities and asserts targeted identity before loading data",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture();
        const draft = yield* f.draft(
          SOURCE.replace("Bk3Qn7XvT2Lp", "Nx4Qn7XvT2Lp").replace(
            "name: Books",
            "name: New draft",
          ),
        );
        const mismatch = yield* f.check({
          profile: "Books",
          draft,
          key: "ABCD2345",
        });
        expect(mismatch).toMatchObject({
          ok: false,
          input: { origin: "draft", path: draft },
          diagnostic: { code: "PROFILE_ID_MISMATCH" },
        });
        expect(readTemplateData).not.toHaveBeenCalled();
        expect(
          yield* f.check({ draft, key: "ABCD2345", output: "fold" }),
        ).toMatchObject({
          ok: true,
          document: { profile: { id: "Nx4Qn7XvT2Lp", label: "New draft" } },
          outputs: {
            fold: { "zotlit-profile": expect.stringContaining("Nx4Qn7XvT2Lp") },
          },
        });
        expect(f.profile.profiles.map((profile) => profile.id)).toEqual([
          "Bk3Qn7XvT2Lp",
        ]);
      }),
  );

  it.effect("refuses a standalone draft identity that is no Profile ID", () =>
    Effect.gen(function* () {
      const f = yield* scopedFixture();
      const draft = yield* f.draft(SOURCE.replace("Bk3Qn7XvT2Lp", "x"));

      expect(yield* f.check({ draft, key: "ABCD2345" })).toMatchObject({
        ok: false,
        input: { origin: "draft", path: draft },
        checks: { structure: { status: "failed" } },
        diagnostic: { code: "INVALID_PROFILE_ID" },
      });
      expect(readTemplateData).not.toHaveBeenCalled();
    }),
  );

  it.effect("stops loading Template Data when the check is interrupted", () =>
    Effect.gen(function* () {
      const f = yield* scopedFixture();
      const draft = yield* f.draft(SOURCE);
      const entered = yield* Deferred.make<void>();
      const released = yield* Deferred.make<void>();
      // The load never answers, so the check is still waiting on it.
      vi.mocked(readTemplateData).mockImplementation(() =>
        Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Deferred.succeed(released, undefined)),
        ),
      );
      const attempt = yield* Effect.forkChild(
        f.check({ draft, key: "ABCD2345", output: "all" }),
      );
      yield* Deferred.await(entered);

      yield* Fiber.interrupt(attempt);

      expect(Exit.hasInterrupts(yield* Fiber.await(attempt))).toBe(true);
      yield* Deferred.await(released);
    }),
  );

  it.effect(
    "refuses a saved Shared Partial whose filename is a reserved name",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture();
        f.vault.createFile(
          "templates/zotlit-partial.note.md",
          "Reserved partial output",
        );
        yield* Effect.promise(() => f.template.waitUntilSettled(1000));

        const answer = yield* f.check({
          document: "partial:note",
          root: "note",
          key: "ABCD2345",
          output: "all",
        });

        expect(answer).toMatchObject({
          ok: false,
          document: { id: "partial:note" },
          diagnostic: { code: "RESERVED_PARTIAL_NAME" },
        });
        expect(answer).not.toHaveProperty("checks");
      }),
  );

  it.effect(
    "binds changed and removed draft overrides against current Default settings",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture(
          SOURCE.replace(
            "contract: 5",
            "contract: 5\nfolder: Installed\ncitationStyle: installed-style",
          ),
        );
        f.settings.updateDefaultLiteratureNoteProfileBindings({
          "note.literature-folder": "Inherited",
          "citation.references-style": "inherited-style",
        });
        const draft = yield* f.draft(
          SOURCE.replace(
            "contract: 5",
            "contract: 5\nfolder: Draft\ncitationStyle: draft-style",
          ),
        );
        expect(
          yield* f.check({
            profile: "Books",
            draft,
            key: "ABCD2345",
            output: "fold",
          }),
        ).toMatchObject({
          ok: true,
          document: {
            profile: {
              bindings: {
                "note.literature-folder": "Draft",
                "citation.references-style": "draft-style",
              },
            },
          },
          outputs: { fold: { "zotlit-csl": "draft-style" } },
        });
        yield* f.draft(SOURCE);
        const inherited = yield* f.check({
          profile: "Books",
          draft,
          key: "ABCD2345",
          output: "fold",
        });
        expect(inherited).toMatchObject({
          ok: true,
          document: {
            profile: {
              bindings: {
                "note.literature-folder": "Inherited",
                "citation.references-style": "inherited-style",
              },
            },
          },
        });
        expect(inherited.outputs.fold["zotlit-csl"]).toBeUndefined();
        const loadedSettings = yield* Effect.sync(
          () =>
            vi.mocked(readTemplateData).mock.calls.at(-1)![0].settings.current,
        );
        expect(
          getProfileBinding(loadedSettings, "citation.references-style"),
        ).toBe("inherited-style");
        expect(
          f.profile.resolveProfile("Bk3Qn7XvT2Lp" as never)?.bindings[
            "note.literature-folder"
          ],
        ).toBe("Installed");
      }),
  );

  it.effect(
    "keeps Default bindings settings-owned and rejects declarations in Default drafts",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture();
        const draft = yield* f.draft(SOURCE.replace("Bk3Qn7XvT2Lp", "default"));
        expect(yield* f.check({ profile: "default", draft })).toMatchObject({
          ok: true,
          document: { profile: { id: "default" } },
        });
        yield* f.draft(
          SOURCE.replace("Bk3Qn7XvT2Lp", "default").replace(
            "contract: 5",
            "contract: 5\nfolder: Forbidden",
          ),
        );
        const invalid = yield* f.check({ profile: "default", draft });
        expect(invalid).toMatchObject({
          ok: false,
          input: { origin: "draft", path: draft },
          checks: { structure: { status: "failed" } },
        });
        expect(invalid.diagnostic.message).toContain(
          "Default Profile bindings belong in settings",
        );
      }),
  );

  it.effect(
    "reports unreadable and malformed drafts with their scratch source origin",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture();
        const path = yield* f.draft("not a Profile document");
        expect(yield* f.check({ draft: path })).toMatchObject({
          ok: false,
          input: { origin: "draft", path },
          checks: { structure: { status: "failed" } },
        });
        const missing = `${path}.missing`;
        expect(yield* f.check({ draft: missing })).toMatchObject({
          ok: false,
          input: { origin: "draft", path: missing, revision: null },
          diagnostic: { code: "DRAFT_READ_FAILED", hint: expect.any(String) },
        });
      }),
  );

  it.effect(
    "checks installed dependencies during a draft attempt and withholds superseded output",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture();
        const draft = yield* f.draft(SOURCE);
        const read = f.app.vault.adapter.read.bind(f.app.vault.adapter);
        let changed = false;
        vi.spyOn(f.app.vault.adapter, "read").mockImplementation(
          async (path) => {
            if (changed && path.endsWith("citation.md"))
              throw new Error("Dependency unreadable");
            return read(path);
          },
        );
        const load = vi.mocked(readTemplateData).getMockImplementation()!;
        vi.mocked(readTemplateData).mockImplementation((...args) => {
          changed = true;
          return load(...args);
        });
        const result = yield* f.check({
          draft,
          key: "ABCD2345",
          output: "all",
        });
        expect(result).toMatchObject({
          ok: false,
          input: { origin: "draft" },
          diagnostic: { code: "SOURCE_SUPERSEDED" },
        });
        expect(result.outputs).toBeUndefined();
        expect(result.checks).toBeUndefined();
        expect(yield* f.check({ draft })).toMatchObject({
          ok: false,
          input: { origin: "draft" },
          diagnostic: { code: "SOURCE_READ_FAILED" },
        });
      }),
  );
  const existing = `---
personal: keep me
title: Old title
zotlit-profile: Books (Bk3Qn7XvT2Lp)
tags: [old]
---
My introduction.
%%zt-managed%%
Old generated text
%%/zt-managed%%
My conclusion.
`;

  it.effect(
    "checks a standalone draft update against an unresolved baseline stamp",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture();
        const draft = yield* f.draft(SOURCE);
        const result = yield* f.check({
          mode: "update",
          draft,
          key: "ABCD2345",
          existing: existing.replace("Bk3Qn7XvT2Lp", "Unk3Qn7XvT2L"),
          output: "body",
        });
        expect(result).toMatchObject({
          ok: true,
          input: { origin: "draft" },
          selectedProfile: { id: "Bk3Qn7XvT2Lp" },
          proposedProfileChange: true,
          operation: { outcome: "previewed" },
        });
        expect(result.outputs.body).toContain("My introduction.");
        expect(result.outputs.body).toContain("Managed");
        expect(result.outputs.body).not.toContain("Old generated text");
      }),
  );

  it.effect(
    "checks a scratch spread and body edit against a saved note in every output mode",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture(SOURCE, { "Notes/Paper.md": existing });
        const before = new Map(f.vault.contents);
        const draft = yield* f.draft(
          SOURCE.replace(
            "  - value: { tags: [first] }",
            "  - value: { tags: [first], reviewed: true }",
          ).replace("%}Managed{%", "%}New generated paragraph{%"),
        );
        const params = {
          draft,
          mode: "update",
          key: "ABCD2345",
          note: "Notes/Paper.md",
          "expect-source": "fixture",
        };
        const compact = yield* f.check(params);
        const selected = yield* f.check({
          ...params,
          output: "body,frontmatter",
        });
        const all = yield* f.check({ ...params, output: "all" });
        for (const result of [compact, selected, all]) {
          expect(result).toMatchObject({
            ok: true,
            input: { origin: "draft" },
            baseline: { kind: "real", path: "Notes/Paper.md" },
            operation: { outcome: "previewed" },
          });
          expect(result.checks).toEqual(compact.checks);
        }
        expect(compact.outputs).toBeUndefined();
        expect(selected.outputs).toEqual({
          body: all.outputs.body,
          frontmatter: all.outputs.frontmatter,
        });
        expect(all.outputs.body).toBe(
          "My introduction.\n%%zt-managed%%\nNew generated paragraph\n\n%%/zt-managed%%\nMy conclusion.\n",
        );
        expect(parse(all.outputs.frontmatter)).toMatchObject({
          personal: "keep me",
          reviewed: true,
          title: "Paper",
        });
        expect(f.vault.contents).toEqual(before);
      }),
  );

  it.effect.each(["real", "supplied"] as const)(
    "updates the %s baseline through its stamp and keeps user text and key order",
    (kind) =>
      Effect.gen(function* () {
        const f = yield* scopedFixture(
          SOURCE,
          kind === "real" ? { "Notes/Paper.md": existing } : {},
        );
        const before = new Map(f.vault.contents);
        const result = yield* f.check({
          mode: "update",
          key: "ABCD2345",
          ...(kind === "supplied" ? { existing } : {}),
          output: "all",
        });
        expect(result).toMatchObject({
          ok: true,
          baseline: {
            kind,
            path: kind === "real" ? "Notes/Paper.md" : null,
            profile: { id: "Bk3Qn7XvT2Lp" },
          },
          selectedProfile: { id: "Bk3Qn7XvT2Lp" },
          proposedProfileChange: false,
          operation: { outcome: "previewed" },
          attemptContext: { mode: "update" },
        });
        expect(result.outputs.body).toBe(
          "My introduction.\n%%zt-managed%%\nManaged\n\n%%/zt-managed%%\nMy conclusion.\n",
        );
        expect(result.outputs.fold).toMatchObject({
          personal: "keep me",
          title: "Paper",
          tags: ["first", "second"],
        });
        expect(
          Object.keys(parse(result.outputs.frontmatter)).slice(0, 4),
        ).toEqual(["personal", "title", "zotlit-profile", "tags"]);
        expect(f.vault.contents).toEqual(before);
        const retained = yield* f.check({
          attempt: result.attempt,
          output: "body",
        });
        expect(retained.outputs).toEqual({
          body: "My introduction.\n%%zt-managed%%\nManaged\n\n%%/zt-managed%%\nMy conclusion.\n",
        });
      }),
  );

  it.effect(
    "requires an explicit path for duplicate notes and reports a proposed Profile change",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture(SOURCE, {
          "Notes/One.md": existing,
          "Notes/Two.md": existing,
        });
        const duplicate = yield* f.check({ mode: "update", key: "ABCD2345" });
        expect(duplicate).toMatchObject({
          ok: false,
          diagnostic: {
            code: "duplicate-literature-notes",
            candidates: ["Notes/One.md", "Notes/Two.md"],
          },
        });
        const result = yield* f.check({
          mode: "update",
          key: "ABCD2345",
          note: "Notes/Two.md",
          profile: "default",
          output: "fold",
        });
        expect(result).toMatchObject({
          ok: true,
          baseline: { path: "Notes/Two.md", profile: { id: "Bk3Qn7XvT2Lp" } },
          selectedProfile: { id: "default" },
          proposedProfileChange: true,
        });
        expect(result.outputs.fold).not.toHaveProperty("zotlit-profile");
      }),
  );

  it.effect.each(["ABCD2345", "ATCH2345", "NATE2345"])(
    "uses the selected parent note in real loader output for %s",
    (key) =>
      Effect.gen(function* () {
        using stack = new DisposableStack();
        const client = stack.adopt(createClient(":memory:"), (value) =>
          (value.$client as DatabaseSync).close(),
        );
        const sqlite = client.$client as DatabaseSync;
        createFixtureSchema(sqlite);
        sqlite.exec(`
      insert into libraries (libraryID, type) values (1, 'user');
      insert into itemTypes (itemTypeID, typeName) values (1, 'journalArticle'), (2, 'attachment'), (3, 'note');
      insert into items (itemID, itemTypeID, libraryID, key) values
        (1, 1, 1, 'ABCD2345'), (2, 2, 1, 'ATCH2345'), (3, 3, 1, 'NATE2345');
      update items set dateAdded = '2024-01-01 00:00:00', dateModified = '2024-01-01 00:00:00';
      insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
        values (2, 1, 0, 'application/pdf', 'storage:paper.pdf');
      insert into itemNotes (itemID, parentItemID, note, title) values (3, 1, '<p>Child</p>', 'Child');
      PRAGMA query_only = ON;
    `);
        const actual = yield* Effect.promise(() =>
          vi.importActual<typeof import("./data")>("./data"),
        );
        vi.mocked(readTemplateData).mockImplementation(actual.readTemplateData);
        const f = yield* scopedFixture(
          SOURCE.replace("%}Managed{%", "%}{{ zt.notePath }}{%"),
          {
            "Notes/One.md": existing.replace("My introduction.", "First note."),
            "Notes/Two.md": existing.replace(
              "My introduction.",
              "Second note.",
            ),
          },
          client,
        );
        Object.assign(f.app.fileManager, {
          generateMarkdownLink: (file: { path: string }) => `[[${file.path}]]`,
          getAvailablePathForAttachment: async () => "images/probe.png",
        });
        const duplicate = yield* f.check({ mode: "update", key });
        expect(duplicate, JSON.stringify(duplicate)).toMatchObject({
          ok: false,
          diagnostic: {
            code: "duplicate-literature-notes",
            candidates: ["Notes/One.md", "Notes/Two.md"],
          },
        });
        const result = yield* f.check({
          mode: "update",
          key,
          note: "Notes/Two.md",
          output: "body",
        });
        expect(result, JSON.stringify(result)).toMatchObject({
          ok: true,
          baseline: {
            kind: "real",
            indexedKey: "ABCD2345",
            path: "Notes/Two.md",
          },
        });
        expect(result.outputs.body).toBe(
          "Second note.\n%%zt-managed%%\nNotes/Two.md\n\n%%/zt-managed%%\nMy conclusion.\n",
        );
      }),
  );

  it.effect(
    "resolves the item's Literature Note links under a supplied baseline",
    () =>
      Effect.gen(function* () {
        using stack = new DisposableStack();
        const client = stack.adopt(createClient(":memory:"), (value) =>
          (value.$client as DatabaseSync).close(),
        );
        const sqlite = client.$client as DatabaseSync;
        createFixtureSchema(sqlite);
        sqlite.exec(`
      insert into libraries (libraryID, type) values (1, 'user');
      insert into itemTypes (itemTypeID, typeName) values (1, 'journalArticle');
      insert into items (itemID, itemTypeID, libraryID, key) values (1, 1, 1, 'ABCD2345');
      update items set dateAdded = '2024-01-01 00:00:00', dateModified = '2024-01-01 00:00:00';
      PRAGMA query_only = ON;
    `);
        const actual = yield* Effect.promise(() =>
          vi.importActual<typeof import("./data")>("./data"),
        );
        vi.mocked(readTemplateData).mockImplementation(actual.readTemplateData);
        const f = yield* scopedFixture(
          SOURCE.replace(
            "%}Managed{%",
            "%}{{ zt.notePath }} {{ zt.noteLink }}{%",
          ),
          { "Notes/Paper.md": existing },
          client,
        );
        Object.assign(f.app.fileManager, {
          generateMarkdownLink: (file: { path: string }) => `[[${file.path}]]`,
          getAvailablePathForAttachment: async () => "images/probe.png",
        });
        const result = yield* f.check({
          mode: "update",
          key: "ABCD2345",
          existing,
          output: "body",
        });
        expect(result, JSON.stringify(result)).toMatchObject({
          ok: true,
          baseline: { kind: "supplied", path: null },
        });
        expect(result.outputs.body).toBe(
          "My introduction.\n%%zt-managed%%\nNotes/Paper.md [[Notes/Paper.md]]\n\n%%/zt-managed%%\nMy conclusion.\n",
        );
      }),
  );

  it.effect(
    "retains the selected baseline identity and recovery when reading its bytes fails",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture(SOURCE, {
          "Notes/Unreadable.md": existing,
        });
        vi.spyOn(f.app.vault, "cachedRead").mockRejectedValue(
          new Error("Permission denied"),
        );
        const result = yield* f.check({ mode: "update", key: "ABCD2345" });
        expect(result).toMatchObject({
          ok: false,
          baseline: {
            kind: "real",
            path: "Notes/Unreadable.md",
            indexedKey: "ABCD2345",
            revision: null,
          },
          diagnostic: {
            code: "BASELINE_READ_FAILED",
            hint: "Restore access to 'Notes/Unreadable.md' and correct its frontmatter, then run the check again with note=Notes/Unreadable.md.",
          },
        });
      }),
  );

  it.effect.each(["real", "supplied"] as const)(
    "retains the %s baseline identity and recovery for invalid frontmatter",
    (kind) =>
      Effect.gen(function* () {
        const malformed = "---\ntags: [broken\n---\nMy note";
        const f = yield* scopedFixture(
          SOURCE,
          kind === "real" ? { "Notes/Broken.md": malformed } : {},
        );
        const result = yield* f.check({
          mode: "update",
          key: "ABCD2345",
          ...(kind === "supplied" ? { existing: malformed } : {}),
        });
        expect(result).toMatchObject({
          ok: false,
          baseline: {
            kind,
            path: kind === "real" ? "Notes/Broken.md" : null,
            revision: expect.any(String),
          },
          diagnostic: {
            code: "BASELINE_READ_FAILED",
            hint:
              kind === "real"
                ? "Restore access to 'Notes/Broken.md' and correct its frontmatter, then run the check again with note=Notes/Broken.md."
                : "Correct the supplied existing=<text> frontmatter and run the check again.",
          },
        });
      }),
  );

  it.effect(
    "labels a synthetic baseline and preserves a supplied static body",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture();
        const synthetic = yield* f.check({
          mode: "update",
          key: "ABCD2345",
          profile: "Books",
          output: "body",
        });
        expect(synthetic).toMatchObject({
          ok: true,
          baseline: { kind: "synthetic", path: null, revision: null },
          outputs: {
            body: "# Paper\n%%zt-managed%%\nManaged\n\n%%/zt-managed%%\n",
          },
        });
        const result = yield* f.check({
          mode: "update",
          key: "ABCD2345",
          existing: "My static note.\n",
          profile: "Books",
          output: "body",
        });
        expect(result.outputs.body).toBe("My static note.\n");
      }),
  );

  it.effect(
    "reports append conflicts, keep/replace, spread omission and static deletion against the baseline",
    () =>
      Effect.gen(function* () {
        const source = `---
id: Bk3Qn7XvT2Lp
name: Books
version: 1.0.0
contract: 5
filename: Paper
frontmatter:
  - key: tags
    merge: append
    value: [new]
  - key: personal
    merge: keep
    value: ignored
  - key: title
    value: Changed
  - key: remove
    value: { $if: 'false', then: value }
  - value: { $if: 'false', then: { untouched: no } }
---
Static template
--- zotlit:annotation ---
Annotation`;
        const f = yield* scopedFixture(source);
        const result = yield* f.check({
          mode: "update",
          key: "ABCD2345",
          profile: "Books",
          existing:
            "---\npersonal: Mine\ntags: conflict\nremove: old\nuntouched: retained\n---\nPersonal body",
          output: "all",
        });
        expect(result, JSON.stringify(result)).toMatchObject({
          ok: true,
          checks: {
            body: { behavior: "static-body" },
            fold: {
              diagnostics: [{ code: "property-append-conflict", position: 1 }],
            },
          },
        });
        expect(result.outputs.body).toBe("Personal body");
        expect(result.outputs.fold).toMatchObject({
          personal: "Mine",
          tags: "conflict",
          untouched: "retained",
          title: "Changed",
        });
        expect(result.outputs.fold).not.toHaveProperty("remove");
        expect(result.outputs.properties).toEqual(
          expect.arrayContaining([
            {
              key: "remove",
              position: 4,
              missing: true,
              merge: "replace",
              omission: "static-key-deleted",
            },
            {
              position: 5,
              missing: true,
              omission: "spread-omitted",
              merge: "replace",
            },
          ]),
        );
      }),
  );

  it.effect("refuses failed properties without presenting a partial fold", () =>
    Effect.gen(function* () {
      const f = yield* scopedFixture(
        SOURCE.replace(
          'value: "${zt.title}"',
          'value: { $eval: "missing.value" }',
        ),
      );
      const result = yield* f.check({
        mode: "update",
        key: "ABCD2345",
        existing,
        output: "all",
      });
      expect(result).toMatchObject({
        ok: false,
        operation: { outcome: "refused" },
        checks: {
          properties: { status: "failed" },
          fold: { status: "not-checked" },
          frontmatter: { status: "not-checked" },
        },
      });
      expect(result.outputs).not.toHaveProperty("fold");
    }),
  );

  it.effect(
    "checks all create components, folds independent contributions, and discloses complete output",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture();
        const result = yield* f.check({
          profile: "Books",
          key: "ABCD2345",
          output: "all",
        });
        expect(result.ok, JSON.stringify(result)).toBe(true);
        expect(result.freshness.state).toBe("current");
        expect(result.outputs.filename).toBe("Paper");
        expect(result.outputs.body).toContain("# Paper");
        expect(result.outputs.managed).toContain("Managed");
        expect(result.outputs.properties).toMatchObject([
          { key: "title", value: "Paper", position: 1 },
          { key: "tags", value: ["first"], position: 2 },
          { key: "tags", value: ["second"], position: 3 },
        ]);
        expect(result.outputs.fold).toMatchObject({
          title: "Paper",
          tags: ["first", "second"],
          "zotero-key": "ABCD2345",
        });
        expect(parse(result.outputs.frontmatter)).toEqual(result.outputs.fold);
        expect(result.outputs.annotations).toMatchObject([
          {
            key: "ANNQ2345",
            check: { status: "passed", output: "An observation" },
          },
        ]);
        const compact = yield* f.check({ attempt: result.attempt });
        expect(compact.checks).toEqual(result.checks);
        expect(compact.outputs).toBeUndefined();
        const selected = yield* f.check({
          attempt: result.attempt,
          output: "filename,managed",
        });
        expect(Object.keys(selected.outputs)).toEqual(["filename", "managed"]);
        expect(selected.checks).toEqual(compact.checks);
      }),
  );

  it.effect(
    "validates saved and built-in Profiles structurally without loading an item",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture();
        for (const profile of ["Books", "default"]) {
          const result = yield* f.check({ profile });
          expect(result).toMatchObject({
            ok: true,
            rendering: "not-checked",
            checks: {
              structure: { status: "passed" },
              body: { status: "not-checked" },
            },
          });
        }
        expect(readTemplateData).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    "fails an undisclosed annotation and keeps the failed attempt evidence after a new run",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture(
          SOURCE.replace(
            "{{ zt.comment }}",
            '{% render "absent" with zt as zt %}',
          ),
        );
        const failed = yield* f.check({
          profile: "Books",
          key: "ABCD2345",
          output: "filename",
        });
        expect(failed).toMatchObject({
          ok: false,
          outputs: { filename: "Paper" },
          checks: {
            body: { status: "passed" },
            annotations: {
              status: "failed",
              diagnostics: [{ code: "missing-partial" }],
            },
          },
        });
        expect(
          failed.checks.annotations.diagnostics[0].evidence,
        ).toBeUndefined();
        const evidence = yield* f.check({
          attempt: failed.attempt,
          evidence: "full",
          output: "all",
        });
        expect(
          evidence.checks.annotations.diagnostics[0].evidence,
        ).toBeDefined();
        const rerun = yield* f.check({ profile: "Books", key: "ABCD2345" });
        expect(rerun.attempt).not.toBe(failed.attempt);
        expect(
          yield* f.check({
            attempt: failed.attempt,
            evidence: "full",
            output: "all",
          }),
        ).toEqual(evidence);
      }),
  );

  it.effect("runs independent components when a body partial fails", () =>
    Effect.gen(function* () {
      const f = yield* scopedFixture(
        SOURCE.replace(
          "# {{ zt.title }}",
          '{% render "absent" with zt as zt %}',
        ),
      );
      expect(
        yield* f.check({ profile: "Books", key: "ABCD2345" }),
      ).toMatchObject({
        ok: false,
        checks: {
          body: { status: "failed" },
          filename: { status: "passed" },
          fold: { status: "passed" },
          annotations: { status: "passed" },
        },
      });
    }),
  );

  it.effect("reports JSON-e entry errors with their key and position", () =>
    Effect.gen(function* () {
      const f = yield* scopedFixture(
        SOURCE.replace(
          'value: "\u0024{zt.title}"',
          "value: { $eval: missing.property }",
        ),
      );
      const result = yield* f.check({
        profile: "Books",
        key: "ABCD2345",
        output: "filename",
      });
      expect(result).toMatchObject({
        ok: false,
        checks: {
          properties: {
            status: "failed",
            diagnostics: [{ key: "title", position: 1 }],
          },
          filename: { status: "passed" },
        },
      });
    }),
  );

  it.effect("refuses an inert JS spread before compilation", () =>
    Effect.gen(function* () {
      const f = yield* scopedFixture(
        SOURCE.replace(
          "  - key: tags\n    merge: append\n    value: [second]",
          '  - js: "invalid javascript !!!"',
        ),
      );
      const compile = vi.spyOn(
        f.template,
        "prepareLiteratureNoteTemplateSource",
      );
      const result = yield* f.check({ profile: "Books", key: "ABCD2345" });
      expect(result).toMatchObject({
        ok: false,
        diagnostic: { code: "ETA_OPT_IN_REQUIRED" },
        checks: {
          properties: {
            status: "failed",
            entries: [{ position: 3, status: "failed" }],
            diagnostics: [{ code: "property-javascript", position: 3 }],
          },
        },
      });
      const evidence = yield* f.check({
        attempt: result.attempt,
        evidence: "full",
      });
      expect(evidence.diagnostic.evidence).toMatchObject({
        kind: "javascript-gate",
        enabled: false,
        entries: [{ position: 3, expression: "invalid javascript !!!" }],
      });
      expect(compile).not.toHaveBeenCalled();
    }),
  );

  it.effect(
    "uses the native annotation root and retains Citation Template failure reports",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture(
          SOURCE.replace("{{ zt.comment }}", "{{ zt.citation }}"),
        );
        const load = vi.mocked(readTemplateData).getMockImplementation()!;
        let broken = false;
        vi.mocked(readTemplateData).mockImplementation((deps, key, root) =>
          root === "annotation"
            ? Effect.succeed({
                kind: "data",
                data: withAnnotationCitation(
                  { indexedKey: key } as never,
                  () => {
                    if (broken)
                      throw new TemplateError("Citation failed", "citation");
                    return "(Citation present)";
                  },
                ),
              })
            : load(deps, key, root),
        );
        expect(
          yield* f.check({
            profile: "Books",
            key: "ABCD2345",
            output: "annotations",
          }),
        ).toMatchObject({
          ok: true,
          outputs: {
            annotations: [{ check: { output: "(Citation present)" } }],
          },
        });
        broken = true;
        const failed = yield* f.check({
          profile: "Books",
          key: "ABCD2345",
          evidence: "full",
        });
        expect(failed).toMatchObject({
          ok: false,
          checks: {
            annotations: {
              status: "failed",
              diagnostics: [
                {
                  report: {
                    context: {
                      selection: "ANNQ2345",
                      root: "annotation",
                      zotlitVersion: "test",
                      hostVersion: "Obsidian 1.0.0-test",
                    },
                    identity: {
                      previewMode: "create",
                      snapshotRevision: failed.attemptContext.dataRevision,
                    },
                  },
                },
              ],
            },
          },
        });
        expect(failed.attemptContext.dataRevision).toHaveLength(64);
      }),
  );

  it.effect(
    "binds two annotation failure reports to their own loaded roots and revisions",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture();
        const load = vi.mocked(readTemplateData).getMockImplementation()!;
        let firstComment = "First revision";
        vi.mocked(readTemplateData).mockImplementation((deps, key, root) =>
          Effect.gen(function* () {
            if (root === "annotation")
              return {
                kind: "data" as const,
                data: withAnnotationCitation(
                  {
                    indexedKey: key,
                    comment:
                      key === "ANNQ2345" ? firstComment : "Second annotation",
                  } as never,
                  () => {
                    throw new TemplateError(
                      `Citation failed for ${key}`,
                      "citation",
                    );
                  },
                ),
              };
            const loaded = yield* load(deps, key, root);
            if (root !== "note" || loaded.kind !== "data") return loaded;
            return {
              kind: "data" as const,
              data: {
                ...loaded.data,
                annotations: [
                  { indexedKey: "ANNQ2345" },
                  { indexedKey: "1:ANNO6789" },
                ],
              },
            };
          }),
        );
        const failed = yield* f.check({
          profile: "Books",
          key: "ABCD2345",
          evidence: "full",
        });
        const diagnostics = failed.checks.annotations.diagnostics;
        expect(diagnostics).toMatchObject([
          {
            evidence: { message: "Citation failed for ANNQ2345" },
            report: {
              section: "annotation",
              context: { root: "annotation", selection: "ANNQ2345" },
              identity: { annotationId: "ANNQ2345" },
            },
          },
          {
            evidence: { message: "Citation failed for 1:ANNO6789" },
            report: {
              section: "annotation",
              context: { root: "annotation", selection: "1:ANNO6789" },
              identity: { annotationId: "1:ANNO6789" },
            },
          },
        ]);
        const firstRevision = diagnostics[0].report.identity.annotationRevision;
        const secondRevision =
          diagnostics[1].report.identity.annotationRevision;
        expect(firstRevision).toHaveLength(64);
        expect(secondRevision).toHaveLength(64);
        expect(firstRevision).not.toBe(secondRevision);
        firstComment = "Changed annotation data";
        const rerun = yield* f.check({
          profile: "Books",
          key: "ABCD2345",
          evidence: "full",
        });
        expect(
          rerun.checks.annotations.diagnostics[0].report.identity
            .annotationRevision,
        ).not.toBe(firstRevision);
        expect(
          rerun.checks.annotations.diagnostics[1].report.identity
            .annotationRevision,
        ).toBe(secondRevision);
        expect(
          yield* f.check({ attempt: failed.attempt, evidence: "full" }),
        ).toEqual(failed);
      }),
  );

  it.effect(
    "preserves authored evidence properties in selected and full output",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture(
          SOURCE.replace(
            'value: "\u0024{zt.title}"',
            "value: { evidence: authored, nested: { evidence: retained } }",
          ),
        );
        const result = yield* f.check({
          profile: "Books",
          key: "ABCD2345",
          output: "fold",
        });
        expect(result.outputs.fold.title).toEqual({
          evidence: "authored",
          nested: { evidence: "retained" },
        });
        expect(
          yield* f.check({ attempt: result.attempt, output: "all" }),
        ).toMatchObject({
          outputs: { fold: { title: { evidence: "authored" } } },
        });
      }),
  );

  it.effect(
    "withholds completed checks and outputs when post-check source identity fails",
    () =>
      Effect.gen(function* () {
        const f = yield* scopedFixture();
        let reads = 0;
        Object.defineProperty(f.zoteroPref, "sourceId", {
          get: () => (++reads === 1 ? "fixture" : "changed"),
        });
        const result = yield* f.check({
          profile: "Books",
          key: "ABCD2345",
          output: "all",
          "expect-source": "fixture",
        });
        expect(result).toMatchObject({
          ok: false,
          diagnostic: { code: "SOURCE_SUPERSEDED" },
        });
        expect(result.checks).toBeUndefined();
        expect(result.outputs).toBeUndefined();
      }),
  );

  it.effect("treats empty rendered outputs as success", () =>
    Effect.gen(function* () {
      const f = yield* scopedFixture(
        SOURCE.replace(
          'filename: "{{ zt.title }}"',
          'filename: "{{ zt.missing }}"',
        )
          .replace(
            "# {{ zt.title }}\n{% managed %}Managed{% endmanaged %}\n",
            "",
          )
          .replace("{{ zt.comment }}", ""),
      );
      const result = yield* f.check({
        profile: "Books",
        key: "ABCD2345",
        output: "all",
      });
      expect(result).toMatchObject({
        ok: true,
        outputs: {
          filename: "",
          body: "\n",
          annotations: [{ check: { status: "passed", output: "" } }],
        },
      });
    }),
  );
});
