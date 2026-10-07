import {
  Cause,
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  SubscriptionRef,
} from "effect";
import type { Scope } from "effect";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { USER_LIBRARY_ID } from "@zotlit/db";
import type { IndexedItem } from "@zotlit/db";

import { makeIndexedItem as item } from "./fixtures";
import {
  IndexConfig,
  ItemIndex,
  layerIndexConfig,
  layerItemIndex,
  SourceUnavailable,
  switchSegmenter,
} from "./item-index";
import { makeMemoryItemSource } from "./memory-item-source";
import type { MemoryItemSource } from "./memory-item-source";
import { layerSegmenterJieba, layerSegmenterNone } from "./segmenter";

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

const TITLE = "中华人民共和国宪法研究";
// The web target binary, as the Chinese Segmenter download delivers it.
const JIEBA_WASM = readFileSync(
  fileURLToPath(
    new URL("jieba_rs_wasm_bg.wasm", import.meta.resolve("jieba-wasm/web")),
  ),
);

const USER = [USER_LIBRARY_ID] as const;
const GROUP = [GROUP_LIBRARY_ID] as const;

interface Harness {
  source: MemoryItemSource;
  search: (
    libraries: readonly number[],
    query: string,
  ) => Effect.Effect<string[], unknown>;
  config: (typeof IndexConfig)["Service"];
}

/** Run `body` against a fresh Item Index over an in-memory source. */
function withIndex<A>(
  body: (harness: Harness) => Effect.Effect<A, unknown, Scope.Scope>,
  rows: ReadonlyMap<number, readonly IndexedItem[]> = new Map([
    [USER_LIBRARY_ID, [alpha, beta]],
    [GROUP_LIBRARY_ID, [gamma]],
  ]),
): Promise<A> {
  return Effect.gen(function* () {
    const source = yield* makeMemoryItemSource(rows);
    const context = yield* Layer.build(
      layerItemIndex.pipe(
        Layer.provideMerge(layerIndexConfig({ locale: "en" })),
        Layer.provide([source.layer, layerSegmenterNone]),
      ),
    );
    const { search } = Context.get(context, ItemIndex);
    const config = Context.get(context, IndexConfig);
    return yield* body({
      source,
      config,
      search: (libraries, query) =>
        search(libraries, query, 50).pipe(
          Effect.map((hits) => hits.map((hit) => hit.indexedKey)),
        ),
    });
  }).pipe(Effect.scoped, Effect.runPromise);
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
      interrupted: 0,
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

  it("shares one build between two parallel first searches", async () => {
    const result = await withIndex(({ source, search }) =>
      Effect.gen(function* () {
        const [first, second] = yield* Effect.all(
          [search(USER, ""), search(USER, "")],
          { concurrency: "unbounded" },
        );
        return { first, second, itemIDs: source.reads.itemIDs };
      }),
    );

    expect(result.first).toEqual(["BETA", "ALPHA"]);
    expect(result.second).toEqual(["BETA", "ALPHA"]);
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
        yield* eventually(() => source.reads.itemIDs === 2);
        yield* settle;
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
        yield* eventually(() => source.reads.signature === 2);
        yield* settle;
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
        yield* settle;
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
        const answer = yield* Fiber.join(first);
        yield* settle;
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
    const itemIDs = await withIndex(({ source, search, config }) =>
      Effect.gen(function* () {
        yield* search(USER, "");
        yield* search(GROUP, "");
        yield* SubscriptionRef.set(config.locale, "zh");
        yield* eventually(() => source.reads.itemIDs === 4);
        yield* settle;
        return source.reads.itemIDs;
      }),
    );

    expect(itemIDs).toBe(4);
  });

  it("re-tokenizes every held list when the Segmenter switches", async () => {
    const chinese = item({ key: "CHINA", itemID: 9, title: TITLE });
    const result = await withIndex(
      ({ source, search, config }) =>
        Effect.gen(function* () {
          const before = yield* search(USER, "华人");
          yield* switchSegmenter(layerSegmenterJieba(JIEBA_WASM)).pipe(
            Effect.provideService(IndexConfig, config),
          );
          const jieba = yield* until(
            search(USER, "华人"),
            (keys) => keys.length > 0,
          );
          yield* switchSegmenter(layerSegmenterNone).pipe(
            Effect.provideService(IndexConfig, config),
          );
          const fallback = yield* until(
            search(USER, "华人"),
            (keys) => keys.length === 0,
          );
          return { before, jieba, fallback, itemIDs: source.reads.itemIDs };
        }),
      new Map([[USER_LIBRARY_ID, [chinese]]]),
    );

    expect(result).toEqual({
      before: [],
      jieba: ["CHINA"],
      fallback: [],
      itemIDs: 3,
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

/** Let background fibers run until they block. */
const settle = Effect.repeat(Effect.yieldNow, { times: 20 });

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
