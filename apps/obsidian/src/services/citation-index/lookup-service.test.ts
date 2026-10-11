import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { yieldToMain } from "@/lib/yield-to-main";
import { QueryClientService } from "@/services/query-client/service";
import { layerRcRef } from "@/services/zotero-reads/connection";
import type { ZoteroReadsClient } from "@/services/zotero-reads/in-process";
import { ZoteroReadsService } from "@/services/zotero-reads/service";
import {
  inProcessClient,
  memoryOpener,
  seedWorksSql,
} from "@/services/zotero-reads/test-utils";

import {
  GROUP_KEY,
  TWIN_KEY,
  myLibraryRow,
  sameLibraryTwin,
  groupTwin,
  bothLibraries,
} from "./__fixtures__/ambiguous";
import { CitationLookup } from "./lookup-service";
import {
  createCitationIndexHarness,
  DatabaseStub,
  groupLibrary,
  GROUP_LIBRARY_ID,
  MY_LIBRARY_ID,
  KEY_A,
  KEY_B,
} from "./test-harness";
import type {
  CitationIndexHarness,
  CitationIndexHarnessOptions,
} from "./test-harness";
import { LibraryScopeStub, personalLibrary } from "./test-harness";

const queryClients: AsyncDisposable[] = [];
afterEach(async () => {
  for (const client of queryClients.splice(0))
    await client[Symbol.asyncDispose]();
});

function fixture(
  options: {
    opening?: Promise<void>;
    wrap?: (client: ZoteroReadsClient) => ZoteroReadsClient;
  } = {},
) {
  let key = "first";
  const opener = memoryOpener(() =>
    seedWorksSql([{ itemID: 1, key: "ITEMKEY1", citationKey: key }]),
  );
  const shared = new ZoteroReadsService({
    client: Effect.gen(function* () {
      yield* Effect.promise(() => options.opening ?? Promise.resolve());
      const client = yield* inProcessClient(layerRcRef(opener.open));
      yield* client.Libraries({}).pipe(Effect.orDie);
      return options.wrap?.(client) ?? client;
    }),
  });
  queryClients.push(shared);
  const queryClient = new QueryClientService();
  queryClients.push(queryClient);
  const libraryScope = new LibraryScopeStub([personalLibrary()]);
  const reads = new CitationLookup({
    queryClient,
    libraryScope,
    reads: shared,
  });
  return {
    reads,
    shared,
    libraryScope,
    async change(next: string) {
      key = next;
      await shared.refresh();
    },
  };
}

const request = {
  citekeys: ["first", "second", "third"],
  indexedKeys: ["ITEMKEY1"],
};

it("builds once at startup with ready dependencies and no events", async () => {
  await using db = new DatabaseStub();
  const ready = await db.ready;
  const lookup = vi.spyOn(ready.client, "CitationLookup");
  await using queryClient = new QueryClientService();
  await using reads = new CitationLookup({
    queryClient,
    libraryScope: new LibraryScopeStub([personalLibrary()]),
    reads: {
      ready: Promise.resolve(ready),
      state: "ready",
      on: () => () => undefined,
    },
  });

  await reads.whenResolved();
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(reads.status).toBe("fresh");
});

it("keeps a source change during startup and answers from the latest source", async () => {
  const opening = Promise.withResolvers<void>();
  const source = fixture({ opening: opening.promise });
  await using reads = source.reads;
  const changing = source.change("second");
  opening.resolve();
  await changing;
  const answer = await reads.read(request);
  expect(answer.resolve("first")).toEqual({ kind: "missing" });
  expect(answer.citekeyOf("ITEMKEY1")).toBe("second");
});

it("refetches an observed answer when shared reads change", async () => {
  const source = fixture();
  await using lookup = source.reads;
  using view = lookup.observe(() => undefined);
  view.set(request);
  await expect.poll(() => view.current?.status).toBe("fresh");
  const previous = view.current!.value;
  await source.change("second");
  await expect
    .poll(() => view.current?.value.citekeyOf("ITEMKEY1"))
    .toBe("second");
  expect(previous.citekeyOf("ITEMKEY1")).toBe("first");
});

