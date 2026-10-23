// Contract 4 selectors, diagnostics and output over the real Citation Index.
import { expect } from "vitest";

import { fakeCliHost } from "@/lib/__fixtures__/cli-host";
import { Effect } from "@/lib/effect";
import { acquireAsyncDisposable } from "@/lib/effect-scope";
import { it } from "@/lib/effect-vitest";
import {
  annotationRows,
  annotationUri,
} from "@/services/citation-index/__fixtures__/annotations";
import type { CitationIndexHarnessOptions } from "@/services/citation-index/test-harness";
import { createCitationIndexHarness } from "@/services/citation-index/test-harness";
import { seedWorksSql } from "@/services/zotero-reads/test-utils";

import { registerCitationsCli } from "./register";

const setup = Effect.fn("CitationsCliTest.setup")(function* (
  body = `[@doe2024] [](${annotationUri})`,
  options: CitationIndexHarnessOptions = { zoteroRows: annotationRows },
) {
  const h = yield* acquireAsyncDisposable(() =>
    createCitationIndexHarness({ "draft.md": body }, options),
  );
  h.workspace.layoutReady();
  yield* Effect.promise(() => h.index.whenIndexed());
  Object.assign(h.app.vault, {
    getName: () => "Test Vault",
    adapter: { getBasePath: () => "/test" },
  });
  const cli = fakeCliHost();
  registerCitationsCli(cli.host, {
    app: h.app,
    citationIndex: h.index,
    zoteroPref: {
      ready: Promise.resolve(),
      sourceId: "test-source",
      databasePath: "/test/zotero.sqlite",
    },
  });
  return { ...h, command: cli.command };
});

it.effect.each<[string, Record<string, string>, string]>([
  ["cited-by", {}, "key"],
  ["cited-by", { key: "ABCD2345", citekey: "doe2024" }, "citekey"],
  ["cited-by", { key: "bad" }, "key"],
  ["cited-by", { citekey: "" }, "citekey"],
  ["cited-by", { citekey: "true" }, "citekey"],
  ["cited-by", { key: "ABCD2345", extra: "x" }, "extra"],
  ["cited-by", { key: "ABCD2345", "expect-source": "true" }, "expect-source"],
  ["references", {}, "file"],
  ["references", { file: "true" }, "file"],
  ["references", { file: "draft.md", extra: "x" }, "extra"],
  ["annotation-uses", {}, "key"],
  ["annotation-uses", { key: "" }, "key"],
  ["annotation-uses", { key: "true" }, "key"],
  ["annotation-uses", { key: "bad" }, "key"],
  ["annotation-uses", { key: "ANN23456gwrong" }, "key"],
  ["annotation-uses", { key: "ANN23456", citekey: "doe2024" }, "citekey"],
  [
    "annotation-uses",
    { key: "ANN23456", "expect-source": "true" },
    "expect-source",
  ],
  ["citations-guide", { topic: "positions" }, "topic"],
])(
  "rejects invalid %s parameters with the exact parameter and an actionable message",
  ([name, params, parameter]) =>
    Effect.gen(function* () {
      const h = yield* setup();
      const result = JSON.parse(
        yield* h.command(`zotlit:${name}`).handler(params),
      );
      expect(result).toMatchObject({
        contractVersion: 4,
        ok: false,
        diagnostic: { code: "INVALID_SELECTOR", details: { parameter } },
      });
      expect(result.diagnostic.message).toEqual(expect.any(String));
      expect(result.diagnostic.message.length).toBeGreaterThan(10);
      expect(result.diagnostic.hint.length).toBeGreaterThan(10);
      expect(result.identity).toBeUndefined();
    }),
);

it.effect.each(["cited-by", "references", "annotation-uses"])(
  "rejects a wrong source for %s",
  (name) =>
    Effect.gen(function* () {
      const h = yield* setup();
      const params: Record<string, string> =
        name === "references" ? { file: "draft.md" } : { key: "ABCD2345" };
      const result = JSON.parse(
        yield* h
          .command(`zotlit:${name}`)
          .handler({ ...params, "expect-source": "other" }),
      );
      expect(result).toMatchObject({
        ok: false,
        diagnostic: {
          code: "TARGET_MISMATCH",
          message:
            "Expected Zotero source 'other', connected to 'test-source'.",
        },
      });
    }),
);

it.effect(
  "reports References, Cited By and Annotation uses in source order with one-based positions",
  () =>
    Effect.gen(function* () {
      const h = yield* setup(`[@doe2024]\n[](${annotationUri})`);
      const references = JSON.parse(
        yield* h.command("zotlit:references").handler({ file: "draft.md" }),
      );
      expect(references).toMatchObject({
        contractVersion: 4,
        ok: true,
        entries: [
          {
            kind: "resolved",
            key: "ABCD2345",
            refNumber: 1,
            occurrences: [
              {
                kind: "citekey",
                raw: "doe2024",
                position: { start: { line: 1, col: 2, offset: 1 } },
              },
              {
                kind: "annotation",
                raw: "ANN23456",
                position: { start: { line: 2, col: 1, offset: 11 } },
              },
            ],
          },
        ],
        omittedSyntaxes: [],
        database: "ready",
      });
      const cited = JSON.parse(
        yield* h.command("zotlit:cited-by").handler({ citekey: "doe2024" }),
      );
      expect(cited).toMatchObject({
        ok: true,
        item: { key: "ABCD2345", citekey: "doe2024" },
        groups: [
          { path: "draft.md", occurrences: references.entries[0].occurrences },
        ],
        coverage: "complete",
      });
      const used = JSON.parse(
        yield* h.command("zotlit:annotation-uses").handler({ key: "ANN23456" }),
      );
      expect(used).toMatchObject({
        ok: true,
        groups: [
          {
            path: "draft.md",
            occurrences: [
              {
                form: "citation",
                text: "",
                position: { start: { line: 2, col: 1, offset: 11 } },
              },
            ],
          },
        ],
      });
    }),
);

