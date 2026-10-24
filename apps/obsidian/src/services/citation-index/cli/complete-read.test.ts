// Complete CLI reads over the real index, worker boundary and in-memory Zotero database.
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { fakeCliHost } from "@/lib/__fixtures__/cli-host";
import { effectTestParse } from "@/lib/__fixtures__/parse-client";
import { Effect, Fiber } from "@/lib/effect";
import { acquireAsyncDisposable } from "@/lib/effect-scope";
import { it } from "@/lib/effect-vitest";
import {
  annotationRows,
  annotationUri,
} from "@/services/citation-index/__fixtures__/annotations";
import { createCitationIndexHarness } from "@/services/citation-index/test-harness";
import type { CitationIndexHarness } from "@/services/citation-index/test-harness";
import { inProcessParseClient } from "@/services/citation-parse/in-process";

import { registerCitationsCli } from "./register";

function commands(h: CitationIndexHarness) {
  Object.assign(h.app.vault, {
    getName: () => "Test",
    adapter: { getBasePath: () => "/test" },
  });
  const cli = fakeCliHost();
  registerCitationsCli(cli.host, {
    app: h.app,
    citationIndex: h.index,
    zoteroPref: {
      current: Effect.succeed({
        sourceId: "test",
        databasePath: "/test/zotero.sqlite",
      }),
    },
  });
  return cli.command;
}

it.effect.each(["annotation-uses", "cited-by"])(
  "#1683 waits for an edited note before answering %s as complete",
  (command) =>
    Effect.gen(function* () {
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let held = false;
      const h = yield* acquireAsyncDisposable(() =>
        createCitationIndexHarness(
          { "draft.md": `[](${annotationUri})` },
          {
            zoteroRows: annotationRows,
            parseClient: {
              parse: effectTestParse(async (request, signal) => {
                if (held) {
                  entered.resolve();
                  await release.promise;
                }
                return Effect.runPromise(inProcessParseClient.parse(request), {
                  signal,
                });
              }),
            },
          },
        ),
      );
      h.workspace.layoutReady();
      yield* Effect.promise(() => h.index.whenIndexed());
      const cli = commands(h);
      held = true;
      h.metadataCache.change(
        h.draft,
        `[](${annotationUri}) [](${annotationUri})`,
      );
      yield* Effect.promise(() => entered.promise);
      const fiber = yield* cli(`zotlit:${command}`)
        .handler({
          key: command === "annotation-uses" ? "ANN23456" : "ABCD2345",
        })
        .pipe(Effect.forkChild);
      // The worker reply is the completion boundary, released after the command starts.
      yield* TestClock.adjust(100);
      release.resolve();
      const answer = JSON.parse(yield* Fiber.join(fiber));
      expect(answer.coverage).toBe("complete");
      expect(answer.groups).toHaveLength(command === "annotation-uses" ? 1 : 0);
      if (command === "annotation-uses")
        expect(answer.groups[0].occurrences).toHaveLength(2);
    }),
);

it.effect("#1683 reports Annotation Citations as an omitted source", () =>
  Effect.gen(function* () {
    const h = yield* acquireAsyncDisposable(() =>
      createCitationIndexHarness(
        { "draft.md": `[](${annotationUri})` },
        { zoteroRows: annotationRows },
      ),
    );
    h.workspace.layoutReady();
    yield* Effect.promise(() => h.index.whenIndexed());
    const cli = commands(h);
    const answer = JSON.parse(
      yield* cli("zotlit:references").handler({ file: "draft.md" }),
    );
    expect(answer.entries).toEqual([]);
    expect(answer.omittedSyntaxes).toEqual(["annotation"]);
    expect(answer.syntaxes.annotation).toBe("excluded");
  }),
);

it.effect(
  "#1683 reports incomplete coverage when a pending edit exceeds the bounded wait",
  () =>
    Effect.gen(function* () {
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let held = false;
      const h = yield* acquireAsyncDisposable(() =>
        createCitationIndexHarness(
          { "draft.md": "@doe2024" },
          {
            parseClient: {
              parse: effectTestParse(async (request, signal) => {
                if (held) {
                  entered.resolve();
                  await release.promise;
                }
                return Effect.runPromise(inProcessParseClient.parse(request), {
                  signal,
                });
              }),
            },
          },
        ),
      );
      h.workspace.layoutReady();
      yield* Effect.promise(() => h.index.whenIndexed());
      held = true;
      h.metadataCache.change(h.draft, "@doe2024 @roe2025");
      yield* Effect.promise(() => entered.promise);
      const fiber = yield* commands(h)("zotlit:cited-by")
        .handler({ key: "ABCD2345" })
        .pipe(Effect.forkChild);
      yield* TestClock.adjust(5_001);
      const answer = JSON.parse(yield* Fiber.join(fiber));
      release.resolve();
      expect(answer).toMatchObject({
        ok: false,
        coverage: "indexing",
        diagnostic: { code: "INDEX_NOT_READY" },
      });
    }),
);

it.effect.each(["references", "cited-by", "annotation-uses"])(
  "#1683 refreshes saved text before its metadata event for %s",
  (command) =>
    Effect.gen(function* () {
      const h = yield* acquireAsyncDisposable(() =>
        createCitationIndexHarness(
          { "draft.md": `[@doe2024] [](${annotationUri})` },
          { zoteroRows: annotationRows },
        ),
      );
      h.workspace.layoutReady();
      yield* Effect.promise(() => h.index.whenIndexed());
      h.vault.write(h.draft, "[@roe2025]");
      const answer = JSON.parse(
        yield* commands(h)(`zotlit:${command}`).handler(
          command === "references"
            ? { file: "draft.md" }
            : { key: command === "cited-by" ? "ABCD2345" : "ANN23456" },
        ),
      );
      expect(answer.ok).toBe(true);
      expect(answer.coverage).toBe("complete");
      expect(answer).toMatchObject(
        command === "references"
          ? { entries: [{ kind: "resolved", key: "ZZZ99999g7" }] }
          : { groups: [] },
      );
    }),
);

it.effect.each(["references", "cited-by", "annotation-uses"])(
  "#1683 bounds a stale saved scan refresh for %s",
  (command) =>
    Effect.gen(function* () {
      const h = yield* acquireAsyncDisposable(() =>
        createCitationIndexHarness(
          { "draft.md": `[@doe2024] [](${annotationUri})` },
          { zoteroRows: annotationRows },
        ),
      );
      h.workspace.layoutReady();
      yield* Effect.promise(() => h.index.whenIndexed());
      h.vault.write(h.draft, "[@roe2025]");
      const release = h.vault.hold(h.draft.path);
      yield* Effect.addFinalizer(() => Effect.sync(release));
      const fiber = yield* commands(h)(`zotlit:${command}`)
        .handler(
          command === "references"
            ? { file: "draft.md" }
            : { key: command === "cited-by" ? "ABCD2345" : "ANN23456" },
        )
        .pipe(Effect.forkChild);
      yield* TestClock.adjust(5_001);
      expect(JSON.parse(yield* Fiber.join(fiber))).toMatchObject({
        ok: false,
        coverage: "indexing",
        diagnostic: { code: "INDEX_NOT_READY" },
      });
    }),
);
