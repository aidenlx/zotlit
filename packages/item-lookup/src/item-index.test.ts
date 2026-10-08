import { Cause, Context, Effect, Exit, Fiber, Layer, Scheduler } from "effect";
import type { Scope } from "effect";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { USER_LIBRARY_ID } from "@zotlit/db";

import { makeMemoryItemRow as item } from "./fixtures";
import { ItemIndex, layerItemIndex, SourceUnavailable } from "./item-index";
import type { IndexSettings, SearchHit } from "./item-index";
import { makeMemoryItemSource } from "./memory-item-source";
import type { MemoryItemRow, MemoryItemSource } from "./memory-item-source";
import { makeMemorySegmenterBinaryReader } from "./memory-segmenter-binary-reader";
import type { MemorySegmenterBinaryReader } from "./memory-segmenter-binary-reader";
import type { SegmenterBinary } from "./segmenter-switch";

const GROUP_LIBRARY_ID = 2;

const alpha = item({
  key: "ALPHA",
  itemID: 1,
  title: "Alpha transit memo",
  dateModified: "2024-01-01T00:00:00Z",
});
const beta = item({
  key: "BETA",
  itemID: 2,
  title: "Beta transit report",
  dateModified: "2025-01-01T00:00:00Z",
});
const gamma = item({
  key: "GAMMA",
  itemID: 3,
  libraryID: GROUP_LIBRARY_ID,
  title: "Gamma river survey",
  dateModified: "2023-01-01T00:00:00Z",
});

const delta = item({
  key: "DELTA",
  itemID: 4,
  title: "Delta transit notes",
  dateModified: "2026-01-01T00:00:00Z",
});

// `Intl.Segmenter` keeps `长江流域` whole; jieba's `cut_for_search` adds
// `长江`, `江流`, `流域`. So `流域` hits only through jieba.
const chinese = item({
  key: "CHINA",
  itemID: 9,
  title: "长江流域的城市化研究",
  dateModified: "2022-01-01T00:00:00Z",
});
const JIEBA_ONLY = "流域";
const WHOLE_RUN = "长江流域";
// The web target binary, as the Chinese Segmenter download delivers it.
const JIEBA_WASM = readFileSync(
  fileURLToPath(
    new URL("jieba_rs_wasm_bg.wasm", import.meta.resolve("jieba-wasm/web")),
  ),
);
const INSTALLED: SegmenterBinary = {
  directory: "chinese-segmenter",
  name: "pinned.wasm",
};
const MISSING: SegmenterBinary = {
  directory: "chinese-segmenter",
  name: "missing.wasm",
};
const CORRUPT: SegmenterBinary = {
  directory: "chinese-segmenter",
  name: "corrupt.wasm",
};
/** The bytes each binary of the tests reads as; another binary is missing. */
const storedBytes = (binary: SegmenterBinary): BufferSource | undefined =>
  binary.name === INSTALLED.name
    ? JIEBA_WASM
    : binary.name === CORRUPT.name
      ? new Uint8Array([0, 1, 2, 3])
      : undefined;

const USER = [USER_LIBRARY_ID] as const;
const GROUP = [GROUP_LIBRARY_ID] as const;

interface Harness {
  source: MemoryItemSource;
  reader: MemorySegmenterBinaryReader;
  /** The Indexed Keys of the hits, best first. */
  search: (
    libraries: readonly number[],
    query: string,
  ) => Effect.Effect<string[], unknown>;
  /** The hydrated hits, best first. */
  hits: (
    libraries: readonly number[],
    query: string,
  ) => Effect.Effect<readonly SearchHit[], SourceUnavailable>;
  configure: (settings: IndexSettings) => Effect.Effect<void>;
}

interface Setup {
  /** The rows of each Library; by default Alpha and Beta in the user Library, Gamma in the group. */
  rows?: ReadonlyMap<number, readonly MemoryItemRow[]>;
  /** Yield every few steps, so concurrent fibers interleave finely. */
  maxOpsBeforeYield?: number;
  /** @default { locale: "en", segmenterBinary: null } */
  initial?: IndexSettings;
  /** @default storedBytes */
  bytesFor?: (binary: SegmenterBinary) => BufferSource | undefined;
}