it("marks observed answers failed when shared reads degrade", async () => {
  await using h = await createCitationIndexHarness({});
  using view = h.lookup.observe(() => undefined);
  view.set({ citekeys: ["doe2024"] });
  await expect.poll(() => view.current?.status).toBe("fresh");
  const previous = view.current!.value;
  h.db.degrade();
  expect(h.lookup.status).toBe("failed");
  await expect.poll(() => view.current?.status).toBe("failed");
  expect(view.current!.value).toBe(previous);
  await expect(h.lookup.read({ citekeys: ["doe2024"] })).rejects.toThrow();
});

it("ends a cancelled call and unloads active calls and signal subscriptions", async () => {
  const entered = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  let started = 0;
  let ended = 0;
  const source = fixture({
    wrap: (client) => ({
      ...client,
      CitationLookup: ((payload, options) =>
        !payload.citekeys?.length
          ? client.CitationLookup(payload, options)
          : Effect.sync(() => {
              started += 1;
              (started === 1 ? entered : second).resolve();
            }).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() =>
                Effect.sync(() => {
                  ended += 1;
                }),
              ),
            )) as typeof client.CitationLookup,
    }),
  });
  const reads = source.reads;
  await reads.ready;
  const abort = new AbortController();
  const cancelled = reads.read(request, {
    signal: abort.signal,
  });
  const rejection = expect(cancelled).rejects.toBeDefined();
  await entered.promise;
  abort.abort();
  await rejection;
  expect(ended).toBe(1);
  const pending = reads.read(request);
  const stopped = expect(pending).rejects.toBeDefined();
  await second.promise;
  await reads[Symbol.asyncDispose]();
  await stopped;
  expect(ended).toBe(2);
  await source.change("second");
  await expect(reads.read(request)).rejects.toBeDefined();
});

const harnesses: CitationIndexHarness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0).reverse()) await h[Symbol.asyncDispose]();
});
async function makeHarness(
  documents: Record<string, string>,
  options: CitationIndexHarnessOptions = {},
): Promise<CitationIndexHarness> {
  const h = await createCitationIndexHarness(documents, options);
  harnesses.push(h);
  return h;
}

