import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { CliHandler, Plugin } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import { withAnnotationCitation } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";
import { TemplateError } from "@zotlit/templates/facade";

import type { DatabaseService } from "@/services/database/service";
import { profileServiceFixture } from "@/services/profile/__fixtures__/service";
import { getProfileBinding } from "@/services/profile/bindings";

import { TEMPLATE_CHECK_COMMAND } from "./check";
import { loadTemplateData } from "./data";
import { registerTemplateWorkbench } from "./register";

vi.mock("./data", async (original) => ({
  ...(await original<typeof import("./data")>()),
  loadTemplateData: vi.fn(),
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
  db?: Pick<DatabaseService, "acquireRead">,
) {
  await using stack = new AsyncDisposableStack();
  const f = stack.use(await profileServiceFixture({ [PATH]: source }));
  const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
  await mkdir(resolve(workspaceRoot, "tmp"), { recursive: true });
  const scratch = await mkdtemp(resolve(workspaceRoot, "tmp/check-draft-"));
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
  const handlers = new Map<string, CliHandler>();
  const noteFiles = Object.entries(notes).map(([path, text]) =>
    f.vault.addFile(path, text),
  );
  const noteIndex = {
    whenIndexed: async () => {},
    getNotesByItemKey: (key: string) =>
      key === "ABCD2345" || key === "1:ABCD2345" ? noteFiles : [],
    getImportedNoteByNoteKey: () => [],
  };
  const zoteroPref = {
    ready: Promise.resolve(),
    sourceId: "fixture",
    databasePath: "/fixture/db",
    dataDir: "/fixture",
    baseAttachmentPath: null,
  };
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
      zoteroPref,
      noteIndex,
      db,
    } as never,
  );
  const cleanup = stack.move();
  return {
    ...f,
    zoteroPref,
    draft: async (text: string) => {
      const path = resolve(scratch, "draft.md");
      await writeFile(path, text);
      return path;
    },
    check: async (params: Parameters<CliHandler>[0] = {}) =>
      JSON.parse(
        (await handlers.get(TEMPLATE_CHECK_COMMAND)!({ ...params })) as string,
      ),
    [Symbol.asyncDispose]: () => cleanup.disposeAsync(),
  };
}