/** Run `body` against a fresh Item Index over in-memory ports. */
function withIndex<A>(
  body: (harness: Harness) => Effect.Effect<A, unknown, Scope.Scope>,
  setup: Setup = {},
): Promise<A> {
  const { maxOpsBeforeYield } = setup;
  return Effect.gen(function* () {
    const source = yield* makeMemoryItemSource(
      setup.rows ??
        new Map([
          [USER_LIBRARY_ID, [alpha, beta]],
          [GROUP_LIBRARY_ID, [gamma]],
        ]),
    );
    const reader = yield* makeMemorySegmenterBinaryReader(
      setup.bytesFor ?? storedBytes,
    );
    const context = yield* Layer.build(
      layerItemIndex(
        setup.initial ?? { locale: "en", segmenterBinary: null },
      ).pipe(Layer.provide([source.layer, reader.layer])),
    );
    const { search, configure } = Context.get(context, ItemIndex);
    return yield* body({
      source,
      reader,
      search: (libraries, query) =>
        search(libraries, query, 50).pipe(
          Effect.map((hits) => hits.map((hit) => hit.item.indexedKey)),
        ),
      hits: (libraries, query) => search(libraries, query, 50),
      configure,
    });
  }).pipe(
    Effect.scoped,
    (program) =>
      maxOpsBeforeYield === undefined
        ? program
        : Effect.provideService(
            program,
            Scheduler.MaxOpsBeforeYield,
            maxOpsBeforeYield,
          ),
    Effect.runPromise,
  );
}