describe("Citation Lookup held reads", () => {
  it("keeps a previous requested answer while a changed request fails", async () => {
    const { lookup, citekeys, db } = await makeHarness({});
    using view = lookup.observe(() => {});
    view.set({ citekeys: ["doe2024"] });
    await expect.poll(() => view.current?.status).toBe("fresh");
    const previous = view.current!.value;
    citekeys.error = new Error("unavailable");
    db.changed();
    await expect.poll(() => view.current?.status).toBe("failed");
    view.set({ citekeys: ["doe2024", "newKey"] });
    expect(view.current?.value).toBe(previous);
    expect(view.current?.status).toBe("revalidating");
    await expect.poll(() => view.current?.status).toBe("failed");
    expect(view.current?.value).toBe(previous);
  });

  it("replaces a view's selection and never publishes after disposal", async () => {
    const db = new DatabaseStub({ readyImmediately: false });
    const { lookup } = await makeHarness({}, { db });
    let calls = 0;
    const view = lookup.observe(() => {
      calls += 1;
    });
    view.set({ citekeys: ["doe2024"] });
    view.set({ citekeys: ["roe2025"] });
    expect(view.current).toBeNull();
    db.settle();
    await expect
      .poll(() => view.current?.value.resolve("roe2025")?.kind)
      .toBe("unique");
    expect(() => view.current!.value.resolve("doe2024")).toThrow("doe2024");
    const beforeChange = calls;
    expect(beforeChange).toBeGreaterThan(0);
    view.set({ citekeys: ["doe2024"] });
    const beforeDispose = calls;
    view[Symbol.dispose]();
    await yieldToMain();
    expect(view.current).toBeNull();
    expect(calls).toBe(beforeDispose);
  });

  it("cancels one waiting caller while another receives its complete batch", async () => {
    const db = new DatabaseStub({ readyImmediately: false });
    const { lookup } = await makeHarness({}, { db });
    const controller = new AbortController();
    const canceled = lookup.read(
      { citekeys: ["doe2024"] },
      { signal: controller.signal },
    );
    const current = lookup.read({ indexedKeys: [KEY_B] });
    controller.abort();
    await expect(canceled).rejects.toThrow();
    db.settle();
    expect((await current).citekeyOf(KEY_B)).toBe("roe2025");
  });

  it("answers only the requested forward and reverse keys in one resolution revision", async () => {
    const { lookup } = await makeHarness({});
    const answer = await lookup.read({
      citekeys: ["doe2024", "absent"],
      indexedKeys: [KEY_B],
    });
    expect(answer.resolve("doe2024")).toMatchObject({
      kind: "unique",
      item: { indexedKey: KEY_A },
    });
    expect(answer.resolve("absent")).toEqual({ kind: "missing" });
    expect(() => answer.resolve("roe2025")).toThrow("roe2025");
    expect(answer.citekeyOf(KEY_B)).toBe("roe2025");
    expect(() => answer.citekeyOf(KEY_A)).toThrow(KEY_A);
    expect(answer.revision).toBeTruthy();
  });

  it("discovers Libraries from the pinned read and applies scope by stable identity", async () => {
    const libraryScope = new LibraryScopeStub([
      personalLibrary(),
      groupLibrary(),
    ]);
    libraryScope.select([groupLibrary()]);
    const { lookup, db, citekeys } = await makeHarness({}, { libraryScope });
    db.libraries = () => [
      personalLibrary(8),
      groupLibrary({ libraryID: 9 }),
      groupLibrary({ libraryID: 10, groupID: 12 }),
    ];
    citekeys.rows = [
      {
        itemID: 1,
        libraryID: 8,
        key: "PERSONAL",
        indexedKey: "PERSONAL",
        citekey: "shared",
      },
      {
        itemID: 2,
        libraryID: 9,
        key: "GROUPKEY",
        indexedKey: "GROUPKEYg7",
        citekey: "shared",
      },
      {
        itemID: 3,
        libraryID: 10,
        key: "NEWGROUP",
        indexedKey: "NEWGROUPg12",
        citekey: "newGroup",
      },
    ];
    db.changed();
    await lookup.whenResolved();
    expect(
      (await lookup.read({ citekeys: ["shared"] })).resolve("shared"),
    ).toMatchObject({
      kind: "unique",
      item: { indexedKey: "GROUPKEYg7" },
    });
    expect(
      (await lookup.read({ indexedKeys: ["NEWGROUPg12"] })).citekeyOf(
        "NEWGROUPg12",
      ),
    ).toBe("newGroup");
  });

  it("stays unresolved before the snapshot is warm, then resolves once the read settles", async () => {
    const db = new DatabaseStub({ readyImmediately: false });
    const { lookup } = await makeHarness({}, { db, notes: false });

    using observation = lookup.observe(() => {});
    observation.set({ citekeys: ["doe2024"] });
    expect(observation.current).toBeNull();
    const waiting = lookup.whenResolved();

    db.settle();
    await waiting;

    expect(
      (await lookup.read({ citekeys: ["doe2024"] })).resolve("doe2024"),
    ).toEqual({
      kind: "unique",
      item: {
        itemID: 1,
        libraryID: MY_LIBRARY_ID,
        key: KEY_A,
        indexedKey: KEY_A,
      },
    });
  });

  it("rebuilds on the database changed event, replacing the old key with the new one", async () => {
    const { lookup, citekeys, db } = await makeHarness({}, { notes: false });
    expect(
      (await lookup.read({ citekeys: ["doe2024"] })).resolve("doe2024")?.kind,
    ).toBe("unique");
    expect(
      (await lookup.read({ citekeys: ["doe2024b"] })).resolve("doe2024b")?.kind,
    ).toBe("missing");

    citekeys.rows = citekeys.rows.map((row) =>
      row.citekey === "doe2024" ? { ...row, citekey: "doe2024b" } : row,
    );
    let notified = 0;
    lookup.on("changed", () => notified++);

    db.changed();
    await lookup.whenResolved();
    await yieldToMain();

    expect(notified).toBeGreaterThan(0);
    expect(
      (await lookup.read({ citekeys: ["doe2024"] })).resolve("doe2024"),
    ).toEqual({ kind: "missing" });
    expect(
      (await lookup.read({ citekeys: ["doe2024b"] })).resolve("doe2024b"),
    ).toMatchObject({
      kind: "unique",
      item: { itemID: 1, indexedKey: KEY_A },
    });
  });

  it("changes forward answers with scope and retains all-Library reverse answers", async () => {
    const libraryScope = new LibraryScopeStub([
      personalLibrary(),
      groupLibrary(),
    ]);
    const { lookup } = await makeHarness({}, { notes: false, libraryScope });
    expect(
      (await lookup.read({ citekeys: ["roe2025"] })).resolve("roe2025")?.kind,
    ).toBe("unique");
    libraryScope.select([personalLibrary()]);
    const narrowed = await lookup.read({
      citekeys: ["roe2025"],
      indexedKeys: [KEY_B],
    });
    expect(narrowed.resolve("roe2025")).toEqual({ kind: "missing" });
    expect(narrowed.citekeyOf(KEY_B)).toBe("roe2025");
  });

  it("rebuilds when a Library outside the scope joins the database", async () => {
    const libraryScope = new LibraryScopeStub([personalLibrary()]);
    libraryScope.select([personalLibrary()]);
    const { lookup, citekeys } = await makeHarness(
      {},
      { notes: false, libraryScope },
    );
    citekeys.rows = [
      ...citekeys.rows,
      {
        itemID: 9,
        libraryID: GROUP_LIBRARY_ID,
        key: "GRP23456",
        indexedKey: "GRP23456g7",
        citekey: "grp2026",
      },
    ];
    expect(
      (await lookup.read({ indexedKeys: ["GRP23456g7"] })).citekeyOf(
        "GRP23456g7",
      ),
    ).toBeNull();

    // Library Scope settles its read after the database change, and a Library
    // outside the saved scope reaches the index through `libraries-changed`.
    libraryScope.holdLibraries([personalLibrary(), groupLibrary()]);
    await lookup.whenResolved();
    await yieldToMain();

    expect(
      (await lookup.read({ indexedKeys: ["GRP23456g7"] })).citekeyOf(
        "GRP23456g7",
      ),
    ).toBe("grp2026");
  });

  it("settles readiness and rejects a fresh read when the database is degraded", async () => {
    const db = new DatabaseStub();
    db.state = "degraded";
    const { lookup } = await makeHarness({}, { db, notes: false });
    await lookup.whenResolved();
    await expect(lookup.read({ citekeys: ["doe2024"] })).rejects.toThrow();
    expect(lookup.status).toBe("failed");
  });

  it("retains the selected answer after a refresh failure and rejects fresh reads", async () => {
    const { lookup, citekeys, db } = await makeHarness({}, { notes: false });
    using view = lookup.observe(() => {});
    view.set({ citekeys: ["doe2024"] });
    await expect.poll(() => view.current?.status).toBe("fresh");
    const held = view.current!.value;
    citekeys.error = new Error("torn read");
    db.changed();
    await expect.poll(() => view.current?.status).toBe("failed");
    expect(view.current!.value).toBe(held);
    await expect(lookup.read({ citekeys: ["doe2024"] })).rejects.toThrow();
    citekeys.error = null;
    await lookup.read({ citekeys: ["doe2024"] });
    await expect.poll(() => view.current?.status).toBe("fresh");
  });

  it("retries a failed first lookup on a new one-shot read", async () => {
    const db = new DatabaseStub({ readyImmediately: false });
    const { lookup, citekeys } = await makeHarness({}, { db, notes: false });
    citekeys.error = new Error("torn read");
    db.settle();
    await lookup.whenResolved();
    citekeys.error = null;
    expect(
      (await lookup.read({ citekeys: ["doe2024"] })).resolve("doe2024")?.kind,
    ).toBe("unique");
  });

  it("settles whenResolved when disposal interrupts the first rebuild", async () => {
    const db = new DatabaseStub({ readyImmediately: false });
    const { lookup } = await makeHarness({}, { db, notes: false });
    const waiting = lookup.whenResolved();

    await lookup[Symbol.asyncDispose]();

    await expect(waiting).resolves.toBeUndefined();
    await expect(lookup.whenResolved()).resolves.toBeUndefined();
  });

  it("classifies two Items of one Library under the same key as ambiguous", async () => {
    const { lookup } = await makeHarness(
      {},
      { notes: false, citekeys: [myLibraryRow, sameLibraryTwin] },
    );

    expect(
      (await lookup.read({ citekeys: ["doe2024"] })).resolve("doe2024"),
    ).toEqual({
      kind: "ambiguous",
      candidates: [
        {
          itemID: 1,
          libraryID: MY_LIBRARY_ID,
          key: KEY_A,
          indexedKey: KEY_A,
        },
        {
          itemID: 2,
          libraryID: MY_LIBRARY_ID,
          key: TWIN_KEY,
          indexedKey: TWIN_KEY,
        },
      ],
    });
  });

  it("classifies Items of two Libraries as ambiguous, in canonical Library order", async () => {
    const { lookup } = await makeHarness(
      {},
      {
        notes: false,
        citekeys: [groupTwin, myLibraryRow],
        libraryScope: bothLibraries(),
      },
    );

    const resolved = (await lookup.read({ citekeys: ["doe2024"] })).resolve(
      "doe2024",
    );
    expect(resolved?.kind).toBe("ambiguous");
    expect(
      resolved?.kind === "ambiguous"
        ? resolved.candidates.map((candidate) => candidate.indexedKey)
        : [],
    ).toEqual([KEY_A, GROUP_KEY]);
  });

  it("narrows an ambiguous key to unique when Library Scope drops a candidate", async () => {
    const libraryScope = bothLibraries();
    const { lookup } = await makeHarness(
      {},
      { notes: false, citekeys: [myLibraryRow, groupTwin], libraryScope },
    );
    expect(
      (await lookup.read({ citekeys: ["doe2024"] })).resolve("doe2024")?.kind,
    ).toBe("ambiguous");

    libraryScope.select([personalLibrary()]);
    await lookup.whenResolved();
    await yieldToMain();

    expect(
      (await lookup.read({ citekeys: ["doe2024"] })).resolve("doe2024"),
    ).toMatchObject({
      kind: "unique",
      item: { indexedKey: KEY_A },
    });
  });

  it("resolves an exact Indexed Key of a Library outside the scope", async () => {
    const libraryScope = bothLibraries();
    libraryScope.select([personalLibrary()]);
    const { lookup } = await makeHarness(
      {},
      { notes: false, citekeys: [myLibraryRow, groupTwin], libraryScope },
    );

    expect(
      (await lookup.read({ citekeys: ["doe2024"] })).resolve("doe2024"),
    ).toMatchObject({ kind: "unique" });
    expect(
      (await lookup.read({ indexedKeys: [GROUP_KEY] })).citekeyOf(GROUP_KEY),
    ).toBe("doe2024");
  });

  it("emits for a refresh that moves the candidates, not for an equal one", async () => {
    const { lookup, citekeys, db } = await makeHarness(
      {},
      { notes: false, citekeys: [myLibraryRow, sameLibraryTwin] },
    );
    let notified = 0;
    const original = await lookup.read({ citekeys: ["doe2024"] });
    lookup.on("changed", () => notified++);

    db.changed();
    await lookup.whenResolved();
    await yieldToMain();
    expect(notified).toBe(0);
    expect((await lookup.read({ citekeys: ["doe2024"] })).revision).toBe(
      original.revision,
    );

    citekeys.rows = [
      { ...sameLibraryTwin, itemID: 1 },
      { ...myLibraryRow, itemID: 2 },
    ];
    db.changed();
    await lookup.whenResolved();
    await yieldToMain();

    expect(notified).toBe(1);
    expect((await lookup.read({ citekeys: ["doe2024"] })).revision).not.toBe(
      original.revision,
    );
    expect(
      (await lookup.read({ citekeys: ["doe2024"] })).resolve("doe2024"),
    ).toMatchObject({
      kind: "ambiguous",
      candidates: [{ indexedKey: TWIN_KEY }, { indexedKey: KEY_A }],
    });
  });
});

