import type { CliHandler, Plugin } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import { withAnnotationCitation } from "@zotlit/db";
import { TemplateError } from "@zotlit/templates/facade";

import { profileServiceFixture } from "@/services/profile/__fixtures__/service";

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

async function fixture(source = SOURCE) {
  await using stack = new AsyncDisposableStack();
  const f = stack.use(await profileServiceFixture({ [PATH]: source }));
  Object.assign(f.vault, {
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
  const zoteroPref = {
    ready: Promise.resolve(),
    sourceId: "fixture",
    databasePath: "/fixture/db",
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
    } as never,
  );
  const cleanup = stack.move();
  return {
    ...f,
    zoteroPref,
    check: async (params: Parameters<CliHandler>[0] = {}) =>
      JSON.parse(
        (await handlers.get(TEMPLATE_CHECK_COMMAND)!({ ...params })) as string,
      ),
    [Symbol.asyncDispose]: () => cleanup.disposeAsync(),
  };
}

beforeEach(() => {
  vi.mocked(loadTemplateData).mockImplementation(async (_deps, _key, root) => ({
    kind: "data",
    data:
      root === "filename"
        ? { title: "Paper" }
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