describe("plain document checks", () => {
  it("recovers from a source assertion on retained lookup without rerunning the check", async () => {
    await using f = await fixture();
    const checked = await f.check({
      profile: "Books",
      key: "ABCD2345",
      "expect-source": "fixture",
    });
    expect(checked.ok).toBe(true);
    const refused = await f.check({
      attempt: checked.attempt,
      "expect-source": "fixture",
    });
    expect(refused).toMatchObject({
      ok: false,
      diagnostic: { code: "INVALID_SELECTOR" },
    });
    expect(refused.diagnostic.hint).toContain("omit expect-source");
    expect(refused.diagnostic.hint).toContain(
      "attempt=<id> evidence=full output=all",
    );
    f.zoteroPref.sourceId = "later-source";
    const recovered = await f.check({
      attempt: checked.attempt,
      evidence: "full",
      output: "all",
    });
    expect(recovered).toMatchObject({ ok: true, attempt: checked.attempt });
    expect(recovered.identity).toEqual(checked.identity);
    expect(recovered.outputs.body).toContain("Paper");
    expect(recovered.checks).toEqual(checked.checks);
  });

  it("preserves an unreadable binding Profile path in dependency failure evidence", async () => {
    await using f = await fixture();
    const draft = await f.draft("Scratch");
    const read = f.app.vault.adapter.read.bind(f.app.vault.adapter);
    vi.spyOn(f.app.vault.adapter, "read").mockImplementation(async (path) => {
      if (path === PATH) throw new Error("Unavailable Profile");
      return read(path);
    });
    const result = await f.check({
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
        freshness: { errors: [{ path: PATH, message: "Unavailable Profile" }] },
      },
    });
  });

  it("omits superseded partial output from responses and retained attempts", async () => {
    await using f = await fixture();
    await f.template.createPartial("changing", { source: "Before" });
    const original = f.template.renderPartialSource.bind(f.template);
    vi.spyOn(f.template, "renderPartialSource").mockImplementationOnce(
      (...args) => {
        const output = original(...args);
        f.vault.modifyFile("templates/zotlit-partial.changing.md", "After");
        return output;
      },
    );
    const result = await f.check({
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
      (await f.check({ attempt: result.attempt, output: "all" })).outputs,
    ).toBeUndefined();
  });

  it("checks a draft without reading the replaced installed partial", async () => {
    await using f = await fixture();
    await f.template.createPartial("replaced", { source: "Installed" });
    const path = "templates/zotlit-partial.replaced.md";
    f.vault.contents.set(path, "Saved but not reconciled");
    const draft = await f.draft("Scratch");
    const result = await f.check({
      document: "partial:replaced",
      draft,
      root: "note",
      key: "ABCD2345",
      output: "all",
    });
    expect(result).toMatchObject({ ok: true, outputs: { partial: "Scratch" } });
    expect(
      result.bindingContext.freshness.versions.map(
        (entry: { path: string }) => entry.path,
      ),
    ).not.toContain(path);
  });

  it("keeps an unused annotation Citation lazy and records caller identity on failure", async () => {
    await using f = await fixture();
    const citation = vi.fn(() => {
      throw new Error("Broken derived citation");
    });
    vi.mocked(loadTemplateData).mockResolvedValue({
      kind: "data",
      data: Object.defineProperty(
        { comment: "Selected annotation" },
        "citation",
        { get: citation, enumerable: true },
      ),
    });
    const draft = await f.draft("{{ zt.comment }}");
    expect(
      await f.check({
        document: "partial:lazy",
        draft,
        root: "annotation",
        key: "ANNO2345",
        output: "all",
      }),
    ).toMatchObject({ ok: true, outputs: { partial: "Selected annotation" } });
    expect(citation).not.toHaveBeenCalled();
    await f.draft("{{ zt.citation }}");
    const failed = await f.check({
      document: "partial:lazy",
      draft,
      root: "annotation",
      key: "ANNO2345",
      profile: "Books",
      evidence: "full",
    });
    expect(failed.checks.partial.diagnostics[0].report.identity).toMatchObject({
      partialContext: "annotation",
      partialProfile: "Bk3Qn7XvT2Lp",
    });
  });

  it("rejects conflicting Profile selectors and supplies gate recovery with Citation identity", async () => {
    await using f = await fixture();
    expect(await f.check({ document: PATH, profile: "default" })).toMatchObject(
      { ok: false, diagnostic: { code: "INVALID_SELECTOR" } },
    );
    const draft = await f.draft("---\nlanguage: eta\n---\n<%= zt.variant %>");
    const result = await f.check({
      document: "citation",
      draft,
      example: "two-items",
      variant: "alt",
      evidence: "full",
    });
    expect(result.diagnostic).toMatchObject({
      recovery: expect.any(String),
      evidence: { kind: "javascript-gate" },
      report: {
        identity: { citationVariant: "alt", citationExample: "two-items" },
      },
    });
  });

  it("checks a new partial draft with selected Profile bindings and retains failed dependency evidence", async () => {
    await using f = await fixture(
      SOURCE.replace("name: Books", "name: Books\nfolder: Selected folder"),
    );
    const before = new Map(f.vault.contents);
    const draft = await f.draft("---\nlanguage: liquid\n---\n{{ zt.title }}");
    const result = await f.check({
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
    await expect(
      vi.mocked(loadTemplateData).mock.calls.at(-1)?.[0].settings.loaded,
    ).resolves.toMatchObject({ "note.literature-folder": "Selected folder" });
    await f.draft("---\nlanguage: liquid\n---\n{% render 'missing' %}");
    const failed = await f.check({
      document: "partial:new",
      draft,
      root: "note",
      key: "ABCD2345",
    });
    expect(failed.ok).toBe(false);
    expect(failed.checks.partial.status).toBe("failed");
    const evidence = await f.check({
      attempt: failed.attempt,
      evidence: "full",
    });
    expect(evidence.checks.partial.diagnostics[0].report).toBeDefined();
    expect(f.vault.contents).toEqual(before);
  });

  it("refuses Eta drafts and invalid caller selectors", async () => {
    await using f = await fixture();
    const draft = await f.draft("---\nlanguage: eta\n---\n<%= zt.variant %>");
    expect(
      await f.check({ document: "citation", draft, example: "one-item" }),
    ).toMatchObject({ ok: false, diagnostic: { code: "ETA_OPT_IN_REQUIRED" } });
    expect(
      await f.check({ document: "citation", example: "bad" }),
    ).toMatchObject({ ok: false, diagnostic: { code: "INVALID_SELECTOR" } });
    expect(
      await f.check({ document: "citation", root: "note", key: "ABCD2345" }),
    ).toMatchObject({ ok: false, diagnostic: { code: "INVALID_SELECTOR" } });
  });

  it.each([
    { variant: "main", saved: "Saved primary: 2", draft: "Draft primary: 1" },
    {
      variant: "alt",
      saved: "Saved alternate: 2",
      draft: "Draft alternate: 1",
    },
  ])(
    "checks a saved Citation and a scratch draft with variant $variant",
    async ({ variant, saved: savedOutput, draft: draftOutput }) => {
      await using f = await fixture();
      f.vault.createFile(
        "templates/zotlit-citation.md",
        "---\nlanguage: liquid\n---\nSaved {% if zt.variant == 'alt' %}alternate{% else %}primary{% endif %}: {{ zt.citations.size }}",
      );
      await f.template.waitUntilSettled(1000);
      const before = new Map(f.vault.contents);
      const saved = await f.check({
        document: "citation",
        example: "two-items",
        variant,
        output: "citation",
      });
      expect(saved.ok).toBe(true);
      expect(saved.checks.citation.status).toBe("passed");
      expect(saved.outputs.citation).toBe(savedOutput);
      const draft = await f.draft(
        "---\nlanguage: liquid\n---\nDraft {% if zt.variant == 'alt' %}alternate{% else %}primary{% endif %}: {{ zt.citations.size }}",
      );
      const checked = await f.check({
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
    },
  );

  it.each(["note", "annotation", "citation"])(
    "checks a Shared Partial from the %s root",
    async (root) => {
      await using f = await fixture();
      await f.template.createPartial("example", {
        source: "Partial",
        language: "liquid",
      });
      const selection: Record<string, string> =
        root === "citation"
          ? { example: "one-item" }
          : { key: root === "annotation" ? "ANNO2345" : "ABCD2345" };
      const compact = await f.check({
        document: "partial:example",
        root,
        ...selection,
      });
      expect(compact, JSON.stringify(compact)).toMatchObject({ ok: true });
      expect(compact.checks.partial.status).toBe("passed");
      expect(compact.outputs).toBeUndefined();
      const full = await f.check({
        attempt: compact.attempt,
        output: "partial",
      });
      expect(full.outputs.partial).toBe("Partial");
      const draft = await f.draft("---\nlanguage: liquid\n---\n");
      const empty = await f.check({
        document: "partial:example",
        draft,
        root,
        ...selection,
        output: "all",
      });
      expect(empty.ok).toBe(true);
      expect(empty.outputs.partial).toBe("");
    },
  );
});

beforeEach(() => {
  vi.mocked(loadTemplateData).mockImplementation(async (_deps, _key, root) => ({
    kind: "data",
    data:
      root === "filename"
        ? { title: "Paper", indexedKey: "1:ABCD2345" }
        : root === "annotation"
          ? {
              indexedKey: "1:ANNO2345",
              comment: "An observation",
              citation: "(Paper)",
            }
          : {
              indexedKey: "1:ABCD2345",
              title: "Paper",
              annotations: [
                { indexedKey: "1:ANNO2345", comment: "An observation" },
              ],
            },
  }));
});

describe("registered template-check", () => {
  it("checks a targeted scratch draft and leaves installed source, notes, and settings unchanged", async () => {
    await using f = await fixture();
    f.vault.addFile("notes/existing.md", "Existing note");
    const before = [...f.vault.contents];
    const settings = JSON.stringify(await f.settings.loaded);
    const draft = await f.draft(
      SOURCE.replace("# {{ zt.title }}", "# Draft {{ zt.title }}"),
    );
    const result = await f.check({
      profile: "Books",
      draft,
      key: "1:ABCD2345",
      output: "all",
    });
    expect(result).toMatchObject({
      ok: true,
      input: { origin: "draft", path: draft },
      document: { profile: { id: "Bk3Qn7XvT2Lp" } },
      outputs: { body: expect.stringContaining("# Draft Paper") },
    });
    expect(result.input.revision).toHaveLength(64);
    expect(result.attemptContext.sourceRevision).toBe(result.input.revision);
    expect([...f.vault.contents]).toEqual(before);
    expect(JSON.stringify(await f.settings.loaded)).toBe(settings);
    expect(f.profile.profiles).toHaveLength(1);
    expect(f.template.getLoadedDocumentSource(PATH)).toBe(SOURCE);
    const structural = await f.check({ profile: "Books", draft });
    expect(structural).toMatchObject({ ok: true, rendering: "not-checked" });
  });

  it("checks new standalone identities and asserts targeted identity before loading data", async () => {
    await using f = await fixture();
    const draft = await f.draft(
      SOURCE.replace("Bk3Qn7XvT2Lp", "Nx4Qn7XvT2Lp").replace(
        "name: Books",
        "name: New draft",
      ),
    );
    const mismatch = await f.check({
      profile: "Books",
      draft,
      key: "1:ABCD2345",
    });
    expect(mismatch).toMatchObject({
      ok: false,
      input: { origin: "draft", path: draft },
      diagnostic: { code: "PROFILE_ID_MISMATCH" },
    });
    expect(loadTemplateData).not.toHaveBeenCalled();
    expect(
      await f.check({ draft, key: "1:ABCD2345", output: "fold" }),
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
  });

  it("binds changed and removed draft overrides against current Default settings", async () => {
    await using f = await fixture(
      SOURCE.replace(
        "contract: 5",
        "contract: 5\nfolder: Installed\ncitationStyle: installed-style",
      ),
    );
    f.settings.updateDefaultLiteratureNoteProfileBindings({
      "note.literature-folder": "Inherited",
      "citation.references-style": "inherited-style",
    });
    const draft = await f.draft(
      SOURCE.replace(
        "contract: 5",
        "contract: 5\nfolder: Draft\ncitationStyle: draft-style",
      ),
    );
    expect(
      await f.check({
        profile: "Books",
        draft,
        key: "1:ABCD2345",
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
    await f.draft(SOURCE);
    const inherited = await f.check({
      profile: "Books",
      draft,
      key: "1:ABCD2345",
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
    const loadedSettings = await vi
      .mocked(loadTemplateData)
      .mock.calls.at(-1)![0].settings.loaded;
    expect(getProfileBinding(loadedSettings, "citation.references-style")).toBe(
      "inherited-style",
    );
    expect(
      f.profile.resolveProfile("Bk3Qn7XvT2Lp" as never)?.bindings[
        "note.literature-folder"
      ],
    ).toBe("Installed");
  });

  it("keeps Default bindings settings-owned and rejects declarations in Default drafts", async () => {
    await using f = await fixture();
    const draft = await f.draft(SOURCE.replace("Bk3Qn7XvT2Lp", "default"));
    expect(await f.check({ profile: "default", draft })).toMatchObject({
      ok: true,
      document: { profile: { id: "default" } },
    });
    await f.draft(
      SOURCE.replace("Bk3Qn7XvT2Lp", "default").replace(
        "contract: 5",
        "contract: 5\nfolder: Forbidden",
      ),
    );
    const invalid = await f.check({ profile: "default", draft });
    expect(invalid).toMatchObject({
      ok: false,
      input: { origin: "draft", path: draft },
      checks: { structure: { status: "failed" } },
    });
    expect(invalid.diagnostic.message).toContain(
      "Default Profile bindings belong in settings",
    );
  });

  it("reports unreadable and malformed drafts with their scratch source origin", async () => {
    await using f = await fixture();
    const path = await f.draft("not a Profile document");
    expect(await f.check({ draft: path })).toMatchObject({
      ok: false,
      input: { origin: "draft", path },
      checks: { structure: { status: "failed" } },
    });
    const missing = `${path}.missing`;
    expect(await f.check({ draft: missing })).toMatchObject({
      ok: false,
      input: { origin: "draft", path: missing, revision: null },
      diagnostic: { code: "DRAFT_READ_FAILED", recovery: expect.any(String) },
    });
  });

  it("checks installed dependencies during a draft attempt and withholds superseded output", async () => {
    await using f = await fixture();
    const draft = await f.draft(SOURCE);
    const read = f.app.vault.adapter.read.bind(f.app.vault.adapter);
    let changed = false;
    vi.spyOn(f.app.vault.adapter, "read").mockImplementation(async (path) => {
      if (changed && path.endsWith("citation.md"))
        throw new Error("Dependency unreadable");
      return read(path);
    });
    const load = vi.mocked(loadTemplateData).getMockImplementation()!;
    vi.mocked(loadTemplateData).mockImplementation(async (...args) => {
      changed = true;
      return load(...args);
    });
    const result = await f.check({ draft, key: "1:ABCD2345", output: "all" });
    expect(result).toMatchObject({
      ok: false,
      input: { origin: "draft" },
      diagnostic: { code: "SOURCE_SUPERSEDED" },
    });
    expect(result.outputs).toBeUndefined();
    expect(result.checks).toBeUndefined();
    expect(await f.check({ draft })).toMatchObject({
      ok: false,
      input: { origin: "draft" },
      diagnostic: { code: "SOURCE_READ_FAILED" },
    });
  });
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

  it("checks a standalone draft update against an unresolved baseline stamp", async () => {
    await using f = await fixture();
    const draft = await f.draft(SOURCE);
    const result = await f.check({
      mode: "update",
      draft,
      key: "1:ABCD2345",
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
  });

  it("checks a scratch spread and body edit against a saved note in every output mode", async () => {
    await using f = await fixture(SOURCE, { "Notes/Paper.md": existing });
    const before = new Map(f.vault.contents);
    const draft = await f.draft(
      SOURCE.replace(
        "  - value: { tags: [first] }",
        "  - value: { tags: [first], reviewed: true }",
      ).replace("%}Managed{%", "%}New generated paragraph{%"),
    );
    const params = {
      draft,
      mode: "update",
      key: "1:ABCD2345",
      note: "Notes/Paper.md",
      "expect-source": "fixture",
    };
    const compact = await f.check(params);
    const selected = await f.check({ ...params, output: "body,frontmatter" });
    const all = await f.check({ ...params, output: "all" });
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
      "My introduction.\n%%zt-managed%%\nNew generated paragraph\n%%/zt-managed%%\nMy conclusion.\n",
    );
    expect(parse(all.outputs.frontmatter)).toMatchObject({
      personal: "keep me",
      reviewed: true,
      title: "Paper",
    });
    expect(f.vault.contents).toEqual(before);
  });

  it.each(["real", "supplied"] as const)(
    "updates the %s baseline through its stamp and keeps user text and key order",
    async (kind) => {
      await using f = await fixture(
        SOURCE,
        kind === "real" ? { "Notes/Paper.md": existing } : {},
      );
      const before = new Map(f.vault.contents);
      const writes = vi.spyOn(f.app.fileManager, "processFrontMatter");
      const result = await f.check({
        mode: "update",
        key: "1:ABCD2345",
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
        "My introduction.\n%%zt-managed%%\nManaged\n%%/zt-managed%%\nMy conclusion.\n",
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
      expect(writes).not.toHaveBeenCalled();
      const retained = await f.check({
        attempt: result.attempt,
        output: "body",
      });
      expect(retained.outputs).toEqual({
        body: "My introduction.\n%%zt-managed%%\nManaged\n%%/zt-managed%%\nMy conclusion.\n",
      });
    },
  );

  it("requires an explicit path for duplicate notes and reports a proposed Profile change", async () => {
    await using f = await fixture(SOURCE, {
      "Notes/One.md": existing,
      "Notes/Two.md": existing,
    });
    const duplicate = await f.check({ mode: "update", key: "1:ABCD2345" });
    expect(duplicate).toMatchObject({
      ok: false,
      diagnostic: {
        code: "duplicate-literature-notes",
        candidates: ["Notes/One.md", "Notes/Two.md"],
      },
    });
    const result = await f.check({
      mode: "update",
      key: "1:ABCD2345",
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
  });

  it.each(["ABCD2345", "ATCH2345", "NATE2345"])(
    "uses the selected parent note in real loader output for %s",
    async (key) => {
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
      const actual = await vi.importActual<typeof import("./data")>("./data");
      vi.mocked(loadTemplateData).mockImplementation(actual.loadTemplateData);
      await using f = await fixture(
        SOURCE.replace("%}Managed{%", "%}{{ zt.notePath }}{%"),
        {
          "Notes/One.md": existing.replace("My introduction.", "First note."),
          "Notes/Two.md": existing.replace("My introduction.", "Second note."),
        },
        {
          acquireRead: async () => ({ client, [Symbol.dispose]() {} }) as never,
        },
      );
      Object.assign(f.app.fileManager, {
        generateMarkdownLink: (file: { path: string }) => `[[${file.path}]]`,
        getAvailablePathForAttachment: async () => "images/probe.png",
      });
      const duplicate = await f.check({ mode: "update", key });
      expect(duplicate, JSON.stringify(duplicate)).toMatchObject({
        ok: false,
        diagnostic: {
          code: "duplicate-literature-notes",
          candidates: ["Notes/One.md", "Notes/Two.md"],
        },
      });
      const result = await f.check({
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
        "Second note.\n%%zt-managed%%\nNotes/Two.md\n%%/zt-managed%%\nMy conclusion.\n",
      );
    },
  );

  it("retains the selected baseline identity and recovery when reading its bytes fails", async () => {
    await using f = await fixture(SOURCE, { "Notes/Unreadable.md": existing });
    vi.spyOn(f.app.vault, "read").mockRejectedValue(
      new Error("Permission denied"),
    );
    const result = await f.check({ mode: "update", key: "1:ABCD2345" });
    expect(result).toMatchObject({
      ok: false,
      baseline: {
        kind: "real",
        path: "Notes/Unreadable.md",
        indexedKey: "1:ABCD2345",
        revision: null,
      },
      diagnostic: {
        code: "BASELINE_READ_FAILED",
        recovery:
          "Restore access to 'Notes/Unreadable.md' and correct its frontmatter, then run the check again with note=Notes/Unreadable.md.",
      },
    });
  });

  it.each(["real", "supplied"] as const)(
    "retains the %s baseline identity and recovery for invalid frontmatter",
    async (kind) => {
      const malformed = "---\ntags: [broken\n---\nMy note";
      await using f = await fixture(
        SOURCE,
        kind === "real" ? { "Notes/Broken.md": malformed } : {},
      );
      const result = await f.check({
        mode: "update",
        key: "1:ABCD2345",
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
          recovery:
            kind === "real"
              ? "Restore access to 'Notes/Broken.md' and correct its frontmatter, then run the check again with note=Notes/Broken.md."
              : "Correct the supplied existing=<text> frontmatter and run the check again.",
        },
      });
    },
  );

  it("labels a synthetic baseline and preserves a supplied static body", async () => {
    await using f = await fixture();
    const synthetic = await f.check({
      mode: "update",
      key: "1:ABCD2345",
      profile: "Books",
      output: "body",
    });
    expect(synthetic).toMatchObject({
      ok: true,
      baseline: { kind: "synthetic", path: null, revision: null },
      outputs: { body: "# Paper\n%%zt-managed%%\nManaged\n%%/zt-managed%%\n" },
    });
    const result = await f.check({
      mode: "update",
      key: "1:ABCD2345",
      existing: "My static note.\n",
      profile: "Books",
      output: "body",
    });
    expect(result.outputs.body).toBe("My static note.\n");
  });

  it("reports append conflicts, keep/replace, spread omission and static deletion against the baseline", async () => {
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
    await using f = await fixture(source);
    const result = await f.check({
      mode: "update",
      key: "1:ABCD2345",
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
  });

  it("refuses failed properties without presenting a partial fold", async () => {
    await using f = await fixture(
      SOURCE.replace(
        'value: "${zt.title}"',
        'value: { $eval: "missing.value" }',
      ),
    );
    const result = await f.check({
      mode: "update",
      key: "1:ABCD2345",
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
  });

  it("checks all create components, folds independent contributions, and discloses complete output", async () => {
    await using f = await fixture();
    const result = await f.check({
      profile: "Books",
      key: "1:ABCD2345",
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
      "zotero-key": "1:ABCD2345",
    });
    expect(parse(result.outputs.frontmatter)).toEqual(result.outputs.fold);
    expect(result.outputs.annotations).toMatchObject([
      {
        key: "1:ANNO2345",
        check: { status: "passed", output: "An observation" },
      },
    ]);
    const compact = await f.check({ attempt: result.attempt });
    expect(compact.checks).toEqual(result.checks);
    expect(compact.outputs).toBeUndefined();
    const selected = await f.check({
      attempt: result.attempt,
      output: "filename,managed",
    });
    expect(Object.keys(selected.outputs)).toEqual(["filename", "managed"]);
    expect(selected.checks).toEqual(compact.checks);
  });

  it("validates saved and built-in Profiles structurally without loading an item", async () => {
    await using f = await fixture();
    for (const profile of ["Books", "default"]) {
      const result = await f.check({ profile });
      expect(result).toMatchObject({
        ok: true,
        rendering: "not-checked",
        checks: {
          structure: { status: "passed" },
          body: { status: "not-checked" },
        },
      });
    }
    expect(loadTemplateData).not.toHaveBeenCalled();
  });

  it("fails an undisclosed annotation and keeps the failed attempt evidence after a new run", async () => {
    await using f = await fixture(
      SOURCE.replace("{{ zt.comment }}", '{% render "absent" with zt as zt %}'),
    );
    const failed = await f.check({
      profile: "Books",
      key: "1:ABCD2345",
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
    expect(failed.checks.annotations.diagnostics[0].evidence).toBeUndefined();
    const evidence = await f.check({
      attempt: failed.attempt,
      evidence: "full",
      output: "all",
    });
    expect(evidence.checks.annotations.diagnostics[0].evidence).toBeDefined();
    const rerun = await f.check({ profile: "Books", key: "1:ABCD2345" });
    expect(rerun.attempt).not.toBe(failed.attempt);
    expect(
      await f.check({
        attempt: failed.attempt,
        evidence: "full",
        output: "all",
      }),
    ).toEqual(evidence);
  });

  it("runs independent components when a body partial fails", async () => {
    await using f = await fixture(
      SOURCE.replace("# {{ zt.title }}", '{% render "absent" with zt as zt %}'),
    );
    expect(
      await f.check({ profile: "Books", key: "1:ABCD2345" }),
    ).toMatchObject({
      ok: false,
      checks: {
        body: { status: "failed" },
        filename: { status: "passed" },
        fold: { status: "passed" },
        annotations: { status: "passed" },
      },
    });
  });

  it("reports JSON-e entry errors with their key and position", async () => {
    await using f = await fixture(
      SOURCE.replace(
        'value: "\u0024{zt.title}"',
        "value: { $eval: missing.property }",
      ),
    );
    const result = await f.check({
      profile: "Books",
      key: "1:ABCD2345",
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
  });

  it("refuses an inert JS spread before compilation", async () => {
    await using f = await fixture(
      SOURCE.replace(
        "  - key: tags\n    merge: append\n    value: [second]",
        '  - js: "invalid javascript !!!"',
      ),
    );
    const compile = vi.spyOn(f.template, "prepareLiteratureNoteTemplateSource");
    const result = await f.check({ profile: "Books", key: "1:ABCD2345" });
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
    const evidence = await f.check({
      attempt: result.attempt,
      evidence: "full",
    });
    expect(evidence.diagnostic.evidence).toMatchObject({
      kind: "javascript-gate",
      enabled: false,
      entries: [{ position: 3, expression: "invalid javascript !!!" }],
    });
    expect(compile).not.toHaveBeenCalled();
  });

  it("uses the native annotation root and retains Citation Template failure reports", async () => {
    await using f = await fixture(
      SOURCE.replace("{{ zt.comment }}", "{{ zt.citation }}"),
    );
    const load = vi.mocked(loadTemplateData).getMockImplementation()!;
    let broken = false;
    vi.mocked(loadTemplateData).mockImplementation(async (deps, key, root) =>
      root === "annotation"
        ? {
            kind: "data",
            data: withAnnotationCitation({ indexedKey: key } as never, () => {
              if (broken)
                throw new TemplateError("Citation failed", "citation");
              return "(Citation present)";
            }),
          }
        : load(deps, key, root),
    );
    expect(
      await f.check({
        profile: "Books",
        key: "1:ABCD2345",
        output: "annotations",
      }),
    ).toMatchObject({
      ok: true,
      outputs: { annotations: [{ check: { output: "(Citation present)" } }] },
    });
    broken = true;
    const failed = await f.check({
      profile: "Books",
      key: "1:ABCD2345",
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
                  selection: "1:ANNO2345",
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
  });

  it("binds two annotation failure reports to their own loaded roots and revisions", async () => {
    await using f = await fixture();
    const load = vi.mocked(loadTemplateData).getMockImplementation()!;
    let firstComment = "First revision";
    vi.mocked(loadTemplateData).mockImplementation(async (deps, key, root) => {
      if (root === "annotation")
        return {
          kind: "data",
          data: withAnnotationCitation(
            {
              indexedKey: key,
              comment:
                key === "1:ANNO2345" ? firstComment : "Second annotation",
            } as never,
            () => {
              throw new TemplateError(`Citation failed for ${key}`, "citation");
            },
          ),
        };
      const loaded = await load(deps, key, root);
      if (root !== "note" || loaded.kind !== "data") return loaded;
      return {
        kind: "data",
        data: {
          ...loaded.data,
          annotations: [
            { indexedKey: "1:ANNO2345" },
            { indexedKey: "1:ANNO6789" },
          ],
        },
      };
    });
    const failed = await f.check({
      profile: "Books",
      key: "1:ABCD2345",
      evidence: "full",
    });
    const diagnostics = failed.checks.annotations.diagnostics;
    expect(diagnostics).toMatchObject([
      {
        evidence: { message: "Citation failed for 1:ANNO2345" },
        report: {
          section: "annotation",
          context: { root: "annotation", selection: "1:ANNO2345" },
          identity: { annotationId: "1:ANNO2345" },
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
    const secondRevision = diagnostics[1].report.identity.annotationRevision;
    expect(firstRevision).toHaveLength(64);
    expect(secondRevision).toHaveLength(64);
    expect(firstRevision).not.toBe(secondRevision);
    firstComment = "Changed annotation data";
    const rerun = await f.check({
      profile: "Books",
      key: "1:ABCD2345",
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
      await f.check({ attempt: failed.attempt, evidence: "full" }),
    ).toEqual(failed);
  });

  it("preserves authored evidence properties in selected and full output", async () => {
    await using f = await fixture(
      SOURCE.replace(
        'value: "\u0024{zt.title}"',
        "value: { evidence: authored, nested: { evidence: retained } }",
      ),
    );
    const result = await f.check({
      profile: "Books",
      key: "1:ABCD2345",
      output: "fold",
    });
    expect(result.outputs.fold.title).toEqual({
      evidence: "authored",
      nested: { evidence: "retained" },
    });
    expect(
      await f.check({ attempt: result.attempt, output: "all" }),
    ).toMatchObject({ outputs: { fold: { title: { evidence: "authored" } } } });
  });

  it("withholds completed checks and outputs when post-check source identity fails", async () => {
    await using f = await fixture();
    let reads = 0;
    Object.defineProperty(f.zoteroPref, "sourceId", {
      get: () => (++reads === 1 ? "fixture" : "changed"),
    });
    const result = await f.check({
      profile: "Books",
      key: "1:ABCD2345",
      output: "all",
      "expect-source": "fixture",
    });
    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: "SOURCE_SUPERSEDED" },
    });
    expect(result.checks).toBeUndefined();
    expect(result.outputs).toBeUndefined();
  });

  it("treats empty rendered outputs as success", async () => {
    await using f = await fixture(
      SOURCE.replace(
        'filename: "{{ zt.title }}"',
        'filename: "{{ zt.missing }}"',
      )
        .replace("# {{ zt.title }}\n{% managed %}Managed{% endmanaged %}\n", "")
        .replace("{{ zt.comment }}", ""),
    );
    const result = await f.check({
      profile: "Books",
      key: "1:ABCD2345",
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
  });
});