it("replaces a scope observation while holding its earlier complete answer", async () => {
  await using h = await createCitationIndexHarness({});
  using view = h.lookup.observe(() => undefined);
  view.set({ citekeys: ["roe2025"], indexedKeys: [KEY_B] });
  await expect.poll(() => view.current?.status).toBe("fresh");
  const previous = view.current!.value;
  h.libraryScope.select([personalLibrary()]);
  expect(view.current?.value).toBe(previous);
  expect(view.current?.status).toBe("revalidating");
  await expect.poll(() => view.current?.status).toBe("fresh");
  expect(view.current!.value.resolve("roe2025")).toEqual({ kind: "missing" });
  expect(view.current!.value.citekeyOf(KEY_B)).toBe("roe2025");
});

it("pins an open view and collects its query after disposal and the finite retention time", async () => {
  let requested = 0;
  const source = fixture({
    wrap: (client) => ({
      ...client,
      CitationLookup: ((payload, options) => {
        if (payload.citekeys?.length) requested += 1;
        return client.CitationLookup(payload, options);
      }) as typeof client.CitationLookup,
    }),
  });
  await using lookup = source.reads;
  const view = lookup.observe(() => undefined);
  view.set(request);
  await expect.poll(() => view.current?.status).toBe("fresh");
  vi.useFakeTimers();
  try {
    await vi.advanceTimersByTimeAsync(
      Temporal.Duration.from({ minutes: 6 }).total("milliseconds"),
    );
    expect(view.current?.status).toBe("fresh");
    expect(requested).toBe(1);
    view[Symbol.dispose]();
    await vi.advanceTimersByTimeAsync(
      Temporal.Duration.from({ minutes: 6 }).total("milliseconds"),
    );
    const delivered = Promise.withResolvers<void>();
    using reopened = lookup.observe(() => {
      if (reopened.current?.status === "fresh") delivered.resolve();
    });
    reopened.set(request);
    expect(reopened.current).toBeNull();
    await delivered.promise;
    expect(requested).toBe(2);
  } finally {
    view[Symbol.dispose]();
    vi.useRealTimers();
  }
});