describe("Item Index", () => {
  it("runs no build before the first search", async () => {
    const reads = await withIndex(({ source }) =>
      Effect.gen(function* () {
        yield* source.notify;
        yield* Effect.yieldNow;
        return { ...source.reads };
      }),
    );

    expect(reads).toEqual({
      pinned: 0,
      itemIDs: 0,
      items: 0,
      signature: 0,
      itemsByIndexedKey: 0,
      interrupted: 0,
      released: 0,
    });
  });

  it("builds once for the first search and reuses the index after", async () => {
    const result = await withIndex(({ source, search }) =>
      Effect.gen(function* () {
        const first = yield* search(USER, "");
        const second = yield* search(USER, "transit");
        return { first, second, itemIDs: source.reads.itemIDs };
      }),
    );

    expect(result.first).toEqual(["BETA", "ALPHA"]);
    expect(result.second).toEqual(expect.arrayContaining(["ALPHA", "BETA"]));
    expect(result.itemIDs).toBe(1);
  });

  it("shares one build between parallel first searches", async () => {
    const result = await withIndex(({ source, search }) =>
      Effect.gen(function* () {
        const answers = yield* Effect.all(
          [search(USER, ""), search(USER, "")],
          {
            concurrency: "unbounded",
          },
        ).pipe(
          // Yield every few steps, so the two searches interleave at the
          // points where the scheduler could split them.
          Effect.provideService(Scheduler.MaxOpsBeforeYield, 4),
        );
        return { answers, itemIDs: source.reads.itemIDs };
      }),
    );

    expect(result.answers).toEqual([
      ["BETA", "ALPHA"],
      ["BETA", "ALPHA"],
    ]);
    expect(result.itemIDs).toBe(1);
  });

  it("answers from the old index while a new generation rebuilds", async () => {
    const result = await withIndex(({ source, search }) =>
      Effect.gen(function* () {
        yield* search(USER, "");
        yield* source.setItems(USER_LIBRARY_ID, [alpha, beta, delta]);
        yield* source.closeGate;
        yield* source.swap;
        yield* source.held;
        const during = yield* search(USER, "");
        yield* source.openGate;
        const after = yield* until(
          search(USER, ""),
          (keys) => keys.length === 3,
        );
        return { during, after, itemIDs: source.reads.itemIDs };
      }),
    );

    expect(result.during).toEqual(["BETA", "ALPHA"]);
    expect(result.after).toEqual(["DELTA", "BETA", "ALPHA"]);
    expect(result.itemIDs).toBe(2);
  });

  it("rebuilds on a moved signature", async () => {
    const result = await withIndex(({ source, search }) =>
      Effect.gen(function* () {
        yield* search(USER, "");
        yield* source.setItems(USER_LIBRARY_ID, [alpha, beta, delta]);
        yield* source.notify;
        const after = yield* until(
          search(USER, ""),
          (keys) => keys.length === 3,
        );
        return { after, itemIDs: source.reads.itemIDs };
      }),
    );

    expect(result.after).toEqual(["DELTA", "BETA", "ALPHA"]);
    expect(result.itemIDs).toBe(2);
  });

  it("rebuilds on a swapped source with equal signatures", async () => {
    const itemIDs = await withIndex(({ source, search }) =>
      Effect.gen(function* () {
        yield* search(USER, "");
        yield* source.swap;
        yield* eventually(() => source.reads.released === 1);
        return source.reads.itemIDs;
      }),
    );

    expect(itemIDs).toBe(2);
  });

  it("keeps the index on an equal signature and an unchanged generation", async () => {
    const reads = await withIndex(({ source, search }) =>
      Effect.gen(function* () {
        yield* search(USER, "");
        yield* source.notify;
        yield* eventually(() => source.reads.released === 1);
        yield* search(USER, "");
        return { ...source.reads };
      }),
    );

    expect(reads.signature).toBe(2);
    expect(reads.itemIDs).toBe(1);
  });

  it("evicts an abandoned list at the next emission and interrupts its build", async () => {
    const result = await withIndex(({ source, search }) =>
      Effect.gen(function* () {
        yield* source.closeGate;
        const abandoned = yield* Effect.forkChild(search(USER, ""));
        yield* source.held;
        yield* Fiber.interrupt(abandoned);
        // The first emission still counts the search before it.
        yield* source.notify;
        const group = yield* Effect.forkChild(search(GROUP, ""));
        yield* eventually(() => source.waiting === 2);
        yield* source.notify;
        yield* eventually(() => source.reads.interrupted === 1);
        yield* source.openGate;
        const answer = yield* Fiber.join(group);
        const itemIDsBefore = source.reads.itemIDs;
        yield* search(USER, "");
        return {
          answer,
          interrupted: source.reads.interrupted,
          rebuiltUser: source.reads.itemIDs - itemIDsBefore,
        };
      }),
    );

    expect(result.answer).toEqual(["GAMMA"]);
    expect(result.interrupted).toBe(1);
    expect(result.rebuiltUser).toBe(1);
  });

  it("runs exactly two builds for two emissions during a gated build", async () => {
    const result = await withIndex(({ source, search }) =>
      Effect.gen(function* () {
        yield* source.closeGate;
        const first = yield* Effect.forkChild(search(USER, ""));
        yield* source.held;
        yield* source.setItems(USER_LIBRARY_ID, [alpha, beta, delta]);
        yield* source.swap;
        yield* source.swap;
        yield* source.openGate;
        // The first waiter waits for the whole lane, trailing rerun included.
        const answer = yield* Fiber.join(first);
        return {
          answer,
          itemIDs: source.reads.itemIDs,
          interrupted: source.reads.interrupted,
        };
      }),
    );

    expect(result.answer).toEqual(["DELTA", "BETA", "ALPHA"]);
    expect(result.itemIDs).toBe(2);
    expect(result.interrupted).toBe(0);
  });

  it("runs the trailing rebuild for changes that land as a build ends", async () => {
    const epsilon = item({
      key: "EPSILON",
      itemID: 5,
      title: "Epsilon transit atlas",
      dateModified: "2027-01-01T00:00:00Z",
    });
    const answer = await withIndex(
      ({ source, search }) =>
        Effect.gen(function* () {
          yield* search(USER, "");
          // The second swap lands as the first rebuild replaces the index,
          // after the lane's last check for a trailing request.
          yield* source.onNextRelease(
            Effect.andThen(
              source.setItems(USER_LIBRARY_ID, [alpha, beta, delta, epsilon]),
              source.swap,
            ),
          );
          yield* source.setItems(USER_LIBRARY_ID, [alpha, beta, delta]);
          yield* source.swap;
          return yield* until(search(USER, ""), (keys) => keys.length === 4);
        }),
      { maxOpsBeforeYield: 4 },
    );

    expect(answer).toEqual(["EPSILON", "DELTA", "BETA", "ALPHA"]);
  });

  it("keeps the build running when its first waiter is interrupted", async () => {
    const result = await withIndex(({ source, search }) =>
      Effect.gen(function* () {
        yield* source.closeGate;
        const waiter = yield* Effect.forkChild(search(USER, ""));
        yield* source.held;
        yield* Fiber.interrupt(waiter);
        yield* source.openGate;
        const answer = yield* search(USER, "");
        return {
          answer,
          itemIDs: source.reads.itemIDs,
          interrupted: source.reads.interrupted,
        };
      }),
    );

    expect(result.answer).toEqual(["BETA", "ALPHA"]);
    expect(result.itemIDs).toBe(1);
    expect(result.interrupted).toBe(0);
  });

  it("answers a search while another list builds", async () => {
    const result = await withIndex(({ source, search }) =>
      Effect.gen(function* () {
        yield* search(USER, "");
        yield* source.closeGate;
        const group = yield* Effect.forkChild(search(GROUP, ""));
        yield* source.held;
        const user = yield* search(USER, "");
        const groupDone = group.pollUnsafe() !== undefined;
        yield* source.openGate;
        return { user, groupDone, group: yield* Fiber.join(group) };
      }),
    );

    expect(result.user).toEqual(["BETA", "ALPHA"]);
    expect(result.groupDone).toBe(false);
    expect(result.group).toEqual(["GAMMA"]);
  });

  it("rebuilds every held list on a locale change", async () => {
    const itemIDs = await withIndex(({ source, search, configure }) =>
      Effect.gen(function* () {
        yield* search(USER, "");
        yield* search(GROUP, "");
        yield* configure({ locale: "zh", segmenterBinary: null });
        yield* eventually(() => source.reads.released === 2);
        return source.reads.itemIDs;
      }),
    );

    expect(itemIDs).toBe(4);
  });

  it("hydrates the hits on the source the answering index holds, the old one while a rebuild waits", async () => {
    const renamed = item({
      key: "BETA",
      itemID: 2,
      title: "Beta transit summary",
      dateModified: "2025-01-01T00:00:00Z",
    });
    const result = await withIndex(({ source, hits }) =>
      Effect.gen(function* () {
        const first = yield* hits(USER, "transit");
        yield* source.setItems(USER_LIBRARY_ID, [alpha, renamed, delta]);
        yield* source.closeGate;
        yield* source.swap;
        yield* source.held;
        const during = yield* hits(USER, "transit");
        yield* source.openGate;
        const after = yield* until(
          hits(USER, "transit"),
          (answer) => answer.length === 3,
        );
        return { first, during, after };
      }),
    );

    expect(titlesOf(result.first)).toEqual({
      BETA: "Beta transit report",
      ALPHA: "Alpha transit memo",
    });
    expect(result.during).toEqual(result.first);
    expect(titlesOf(result.after)).toEqual({
      DELTA: "Delta transit notes",
      BETA: "Beta transit summary",
      ALPHA: "Alpha transit memo",
    });
    // The highlight ranges describe the title the hit carries.
    for (const hit of [...result.first, ...result.after]) {
      const title = titleOf(hit) ?? "";
      expect(
        hit.matches.map(([start, end]) => title.slice(start, end)),
      ).toEqual(["transit"]);
    }
  });

  it("drops a hit whose Item vanished from the source the index holds", async () => {
    const result = await withIndex(({ source, search }) =>
      Effect.gen(function* () {
        const before = yield* search(USER, "");
        // No change event: the index still holds the Item.
        yield* source.vanish("ALPHA");
        const after = yield* search(USER, "");
        return { before, after, itemIDs: source.reads.itemIDs };
      }),
    );

    expect(result.before).toEqual(["BETA", "ALPHA"]);
    expect(result.after).toEqual(["BETA"]);
    expect(result.itemIDs).toBe(1);
  });

  it("holds an index's source until a newer index replaces it and no search holds it", async () => {
    const result = await withIndex(({ source, search }) =>
      Effect.gen(function* () {
        yield* search(USER, "");
        const built = source.reads.released;
        // A search holds the index's source while it hydrates.
        yield* source.closeHydrationGate;
        const held = yield* Effect.forkChild(search(USER, ""));
        yield* source.hydrationHeld;
        yield* source.setItems(USER_LIBRARY_ID, [alpha, beta, delta]);
        yield* source.swap;
        yield* until(search(USER, ""), (keys) => keys.length === 3);
        const replaced = source.reads.released;
        yield* source.openHydrationGate;
        const answer = yield* Fiber.join(held);
        return { built, replaced, answer, closed: source.reads.released };
      }),
    );

    expect(result).toEqual({
      built: 0,
      replaced: 0,
      answer: ["BETA", "ALPHA"],
      closed: 1,
    });
  });

  it("releases the source of a list evicted at an emission", async () => {
    const released = await withIndex(({ source, search }) =>
      Effect.gen(function* () {
        yield* search(USER, "");
        yield* search(GROUP, "");
        // The first emission counts both searches and re-checks both lists.
        yield* source.notify;
        yield* eventually(() => source.reads.released === 2);
        // The second evicts the user list and re-checks the group list.
        yield* source.notify;
        yield* eventually(() => source.reads.released === 4);
        return source.reads.released;
      }),
    );

    expect(released).toBe(4);
  });

  it("keeps the latest list warm across emissions with no search between", async () => {
    const result = await withIndex(({ source, search }) =>
      Effect.gen(function* () {
        yield* search(USER, "");
        yield* search(GROUP, "");
        yield* source.notify;
        yield* eventually(() => source.reads.released === 2);
        yield* source.notify;
        yield* eventually(() => source.reads.released === 4);
        yield* source.notify;
        yield* eventually(() => source.reads.released === 5);
        const before = source.reads.itemIDs;
        const group = yield* search(GROUP, "");
        const groupBuilds = source.reads.itemIDs - before;
        const user = yield* search(USER, "");
        return {
          group,
          groupBuilds,
          user,
          userBuilds: source.reads.itemIDs - before - groupBuilds,
        };
      }),
    );

    expect(result).toEqual({
      group: ["GAMMA"],
      groupBuilds: 0,
      user: ["BETA", "ALPHA"],
      userBuilds: 1,
    });
  });

  it("fails the search and drops the index when the source is unavailable", async () => {
    const result = await withIndex(({ source, search }) =>
      Effect.gen(function* () {
        yield* search(USER, "");
        yield* source.setUnavailable(true);
        yield* source.notify;
        const exit = yield* until(
          Effect.exit(search(USER, "")),
          Exit.isFailure,
        );
        const failure = Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
        yield* source.setUnavailable(false);
        // The recovered source builds again: the failure dropped the index.
        const answer = yield* search(USER, "");
        return { failure, answer, itemIDs: source.reads.itemIDs };
      }),
    );

    expect(result.failure).toBeInstanceOf(SourceUnavailable);
    expect(result.answer).toEqual(["BETA", "ALPHA"]);
    expect(result.itemIDs).toBe(2);
  });
});