it.effect(
  "presents grouped unresolved, missing Annotation and malformed outcomes",
  () =>
    Effect.gen(function* () {
      const h = yield* setup(
        "[@unknown] [](zotero://open/library/items/PDF23456?annotation=ZZZZZZZZ) [](zotero://open/library/items/PDF23456)",
      );
      const result = JSON.parse(
        yield* h.command("zotlit:references").handler({ file: "draft.md" }),
      );
      expect(result.entries).toMatchObject([
        { kind: "unresolved", citekey: "unknown" },
        { kind: "unresolved", annotationKey: "ZZZZZZZZ" },
        { kind: "malformed" },
      ]);
      const set = yield* Effect.promise(() =>
        h.index.getDocumentCitationSet(h.draft),
      );
      expect(set.citations.map((c) => c.outcome)).toMatchObject([
        { kind: "unresolved-key" },
        { kind: "missing-annotation" },
      ]);
      expect(set.errors[0]?.outcome).toEqual({ kind: "malformed" });
    }),
);

it.effect(
  "keeps a failed source read distinct from a missing Item (#1704)",
  () =>
    Effect.gen(function* () {
      const h = yield* setup();
      h.db.acquireRead = () =>
        Promise.reject(new Error("test database unreadable"));
      const result = JSON.parse(
        yield* h.command("zotlit:references").handler({ file: "draft.md" }),
      );
      expect(result).toMatchObject({
        ok: true,
        database: "unreadable",
        entries: [{ kind: "unreadable" }],
      });
    }),
);

it.effect("reports selector misses and empty Annotation uses", () =>
  Effect.gen(function* () {
    const h = yield* setup();
    expect(
      JSON.parse(
        yield* h.command("zotlit:cited-by").handler({ key: "ZZZZZZZZ" }),
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "KEY_NOT_FOUND" } });
    expect(
      JSON.parse(
        yield* h.command("zotlit:cited-by").handler({ citekey: "unknown" }),
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "KEY_NOT_FOUND" } });
    expect(
      JSON.parse(
        yield* h.command("zotlit:references").handler({ file: "absent.md" }),
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "FILE_NOT_FOUND" } });
    expect(
      JSON.parse(
        yield* h.command("zotlit:annotation-uses").handler({ key: "ZZZZZZZZ" }),
      ),
    ).toMatchObject({ ok: true, groups: [] });
  }),
);

it.effect("prints the guide as prose with all four commands", () =>
  Effect.gen(function* () {
    const h = yield* setup();
    const guide = yield* h.command("zotlit:citations-guide").handler({});
    expect(guide).toContain("ZOTLIT-CITATIONS(1)");
    for (const command of [
      "cited-by",
      "references",
      "annotation-uses",
      "citations-guide",
    ])
      expect(guide).toContain(`zotlit:${command}`);
  }),
);

it.effect(
  "#1704 presents one Ambiguous Citation Key outcome in References and selector diagnostics",
  () =>
    Effect.gen(function* () {
      const h = yield* setup("[@same] [[Doe 2024]]", {
        settings: { "citation.wikilink-citations": true },
        zoteroRows: seedWorksSql([
          { itemID: 1, key: "ABCD2345", citationKey: "same" },
          { itemID: 2, key: "EFGH6789", citationKey: "same" },
        ]),
      });
      const set = yield* Effect.promise(() =>
        h.index.getDocumentCitationSet(h.draft),
      );
      expect(set.citations[0]?.outcome).toMatchObject({
        kind: "ambiguous-key",
        citekey: "same",
        candidates: [{ indexedKey: "ABCD2345" }, { indexedKey: "EFGH6789" }],
      });
      const reference = JSON.parse(
        yield* h.command("zotlit:references").handler({ file: "draft.md" }),
      );
      expect(reference.entries[0]).toMatchObject({
        kind: "ambiguous",
        citekey: "same",
        candidates: [
          { key: "ABCD2345", libraryID: 1 },
          { key: "EFGH6789", libraryID: 1 },
        ],
      });
      expect(reference.entries[1]).toMatchObject({
        kind: "resolved",
        key: "ABCD2345",
        linkpath: "Doe 2024",
      });
      const cited = JSON.parse(
        yield* h.command("zotlit:cited-by").handler({ citekey: "same" }),
      );
      expect(cited.diagnostic).toMatchObject({
        code: "AMBIGUOUS_CITEKEY",
        details: { candidates: reference.entries[0].candidates },
      });
    }),
);

it.effect(
  "#1704 reports a missing Item separately from an unresolved key",
  () =>
    Effect.gen(function* () {
      const h = yield* setup("[[Doe 2024]]", {
        citekeys: [],
        settings: { "citation.wikilink-citations": true },
      });
      const set = yield* Effect.promise(() =>
        h.index.getDocumentCitationSet(h.draft),
      );
      expect(set.citations[0]?.outcome).toEqual({
        kind: "missing-item",
        key: "ABCD2345",
      });
      const result = JSON.parse(
        yield* h.command("zotlit:references").handler({ file: "draft.md" }),
      );
      expect(result.entries[0]).toMatchObject({
        kind: "missing",
        key: "ABCD2345",
      });
    }),
);