it("delivers a changed selection even when both answers have the same worker revision", async () => {
  await using h = await createCitationIndexHarness({});
  using view = h.lookup.observe(() => undefined);
  view.set({ citekeys: ["doe2024"] });
  await expect.poll(() => view.current?.status).toBe("fresh");
  const earlier = view.current!.value;
  view.set({ citekeys: ["roe2025"] });
  expect(view.current?.value).toBe(earlier);
  expect(view.current?.status).toBe("revalidating");
  await expect.poll(() => view.current?.status).toBe("fresh");
  expect(view.current!.value.revision).toBe(earlier.revision);
  expect(view.current!.value.resolve("roe2025").kind).toBe("unique");
  expect(() => view.current!.value.resolve("doe2024")).toThrow("doe2024");
});

it("captures the requested keys before waiting for the worker", async () => {
  const db = new DatabaseStub({ readyImmediately: false });
  await using h = await createCitationIndexHarness({}, { db });
  const citekeys = ["doe2024", "doe2024"];
  const indexedKeys = [KEY_A];
  const reading = h.lookup.read({ citekeys, indexedKeys });
  citekeys.splice(0, citekeys.length, "roe2025");
  indexedKeys.splice(0, indexedKeys.length, KEY_B);
  db.settle();
  const answer = await reading;
  expect(answer.resolve("doe2024").kind).toBe("unique");
  expect(answer.citekeyOf(KEY_A)).toBe("doe2024");
  expect(() => answer.resolve("roe2025")).toThrow("roe2025");
});