describe("Item Index with the Chinese Segmenter", () => {
  const rows: Setup = {
    rows: new Map([
      [USER_LIBRARY_ID, [chinese, alpha]],
      [GROUP_LIBRARY_ID, [gamma]],
    ]),
  };
  const EVERYTHING = [USER_LIBRARY_ID, GROUP_LIBRARY_ID] as const;
  const installed: Setup = {
    ...rows,
    initial: { locale: "en", segmenterBinary: INSTALLED },
  };

  it("cuts Chinese titles and queries with jieba from an installed binary at start", async () => {
    const result = await withIndex(
      ({ reader, search }) =>
        Effect.gen(function* () {
          const hits = yield* search(USER, JIEBA_ONLY);
          return { hits, asked: [...reader.asked] };
        }),
      installed,
    );

    expect(result).toEqual({ hits: ["CHINA"], asked: [INSTALLED] });
  });

  it("segments CJK runs through Intl.Segmenter with no binary", async () => {
    const result = await withIndex(
      ({ reader, search }) =>
        Effect.gen(function* () {
          const part = yield* search(USER, JIEBA_ONLY);
          const whole = yield* search(USER, WHOLE_RUN);
          return { part, whole, asked: reader.asked.length };
        }),
      rows,
    );

    expect(result).toEqual({ part: [], whole: ["CHINA"], asked: 0 });
  });

  it("rebuilds every held list once on a configure that installs the binary", async () => {
    const result = await withIndex(
      ({ source, search, configure }) =>
        Effect.gen(function* () {
          const before = yield* search(USER, JIEBA_ONLY);
          yield* search(EVERYTHING, "");
          yield* configure({ locale: "en", segmenterBinary: INSTALLED });
          const after = yield* until(
            search(USER, JIEBA_ONLY),
            (keys) => keys.length > 0,
          );
          yield* eventually(() => source.reads.itemIDs >= 6);
          yield* search(EVERYTHING, "");
          return { before, after, itemIDs: source.reads.itemIDs };
        }),
      rows,
    );

    expect(result.before).toEqual([]);
    expect(result.after).toEqual(["CHINA"]);
    // One ids read per Library per build: [1] and [1, 2], each built twice.
    expect(result.itemIDs).toBe(6);
  });

  it("rebuilds every held list once on a configure that changes the locale and installs the binary", async () => {
    const itemIDs = await withIndex(
      ({ source, search, configure }) =>
        Effect.gen(function* () {
          yield* search(USER, JIEBA_ONLY);
          yield* search(EVERYTHING, JIEBA_ONLY);
          yield* configure({ locale: "zh", segmenterBinary: INSTALLED });
          // A jieba hit shows only after a build with both settings.
          for (const libraries of [USER, EVERYTHING]) {
            yield* until(
              search(libraries, JIEBA_ONLY),
              (keys) => keys.length > 0,
            );
          }
          return source.reads.itemIDs;
        }),
      rows,
    );

    // One ids read per Library per build: [1] and [1, 2], each built twice.
    expect(itemIDs).toBe(6);
  });

  it("falls back to Intl.Segmenter and still answers on a configure that uninstalls the binary", async () => {
    const result = await withIndex(
      ({ search, configure }) =>
        Effect.gen(function* () {
          const before = yield* search(USER, JIEBA_ONLY);
          yield* configure({ locale: "en", segmenterBinary: null });
          const part = yield* until(
            search(USER, JIEBA_ONLY),
            (keys) => keys.length === 0,
          );
          const whole = yield* search(USER, WHOLE_RUN);
          return { before, part, whole };
        }),
      installed,
    );

    expect(result).toEqual({ before: ["CHINA"], part: [], whole: ["CHINA"] });
  });

  it.each([
    ["missing", MISSING],
    ["corrupt", CORRUPT],
  ])(
    "keeps search answering on Intl.Segmenter with a %s binary at start",
    async (_, binary) => {
      const result = await withIndex(
        ({ search }) =>
          Effect.gen(function* () {
            const part = yield* search(USER, JIEBA_ONLY);
            const whole = yield* search(USER, WHOLE_RUN);
            return { part, whole };
          }),
        { ...rows, initial: { locale: "en", segmenterBinary: binary } },
      );

      expect(result).toEqual({ part: [], whole: ["CHINA"] });
    },
  );

  it("keeps search answering on Intl.Segmenter after a configure with a corrupt binary", async () => {
    const result = await withIndex(
      ({ source, search, configure }) =>
        Effect.gen(function* () {
          yield* search(USER, WHOLE_RUN);
          yield* configure({ locale: "en", segmenterBinary: CORRUPT });
          const whole = yield* search(USER, WHOLE_RUN);
          return { whole, itemIDs: source.reads.itemIDs };
        }),
      rows,
    );

    // The index never left Intl.Segmenter, so nothing rebuilt.
    expect(result).toEqual({ whole: ["CHINA"], itemIDs: 1 });
  });

  it("tries the same binary again on a configure after a failed load", async () => {
    let reads = 0;
    const result = await withIndex(
      ({ search, configure }) =>
        Effect.gen(function* () {
          const failed = yield* search(USER, JIEBA_ONLY);
          yield* configure({ locale: "en", segmenterBinary: INSTALLED });
          const retried = yield* until(
            search(USER, JIEBA_ONLY),
            (keys) => keys.length > 0,
          );
          return { failed, retried };
        }),
      {
        ...installed,
        bytesFor: () => {
          reads++;
          return reads === 1 ? undefined : JIEBA_WASM;
        },
      },
    );

    expect(reads).toBe(2);
    expect(result).toEqual({ failed: [], retried: ["CHINA"] });
  });

  it("applies an uninstall racing an install in arrival order", async () => {
    const result = await withIndex(
      ({ reader, search, configure }) =>
        Effect.gen(function* () {
          yield* reader.closeGate;
          const install = yield* Effect.forkChild(
            configure({ locale: "en", segmenterBinary: INSTALLED }),
          );
          yield* reader.held;
          const uninstall = yield* Effect.forkChild(
            configure({ locale: "en", segmenterBinary: null }),
          );
          yield* Effect.yieldNow;
          // The uninstall waits for the install that reads its binary.
          // An unstarted fiber also polls undefined; the final hits still prove arrival order.
          const waited = uninstall.pollUnsafe() === undefined;
          yield* reader.openGate;
          yield* Fiber.join(install);
          yield* Fiber.join(uninstall);
          return { waited, hits: yield* search(USER, JIEBA_ONLY) };
        }),
      rows,
    );

    expect(result).toEqual({ waited: true, hits: [] });
  });

  it.each([
    ["no binary", null],
    ["the installed binary", INSTALLED],
  ])(
    "rebuilds nothing on a configure with equal settings and %s",
    async (_, binary) => {
      const result = await withIndex(
        ({ source, reader, search, configure }) =>
          Effect.gen(function* () {
            yield* search(USER, "");
            yield* configure({ locale: "en", segmenterBinary: binary });
            // A change re-checks the list; its release ends the first
            // rebuild after the configure, so a configure rebuild lands first.
            yield* source.notify;
            yield* eventually(() => source.reads.released === 1);
            yield* search(USER, "");
            return {
              itemIDs: source.reads.itemIDs,
              asked: reader.asked.length,
            };
          }),
        { ...rows, initial: { locale: "en", segmenterBinary: binary } },
      );

      // One ids read: the first build. The re-check reads only signatures.
      expect(result).toEqual({ itemIDs: 1, asked: binary ? 1 : 0 });
    },
  );
});

/** The title of each hit, keyed by Indexed Key in rank order. */
function titlesOf(hits: readonly SearchHit[]): Record<string, string | null> {
  return Object.fromEntries(
    hits.map((hit) => [hit.item.indexedKey, titleOf(hit)]),
  );
}

function titleOf({ item }: SearchHit): string | null {
  return "title" in item.fields ? (item.fields.title ?? null) : null;
}

/** Yield until `check` holds; fail the test when it never does. */
function eventually(check: () => boolean): Effect.Effect<void> {
  return until(
    Effect.sync(() => undefined),
    () => check(),
  ).pipe(Effect.asVoid);
}

/** Run `probe` until its answer passes `check`, yielding between runs. */
function until<A, E>(
  probe: Effect.Effect<A, E>,
  check: (answer: A) => boolean,
): Effect.Effect<A, E> {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 200; attempt++) {
      const answer = yield* probe;
      if (check(answer)) return answer;
      yield* Effect.yieldNow;
    }
    return yield* Effect.die(new Error("condition never held"));
  });
}
