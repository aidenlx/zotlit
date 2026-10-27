// @vitest-environment happy-dom
// The Library View tab runs the query its Library View Document derives: the
// document plugin data holds when the tab opens, and after a toolbar change,
// the same query when the tab opens again.
import { it as effectIt } from "@effect/vitest";
import {
  Menu,
  controlsOf,
  Modal,
  resetMockPlatform,
  setMockPlatform,
  TextComponent,
} from "@mock/obsidian";
import { Effect, Layer, Stream } from "effect";
import type {
  App,
  Plugin,
  TFile,
  WorkspaceItem,
  WorkspaceLeaf,
} from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Item } from "@zotlit/db";
import { makeItem } from "@zotlit/db/test-utils";
import { testItemSeed } from "@zotlit/item-query";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { testEvent, testEvents } from "@/lib/__fixtures__/event-stream";
import { keymapApp, pressTop } from "@/lib/__fixtures__/keymap";
import {
  createObsidianHost,
  PluginStub,
} from "@/lib/__fixtures__/obsidian-host";
import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { testRuntime } from "@/lib/__fixtures__/runtime";
import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { layerWorkspaceFrom } from "@/lib/obsidian-workspace";
import type { Workspace } from "@/lib/obsidian-workspace";
import type { SearchHit, SearchOptions } from "@/services/item-lookup/service";
import { ItemLookup } from "@/services/item-lookup/service";
import type {
  QueryViewOutcome,
  QueryViewRequest,
  QueryViewValue,
} from "@/services/item-query/query-view";
import { QueryService } from "@/services/item-query/service";
import { resolvedLibraryScopeAtom } from "@/services/library-scope/atoms";
import type {
  AvailableLibrary,
  LibraryScope,
  LibrarySelector,
  ResolvedLibraryScope,
} from "@/services/library-scope/scope";
import { selectorKey } from "@/services/library-scope/scope";
import { LibraryScope as LibraryScopeService } from "@/services/library-scope/service";
import { NoteFeature } from "@/services/note-feature/service";
import { notedItemKeysAtom } from "@/services/note-index/atoms";
import { NoteIndex } from "@/services/note-index/service";
import type { NoteIndexChange } from "@/services/note-index/service";
import { buildSettings } from "@/services/settings/__fixtures__";
import { PluginSettings } from "@/services/settings/service";
import { useLedgerAtom } from "@/services/use-ledger/atoms";
import { UseLedger } from "@/services/use-ledger/service";
import type { Ledger, UseKind } from "@/services/use-ledger/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";
import {
  zoteroRevisionAtom,
  zoteroStateAtom,
} from "@/services/zotero-reads/atoms";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type { ZoteroReadsEvent } from "@/services/zotero-reads/service";
import { stubbedReads } from "@/services/zotero-reads/test-utils";
import type { QueryHostDeps } from "@/views/query-view/__fixtures__/host";
import { noLiteratureNotes } from "@/views/query-view/__fixtures__/literature-notes";
import {
  fakeQuery,
  requested,
} from "@/views/query-view/__fixtures__/query-run";
import { waitFor } from "@/views/welcome/__fixtures__";
import { openWelcomeView } from "@/views/welcome/register";

import { holdNow, useAt, makeLibraryHost } from "./__fixtures__";
import { nodeKey } from "./document";
import type { LibraryNode } from "./document";
import { itemActions } from "./item-actions";
import { openLibraryView, registerLibraryView } from "./register";
import { LibraryView } from "./view";
import type { LibraryViewDeps } from "./view";

vi.mock("zustand", () => import("@/views/__fixtures__/zustand"));

const EMPTY = {
  kind: "result",
  result: {
    libraries: [{ type: "personal" }],
    query: { filter: null, fields: [], sort: [], limit: null },
    returnedCount: 0,
    matchedCount: 0,
    truncated: false,
    warnings: [],
    rows: [],
  },
} satisfies QueryViewOutcome;

let cleanup = new AsyncDisposableStack();
afterEach(async () => {
  await cleanup.disposeAsync();
  cleanup = new AsyncDisposableStack();
  document.body.replaceChildren();
});

class OpenView extends LibraryView {
  override readonly containerEl = document.createElement("div");
  open(): Promise<void> {
    return this.onOpen();
  }
  close(): Promise<void> {
    return this.onClose();
  }
}

/**
 * One Item of the fake Zotero database: its Library, the Collections it is
 * filed in, its Annotations and whether a PDF of it is on this device.
 */
interface SeedItem {
  readonly key: string;
  readonly libraryID: number;
  readonly collections: readonly string[];
  readonly annotations?: number;
  readonly pdf?: boolean;
  readonly title?: string;
  readonly tags?: readonly string[];
  /** The Indexed Keys of the Item's Attachments, each titled by its key. */
  readonly attachments?: readonly string[];
  /** The Item's bibliographic fields, as ZotLit Query gives them. */
  readonly fields?: Readonly<Record<string, QueryViewValue>>;
  /** Zotero's item type; a journal article where absent. */
  readonly itemType?: string;
  /**
   * The values only the Reading Card reads, such as its other fields, its
   * Attachments' titles and kinds, and its Child Notes.
   */
  readonly card?: Readonly<Record<string, QueryViewValue>>;
  /**
   * The Item's Annotations, in the order its cards show them; where absent,
   * {@link annotations} yellow highlights with no text.
   */
  readonly marks?: readonly SeedAnnotation[];
}

/** One Annotation of a {@link SeedItem}, as ZotLit Query gives its fields. */
interface SeedAnnotation {
  readonly key: string;
  readonly values: Readonly<Record<string, QueryViewValue>>;
}

/** The Annotations of `item`, the marks it names or its count of plain ones. */
function marksOf(item: SeedItem): readonly SeedAnnotation[] {
  return (
    item.marks ??
    Array.from({ length: item.annotations ?? 0 }, (_, index) => ({
      key: `${item.key.slice(0, 7)}${index}`,
      values: { type: "highlight", color: "#ffd400", text: "" },
    }))
  );
}

/**
 * What ZotLit Query gives the Reading Card's one read of `item` beside its
 * fields: its type, tags, the keys of its Annotations, and its own values.
 */
function cardValues(item: SeedItem): Record<string, QueryViewValue> {
  return {
    itemType: item.itemType ?? "journalArticle",
    tags: (item.tags ?? []).map((name) => ({ name, type: "manual" })),
    "annotations[].indexedKey": marksOf(item).map(({ key }) => key),
    "annotations[].color": marksOf(item).map(
      ({ values }) => values.color ?? null,
    ),
    ...item.card,
  };
}

/**
 * A Zotero database of three Libraries, the third outside the Library Scope.
 * "Thesis" holds A, B and C across its subtree, though its Collections hold
 * four memberships; the group has a "Thesis" of its own.
 */
const LIBRARIES: readonly AvailableLibrary[] = [
  { selector: { type: "personal" }, libraryID: 1, name: null },
  { selector: { type: "group", groupID: 4815 }, libraryID: 2, name: "Lab" },
  { selector: { type: "group", groupID: 77 }, libraryID: 3, name: "Archive" },
];
const PATHS = new Map<number, string[][]>([
  [
    1,
    [
      ["Reading list"],
      ["Thesis"],
      ["Thesis", "Chapter 1"],
      ["Thesis", "Chapter 2"],
    ],
  ],
  [2, [["Thesis"]]],
  [3, []],
]);
const SEED: readonly SeedItem[] = [
  {
    key: "AAAAAAAA",
    libraryID: 1,
    collections: ["Thesis/Chapter 1", "Thesis/Chapter 2"],
    annotations: 2,
    pdf: true,
    title: "Graph drawing for figures",
    tags: ["method", "figure"],
  },
  {
    key: "BBBBBBBB",
    libraryID: 1,
    collections: ["Thesis/Chapter 2"],
    pdf: true,
    title: "Notes on attention",
    tags: ["talk"],
    fields: {
      creators: [
        { role: "author", family: "Vaswani", given: "Ashish", literal: null },
        { role: "author", family: "Shazeer", given: "Noam", literal: null },
        { role: "editor", family: "Guyon", given: "Isabelle", literal: null },
      ],
      date: { year: 2017 },
      publicationTitle: "Advances in Neural Information Processing Systems",
      abstractNote: "Attention alone carries a sequence model.",
    },
  },
  {
    key: "CCCCCCCC",
    libraryID: 1,
    collections: ["Thesis"],
    annotations: 1,
    title: "Figures that work",
    tags: ["method"],
  },
  {
    key: "DDDDDDDD",
    libraryID: 1,
    collections: ["Reading list"],
    title: "Ten rules for better figures",
    tags: ["figure"],
  },
  { key: "EEEEEEEE", libraryID: 1, collections: [], tags: ["method"] },
  {
    key: "FFFFFFFF",
    libraryID: 2,
    collections: ["Thesis"],
    title: "Figures in the lab",
    tags: ["lab-meeting"],
  },
  { key: "GGGGGGGG", libraryID: 2, collections: [] },
  {
    key: "HHHHHHHH",
    libraryID: 3,
    collections: [],
    attachments: ["HPDFHPDF"],
  },
];

/** The Literature Notes of the vault: the Items D and A have one. */
const NOTED = ["AAAAAAAA", "DDDDDDDD"];

/**
 * The conditions of the Library View's filters on an Item, each as ZotLit
 * Query answers it for a {@link SeedItem}.
 */
const CONDITIONS: readonly [string, (item: SeedItem) => boolean][] = [
  ["lastRead == null", () => true],
  ["annotations.isEmpty()", (item) => (item.annotations ?? 0) === 0],
  ["annotations.length > 0", (item) => (item.annotations ?? 0) > 0],
  [
    'attachments.filter(value.fileType == "pdf" && value.exists).length > 0',
    (item) => item.pdf === true,
  ],
];
/**
 * Whether the engine's filter selects `item`. The engine's test seed holds
 * no Annotation or Attachment, so the facets' conditions are answered first,
 * as {@link CONDITIONS} says.
 */
function selects(filter: string | undefined, item: SeedItem): boolean {
  if (filter === undefined) return true;
  let answered = filter;
  for (const [condition, test] of CONDITIONS)
    answered = answered.replaceAll(condition, String(test(item)));
  const answer = testItemSeed(answered, {
    scan: {
      itemID: 1,
      key: item.key,
      itemType: "journalArticle",
      dateAdded: null,
      dateModified: null,
    },
    groupID: null,
    fields: { title: item.title ?? "" },
    custom: {},
    customFieldNames: [],
    creators: [],
    tags: (item.tags ?? []).map((name) => ({ name, type: 0 })),
    collections: item.collections.map((path) => path.split("/")),
  });
  if (answer.kind !== "result") throw new Error(JSON.stringify(answer));
  return answer.matched;
}

/**
 * ZotLit Query over {@link SEED}. A grouped request groups the Items its
 * filter selects as the engine does: an Item joins one group for each
 * Collection it is filed in, or for each of its tags, or the `null` group
 * for none, and each group returns at most `limit` rows. A list request
 * answers the Items its filter selects, in seed order.
 */
function answer(
  items: readonly SeedItem[],
  request: QueryViewRequest,
): QueryViewOutcome {
  const named =
    request.libraries?.mode === "selected" ? request.libraries.libraries : [];
  const ids = new Set(
    LIBRARIES.filter(({ selector }) =>
      named.some((s) => selectorKey(s) === selectorKey(selector)),
    ).map(({ libraryID }) => libraryID),
  );
  if (request.from === "annotations") {
    // The Annotations of the Item `this` names, in the Libraries read. The
    // Annotation Cards read their records from live lists the fake has none
    // of, so only a read with a limit, the preview's, gets rows.
    const of = items.find(
      ({ key, libraryID }) =>
        key === request.context?.item && ids.has(libraryID),
    );
    if (!of || request.limit == null) return EMPTY;
    const marks = marksOf(of);
    const rows = marks
      .slice(0, request.limit)
      .map(({ key, values }) => ({ indexedKey: key, values }));
    return requested(
      {
        kind: "result",
        result: {
          ...EMPTY.result,
          returnedCount: rows.length,
          matchedCount: marks.length,
          truncated: rows.length < marks.length,
          rows,
        },
      },
      request,
    );
  }
  if (request.from === "attachments") {
    // The Attachments of the Item the filter names, in the Libraries read.
    const parent = /^item\.indexedKey == "(\w+)"$/.exec(request.filter ?? "");
    const rows = items
      .filter(({ key, libraryID }) => key === parent?.[1] && ids.has(libraryID))
      .flatMap(({ attachments }) => attachments ?? [])
      .map((key) => ({ indexedKey: key, values: { title: key } }));
    return requested(
      {
        kind: "result",
        result: {
          ...EMPTY.result,
          returnedCount: rows.length,
          matchedCount: rows.length,
          rows,
        },
      },
      request,
    );
  }
  if (request.group === undefined) {
    const rows = items
      .filter(
        (item) => ids.has(item.libraryID) && selects(request.filter, item),
      )
      // The engine lists an Item's Collections as sorted joined paths.
      .map((item) => {
        const { key, collections, title, fields, attachments } = item;
        return {
          indexedKey: key,
          values: {
            collections: collections.toSorted(),
            ...(attachments && {
              "attachments[].indexedKey": [...attachments],
            }),
            ...(title !== undefined && { title }),
            ...(item.pdf && { "attachments[].fileType": ["pdf"] }),
            ...fields,
            // The Reading Card reads its one Item, and more of it.
            ...(request.limit === 1 && cardValues(item)),
          },
        };
      });
    // The engine returns at most `limit` rows, and counts every match.
    const returned =
      request.limit == null ? rows : rows.slice(0, request.limit);
    return requested(
      {
        kind: "result",
        result: {
          ...EMPTY.result,
          returnedCount: returned.length,
          matchedCount: rows.length,
          truncated: returned.length < rows.length,
          rows: returned,
        },
      },
      request,
    );
  }
  const valuesOf = GROUPS[request.group];
  if (!valuesOf) throw new Error(`The fake cannot group by ${request.group}`);
  const matched = items.filter(
    (item) => ids.has(item.libraryID) && selects(request.filter, item),
  );
  const groups = new Map<string | null, SeedItem[]>();
  for (const item of matched) {
    const values = valuesOf(item);
    for (const value of values.length > 0 ? values : [null])
      groups.set(value, [...(groups.get(value) ?? []), item]);
  }
  return {
    kind: "result",
    result: {
      libraries: EMPTY.result.libraries,
      query: EMPTY.result.query,
      truncated: false,
      warnings: [],
      returnedCount: matched.length,
      matchedCount: matched.length,
      totalCount: matched.length,
      groups: [...groups].map(([value, rows]) => ({
        value,
        count: rows.length,
        // Each row holds the fields the request names: the counts name none.
        rows: (request.limit == null ? rows : rows.slice(0, request.limit)).map(
          ({ key }) => ({ indexedKey: key, values: {} }),
        ),
      })),
    },
  };
}

/** The group values of an Item for each group path the fake answers. */
const GROUPS: Readonly<Record<string, (item: SeedItem) => readonly string[]>> =
  {
    "collections[]": (item) => item.collections,
    "tags[].name": (item) => item.tags ?? [],
  };

/** Plugin data with `stored` as its Library View Document, still loading. */
async function pluginData(
  stored?: unknown,
  actionItem?: Item,
  navigation?: Layer.Layer<NoteFeature | Workspace | ZoteroPref>,
) {
  setMockPlatform({ isMacOS: true });
  cleanup.defer(resetMockPlatform);
  const host = createObsidianHost({});
  const plugin = new PluginStub(host.app as unknown as App, {
    __VERSION__: 10,
    ...(stored !== undefined && { "library.document": stored }),
  });
  const settings = cleanup.use(
    await buildSettings({
      plugin,
      migrateLegacy: (raw) => raw,
      migrateV1: (raw) => raw,
      migrateV2: (raw) => raw,
      migrateV3: (raw) => raw,
      migrateV4: (raw) => raw,
      migrateV5: (raw) => raw,
      migrateV6: (raw) => raw,
      migrateV7: (raw) => raw,
      migrateV8: (raw) => raw,
      migrateV9: (raw) => raw,
    }),
  );
  const database = { items: SEED };
  const run = vi.fn((request: QueryViewRequest, _signal: AbortSignal) =>
    Promise.resolve(answer(database.items, request)),
  );
  const reads = testEvents<Record<string, () => void>>([
    "changed",
    "degraded",
    "refresh-failed",
    "db-file-missing",
    "refreshing",
  ]);
  /** What the database service says of Zotero's database. */
  const database_ = {
    state: "ready" as "ready" | "degraded",
    error: null as DbUnavailable | null,
    moved: false,
  };
  const sourceReads = cleanup.use(stubbedReads());
  vi.spyOn(sourceReads.reads, "CollectionPaths").mockImplementation(
    ({ libraryIDs }) =>
      Effect.succeed(libraryIDs.flatMap((id) => PATHS.get(id) ?? [])),
  );
  vi.spyOn(sourceReads.reads, "ConnectionReadout").mockImplementation(() =>
    Effect.succeed({ itemCount: 8 }),
  );
  vi.spyOn(sourceReads.reads, "ItemsByIndexedKeys").mockImplementation(() =>
    Effect.succeed(
      new Map(actionItem ? [[actionItem.indexedKey, actionItem]] : []),
    ),
  );
  const readApi = stubService<ZoteroReads["Service"]["reads"]>("ZoteroReads", {
    ItemsByIndexedKeys: sourceReads.reads.ItemsByIndexedKeys,
    CollectionPaths: sourceReads.reads.CollectionPaths,
    ConnectionReadout: sourceReads.reads.ConnectionReadout,
  });
  const readsDeps = stubService<QueryHostDeps["reads"]>("ZoteroReads", {
    ...reads.streams,
    get state() {
      return database_.state;
    },
    get error() {
      return database_.error;
    },
    get moved() {
      return database_.moved;
    },
    get dbFileMissing() {
      return false;
    },
    get activeReadMode() {
      return null;
    },
    acquireRead: async () => ({
      reads: readApi,
      [Symbol.asyncDispose]: async () => {},
    }),
  });
  const vaultOn = host.vault.on.bind(host.vault) as App["vault"]["on"];
  const setupActions = {
    openSettings: vi.fn(),
    pickFolder: vi.fn(),
    locateZotero: vi.fn(),
  };
  const notes = new Set(NOTED);
  const nativeNotes = testEvent<NoteIndexChange>();
  const notesChanged = createNanoEvents<{ changed: () => void }>();
  const literatureNotes = {
    ...noLiteratureNotes(),
    find: (itemKey: string) =>
      notes.has(itemKey) ? { path: `${itemKey}.md`, basename: itemKey } : null,
    on: (event: "changed" | "frontmatter-changed", listener: () => void) =>
      event === "changed" ? notesChanged.on("changed", listener) : () => {},
    itemKeys: () => [...notes],
    open: vi.fn(),
  };
  const items = {
    openNote: vi.fn(() => Promise.resolve()),
    openPdf: vi.fn(() => Promise.resolve()),
    insertCitation: vi.fn(() => Promise.resolve()),
    copyCitationKey: vi.fn(() => Promise.resolve()),
    showInZotero: vi.fn(),
  };
  const scopeEvents = testEvents<{
    changed: () => void;
    "libraries-changed": () => void;
  }>(["changed", "libraries-changed"]);
  // The saved scope also names a group the database no longer holds.
  const libraryScope = {
    ...scopeEvents.streams,
    effective: {
      mode: "selected",
      libraries: [
        ...LIBRARIES.slice(0, 2).map(({ selector }) => selector),
        GONE,
      ],
    } as LibraryScope,
    current: {
      mode: "selected",
      invalid: false,
      available: LIBRARIES.slice(0, 2),
      unavailable: [GONE],
    } as ResolvedLibraryScope,
    libraries: LIBRARIES,
  };
  /**
   * The worker search over the titles of {@link SEED}: each Item whose title
   * holds every word, the latest seed Item first, so the rank differs from
   * the list's own order.
   */
  const searches: { query: string; libraries: number[] }[] = [];
  const search = (
    query: string,
    opts?: SearchOptions,
    _signal?: AbortSignal,
  ) => {
    const libraries = (opts?.libraries ?? []).map((l) => l.libraryID);
    searches.push({ query, libraries });
    const words = query.toLowerCase().split(" ");
    return Promise.resolve(
      database.items
        .filter(
          ({ libraryID, title }) =>
            libraries.includes(libraryID) &&
            words.every((word) => title?.toLowerCase().includes(word)),
        )
        .toReversed()
        .map(
          ({ key, libraryID }) =>
            ({
              item: { key, indexedKey: key, libraryID },
              matches: [],
              library: null,
            }) as unknown as SearchHit,
        ),
    );
  };
  const app = stubService<App>("App", {
    ...keymapApp(),
    workspace: stubService<App["workspace"]>("Workspace", {}),
    vault: stubService<App["vault"]>("Vault", {
      getFolderByPath: host.vault.getFolderByPath.bind(host.vault),
      getAbstractFileByPath: host.vault.getAbstractFileByPath.bind(host.vault),
      on: vaultOn,
      offref: host.vault.offref.bind(host.vault),
    }),
  });
  const runtime = testRuntime();
  const current = Effect.sync(() => ({
    ...database_,
    dbFileMissing: false,
    activeReadMode: null,
  }));
  const nativeEvents = testEvent<ZoteroReadsEvent>();
  const nativeStates =
    testEvent<import("@/services/zotero-reads/service").ZoteroReadsState>();
  const events = nativeEvents.stream;
  const publish = (event: ZoteroReadsEvent) => {
    nativeStates.emit({
      ...database_,
      dbFileMissing: false,
      activeReadMode: null,
    });
    nativeEvents.emit(event);
  };
  const uses = { current: {} as Ledger };
  const usesChanged = testEvent<Ledger>();
  const searchRun = { search };
  const welcomeHost = cleanup.use(
    await makeLibraryHost({
      services: Layer.mergeAll(
        layerHost({ vault: app.vault }),
        Layer.succeed(PluginSettings, settings),
        Layer.mock(NoteIndex, {
          whenIndexed: Effect.void,
          getNotesByItemKey: () => Effect.succeed([]),
          getIndexedItemKeys: Effect.sync(() => [...notes]),
          changes: nativeNotes.stream,
        }),
        Layer.mock(UseLedger, {
          changes: Stream.concat(
            Stream.suspend(() => Stream.make(uses.current)),
            usesChanged.stream,
          ),
        }),
        Layer.mock(ItemLookup, {
          search: (words, options) =>
            Effect.promise((signal) =>
              searchRun.search(words, options, signal),
            ),
        }),
        Layer.mock(QueryService, {
          run: (request) => Effect.promise((signal) => run(request, signal)),
        }),
        Layer.mock(LibraryScopeService, {
          libraries: Effect.sync(() => libraryScope.libraries),
          changes: Stream.concat(
            Stream.suspend(() =>
              Stream.make({
                current: libraryScope.current,
                all: {
                  ...libraryScope.current,
                  available: libraryScope.libraries,
                },
                invalid: false,
                effective: libraryScope.effective,
                libraryRows: null,
              }),
            ),
            Stream.map(scopeEvents.streams.changed, () => ({
              current: libraryScope.current,
              all: {
                ...libraryScope.current,
                available: libraryScope.libraries,
              },
              invalid: false,
              effective: libraryScope.effective,
              libraryRows: null,
            })),
          ),
        }),
        Layer.mock(ZoteroReads, {
          current,
          reads: readApi,
          snapshot: Effect.succeed(readApi),
          changes: Stream.concat(
            Stream.fromEffect(current),
            nativeStates.stream,
          ),
          events,
        }),
        navigation ?? Layer.empty,
      ),
    }),
  );

  cleanup.defer(welcomeHost.registry.mount(notedItemKeysAtom));
  cleanup.defer(welcomeHost.registry.mount(zoteroRevisionAtom));
  cleanup.defer(welcomeHost.registry.mount(zoteroStateAtom));
  cleanup.defer(welcomeHost.registry.mount(resolvedLibraryScopeAtom));
  await waitFor(() =>
    expect(welcomeHost.registry.get(resolvedLibraryScopeAtom)).toBe(
      libraryScope.current,
    ),
  );

  await waitFor(() => expect(nativeEvents.subscribers).toBeGreaterThan(0));

  const deps = stubService<LibraryViewDeps & QueryHostDeps>("LibraryViewDeps", {
    runtime,
    registry: welcomeHost.registry,
    app,
    reads: readsDeps,
    libraryScope: stubService<QueryHostDeps["libraryScope"]>("LibraryScope", {
      changed: Stream.map(
        scopeEvents.streams.changed,
        () => libraryScope.current,
      ),
      "libraries-changed": scopeEvents.streams["libraries-changed"],
      get current() {
        return libraryScope.current;
      },
    }),
    query: fakeQuery(run),
    cardFocus: { hold: () => ({ [Symbol.dispose]: () => {} }) },
    items,
    welcome: { registry: welcomeHost.registry, setupActions },
    literatureNotes,
    opener: { open: () => Promise.resolve({ kind: "reader" as const }) },
  });
  /** Zotero's database changes to hold `items`, and says so. */
  const change = async (items: readonly SeedItem[]) => {
    const revision = welcomeHost.registry.get(zoteroRevisionAtom);
    database.items = items;
    reads.emit("changed");
    publish({ _tag: "changed" });
    await waitFor(() =>
      expect(welcomeHost.registry.get(zoteroRevisionAtom)).toBeGreaterThan(
        revision,
      ),
    );
  };
  /** The data folder ZotLit reads can no longer be found. */
  const lose = async () => {
    database_.state = "degraded";
    database_.error = new DbUnavailable({
      message: "No zotero.sqlite in the data folder",
    });
    reads.emit("degraded");
    publish({ _tag: "degraded", error: database_.error });
    await waitFor(() =>
      expect(welcomeHost.registry.get(zoteroStateAtom).state).toBe("degraded"),
    );
  };
  /** A refresh of the database fails; the earlier connection still reads. */
  const refreshFails = async () => {
    database_.error = new DbUnavailable({ message: "EACCES: zotero.sqlite" });
    database_.moved = false;
    reads.emit("refresh-failed");
    publish({
      _tag: "refresh-failed",
      error: database_.error,
      moved: database_.moved,
    });
    await waitFor(() =>
      expect(welcomeHost.registry.get(zoteroStateAtom).error).toBe(
        database_.error,
      ),
    );
  };
  /**
   * The researcher points ZotLit at a data folder that does not read; the
   * earlier database still serves.
   */
  const moveFails = async () => {
    database_.error = new DbUnavailable({ message: "ENOENT: zotero.sqlite" });
    database_.moved = true;
    reads.emit("refresh-failed");
    publish({
      _tag: "refresh-failed",
      error: database_.error,
      moved: database_.moved,
    });
    await waitFor(() =>
      expect(welcomeHost.registry.get(zoteroStateAtom).error).toBe(
        database_.error,
      ),
    );
  };
  /** The researcher pointed ZotLit at the data folder, and it reads again. */
  const locate = async () => {
    database_.state = "ready";
    database_.error = null;
    database_.moved = false;
    reads.emit("changed");
    publish({ _tag: "changed" });
    await waitFor(() =>
      expect(welcomeHost.registry.get(zoteroStateAtom).state).toBe("ready"),
    );
  };
  /** The vault gains a Literature Note for `itemKey`. */
  const addNote = async (itemKey: string) => {
    notes.add(itemKey);
    notesChanged.emit("changed");
    nativeNotes.emit({ type: "indexed" });
    await waitFor(() =>
      expect(welcomeHost.registry.get(notedItemKeysAtom).has(itemKey)).toBe(
        true,
      ),
    );
  };
  /**
   * The researcher saves a Library Scope of the Libraries `available` and
   * those `missing` from the database.
   */
  const rescope = async (
    available: readonly AvailableLibrary[],
    missing: readonly LibrarySelector[] = [],
  ) => {
    libraryScope.effective = {
      mode: "selected",
      libraries: [...available.map(({ selector }) => selector), ...missing],
    };
    libraryScope.current = {
      ...libraryScope.current,
      available,
      unavailable: missing,
    };
    scopeEvents.emit("changed");
    await waitFor(() =>
      expect(welcomeHost.registry.get(resolvedLibraryScopeAtom)).toBe(
        libraryScope.current,
      ),
    );
  };
  return {
    deps,
    host,
    run,
    settings,
    change,
    addNote,
    searches,
    rescope,
    items,
    lose,
    refreshFails,
    moveFails,
    locate,
    setupActions,
    uses,
    setUse: async (key: string, kind: UseKind, iso: string) => {
      uses.current = { ...uses.current, [key]: useAt(kind, iso) };
      usesChanged.emit(uses.current);
      await waitFor(() =>
        expect(welcomeHost.registry.get(useLedgerAtom)).toBe(uses.current),
      );
    },
    searchRun,
  };
}

/**
 * The requests of the list: without the count requests of the Library Tree,
 * which read no field, and without the Reading Card's reads of one Item.
 */
function listRuns(run: Awaited<ReturnType<typeof pluginData>>["run"]) {
  return run.mock.calls
    .map(([request]) => request)
    .filter((request) => (request.fields ?? []).length > 0)
    .filter((request) => !cardRun(request));
}

/** Whether `request` is the Reading Card's: its Item, or its Annotations. */
function cardRun(request: QueryViewRequest): boolean {
  return (
    request.from === "annotations" ||
    (request.fields ?? []).includes("abstractNote")
  );
}

/** The tree row of `node`. */
function row(view: LibraryView, node: LibraryNode): HTMLElement {
  const found = [
    ...view.contentEl.querySelectorAll<HTMLElement>("[data-library-node]"),
  ].find((el) => el.dataset.libraryNode === nodeKey(node));
  if (!found) throw new Error(`No tree row for ${nodeKey(node)}`);
  return found;
}

/** Press `el` as the researcher does, and wait for the list and the tree. */
async function press(view: LibraryView, el: HTMLElement) {
  await act(async () => {
    el.click();
    await view.searched;
    await view.query.settled;
    await view.tree.settled;
  });
}

const PERSONAL = { type: "personal" } as const;
/** A group the saved Library Scope names but the database no longer holds. */
const GONE = { type: "group", groupID: 9999 } as const;
const LAB = { type: "group", groupID: 4815 } as const;
const ARCHIVE = { type: "group", groupID: 77 } as const;
const THESIS: LibraryNode = {
  kind: "collection",
  library: PERSONAL,
  path: ["Thesis"],
};

/**
 * The heading over the list: the path above the name, the name, and the
 * counts under it, `|` between them; `undefined` with no heading.
 */
function header(view: LibraryView) {
  const el = view.contentEl.querySelector("[data-library-heading]");
  if (!el) return undefined;
  return [
    "[data-library-heading-path]",
    "[data-library-header]",
    "[data-library-header-count]",
  ]
    .map((part) => el.querySelector(part)?.textContent ?? "")
    .filter((text) => text !== "")
    .join(" | ");
}

/** The filter chips under the heading, by kind and name. */
function filterChips(view: LibraryView) {
  return [
    ...view.contentEl.querySelectorAll<HTMLElement>("[data-library-filter]"),
  ].map((chip) => chip.dataset.libraryFilter);
}

/**
 * The name a screen reader gives `el`, from the elements it is labelled by;
 * empty for none. The view names nothing by `aria-label`, which Obsidian
 * shows as a tooltip.
 */
function accessibleName(el: Element): string {
  return (el.getAttribute("aria-labelledby") ?? "")
    .split(" ")
    .filter((id) => id !== "")
    .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "")
    .join(" ");
}

/** The tree on screen: each node's label, depth and count, in order. */
function tree(view: LibraryView) {
  return [
    ...view.contentEl.querySelectorAll<HTMLElement>("[data-library-node]"),
  ].map(
    (node) =>
      `${"  ".repeat(Number(node.getAttribute("aria-level")) - 1)}${
        node.querySelector("[data-library-label]")!.textContent
      }${[...node.querySelectorAll("[data-library-count]")].map((count) => ` ${count.textContent}`).join("")}`,
  );
}

/** A Library View tab, opened and settled on its first run. */
async function openTab(deps: LibraryViewDeps) {
  const root = stubService<WorkspaceItem>("WorkspaceItem", {});
  const leaf = stubService<WorkspaceLeaf & { app: App }>("WorkspaceLeaf", {
    app: deps.app,
    getRoot: () => root,
    updateHeader: () => {},
  });
  const view = new OpenView(leaf, deps);
  document.body.append(view.contentEl);
  await act(async () => {
    await view.open();
    await view.query.settled;
    await view.tree.settled;
  });
  cleanup.defer(() => view.close());
  return view;
}

const RECENT: LibraryNode = { kind: "recent" };
const MY_LIBRARY: LibraryNode = { kind: "library", library: PERSONAL };

it("opens on Recent, every Library in the Library Scope newest activity first, where plugin data holds no document", async () => {
  const { deps, run } = await pluginData();
  const view = await openTab(deps);
  expect(listRuns(run)).toHaveLength(1);
  const [request] = listRuns(run) as [QueryViewRequest];
  expect(request).toMatchObject({
    from: "items",
    libraries: { mode: "selected", libraries: [PERSONAL, LAB] },
    sort: [{ field: "lastActivity", direction: "desc" }],
  });
  expect(row(view, RECENT).getAttribute("aria-selected")).toBe("true");
  // Recent names itself, with the papers it lists and no unread count.
  expect(header(view)).toBe("Recent | 7 papers");
  // A large library shows its newest rows.
  expect(request.limit).toBe(1000);
  expect(request).not.toHaveProperty("filter");
  expect(request).not.toHaveProperty("context");
});

// Failures: a wrong message for the signal Item Query chose, a stale Use
// worded as current, and leakage into other Library nodes or their query
// projections.
it("shows the newest Zotero activity only on Recent and stops requesting it on other nodes", async () => {
  const { deps, change, run } = await pluginData();
  await change([
    {
      ...SEED[0]!,
      fields: {
        lastActivity: "2025-02-01T00:00:00Z",
        lastActivitySource: "read",
      },
    },
  ]);
  const view = await openTab(deps);
  expect(view.contentEl.textContent).toContain("in Zotero");
  expect(listRuns(run).at(-1)?.fields).toContain("lastActivitySource");
  await press(view, row(view, MY_LIBRARY));
  expect(view.contentEl.textContent).not.toContain("in Zotero");
  expect(listRuns(run).at(-1)?.fields).not.toContain("lastActivitySource");
});

it.each([
  [
    { lastActivity: "2025-01-01T00:00:00Z", lastActivitySource: "added" },
    undefined,
    "added to Zotero 1 day ago",
  ],
  [
    { lastActivity: "2025-01-01T00:00:00Z", lastActivitySource: "note" },
    undefined,
    "notes edited in Zotero 1 day ago",
  ],
  [
    { lastActivity: "2025-01-01T00:00:00Z", lastActivitySource: "annotation" },
    undefined,
    "notes edited in Zotero 1 day ago",
  ],
  [
    { lastActivity: "2025-01-01T12:00:00Z", lastActivitySource: "read" },
    "opened",
    "read 12 hours ago in Zotero",
  ],
  [
    { lastActivity: "2025-01-01T00:00:00Z", lastActivitySource: "use" },
    "read",
    "read 1 day ago in Obsidian",
  ],
  [
    { lastActivity: "2025-01-01T00:00:00Z", lastActivitySource: "use" },
    "opened",
    "opened 1 day ago in Obsidian",
  ],
  [
    { lastActivity: "2025-01-01T00:00:00Z", lastActivitySource: "use" },
    "cited",
    "cited 1 day ago in Obsidian",
  ],
] as const)(
  "ends a Recent row with its winning activity %#",
  async (fields, kind, expected) => {
    const paper = await recentRow(fields, kind);
    const metadata = paper.querySelector("[data-query-papers-title]")!
      .parentElement!.children[1]!;
    expect(metadata.textContent.endsWith(expected)).toBe(true);
  },
);

it.each([
  // The ledger moved on since the query ran: no reason until the rerun.
  [
    { lastActivity: "2024-12-01T00:00:00Z", lastActivitySource: "use" },
    "cited",
  ],
  [{ lastActivity: "invalid", lastActivitySource: "added" }, undefined],
] as const)("gives a Recent row no reason %#", async (fields, kind) => {
  const paper = await recentRow(fields, kind);
  expect(paper.textContent).not.toMatch(/ ago/);
});

/** The Recent row of an Item with `fields`, its ledger holding a `kind` Use. */
async function recentRow(
  fields: Readonly<Record<string, string>>,
  kind: UseKind | undefined,
): Promise<Element> {
  const now = holdNow("2025-01-02T00:00:00Z");
  cleanup.defer(() => now.mockRestore());
  const { deps, change, uses } = await pluginData();
  const item = SEED[0]!;
  await change([{ ...item, fields }]);
  uses.current = kind
    ? { [item.key]: useAt(kind, "2025-01-01T00:00:00Z") }
    : {};
  const view = await openTab(deps);
  return view.contentEl.querySelector(`[data-query-papers-row="${item.key}"]`)!;
}

it("updates a Recent reason on a Use change without another list read", async () => {
  const now = holdNow("2025-01-02T00:00:00Z");
  cleanup.defer(() => now.mockRestore());
  const { deps, change, uses, setUse, run } = await pluginData();
  const item = SEED[0]!;
  const iso = "2025-01-01T00:00:00Z";
  await change([
    { ...item, fields: { lastActivity: iso, lastActivitySource: "use" } },
  ]);
  uses.current = { [item.key]: useAt("opened", iso) };
  const view = await openTab(deps);
  const before = listRuns(run).length;
  expect(itemRow(view, item.key).textContent).toContain(
    m.library_recent_opened({ time: "1 day ago" }),
  );
  await act(() => setUse(item.key, "cited", iso));
  expect(itemRow(view, item.key).textContent).toContain(
    m.library_recent_cited({ time: "1 day ago" }),
  );
  expect(listRuns(run)).toHaveLength(before);
});

it("opens on the document plugin data holds, once it has loaded", async () => {
  const { deps, run } = await pluginData({
    node: {
      kind: "collection",
      library: { type: "group", groupID: 4815 },
      path: ["Thesis"],
    },
    facets: [],
    search: "",
    sort: [{ property: "title", direction: "ASC" }],
  });
  await openTab(deps);
  expect(listRuns(run)).toHaveLength(1);
  expect(listRuns(run)[0]).toMatchObject({
    libraries: {
      mode: "selected",
      libraries: [{ type: "group", groupID: 4815 }],
    },
    filter: 'collections.within("Thesis")',
    sort: [{ field: "title", direction: "asc" }],
  });
});

it("opens on every field of the document plugin data holds that it can read, where one facet is unknown, and on Papers where an earlier build stored the Table", async () => {
  const { deps, run } = await pluginData({
    node: { kind: "library", library: PERSONAL },
    facets: ["annotated", "starred"],
    search: "",
    sort: [{ property: "title", direction: "ASC" }],
    layout: "table",
    order: ["title"],
  });
  const view = await openTab(deps);
  expect(listRuns(run).at(-1)).toMatchObject({
    libraries: { mode: "selected", libraries: [PERSONAL] },
    filter: "annotations.length > 0",
    sort: [{ field: "title", direction: "asc" }],
  });
  expect(view.query.state.getState().view?.type).toBe("papers");
  expect(view.query.state.getState().view?.order).toBeUndefined();
});

it("opens again on a sort the toolbar changed, and runs the query the toolbar ran", async () => {
  const { deps, run } = await pluginData();
  const first = await openTab(deps);
  await act(async () => {
    first.query.document.editView({
      sort: [{ property: "title", direction: "ASC" }],
    });
    await first.query.flush();
    await first.query.settled;
  });
  const changed = listRuns(run).at(-1)!;
  expect(changed.sort).toEqual([{ field: "title", direction: "asc" }]);
  await act(() => first.close());

  run.mockClear();
  await openTab(deps);
  expect(listRuns(run)).toEqual([changed]);
});

it("lists the libraries in the Library Scope with their Collections, each counting the Items of its subtree once", async () => {
  const { deps } = await pluginData();
  const view = await openTab(deps);
  // A Collection's count holds the Items of its subcollections, each once:
  // "Thesis" holds A, B and C, though its Collections hold four memberships.
  expect(tree(view)).toEqual([
    "Recent",
    "My Library 5",
    "  Reading list 1",
    "  Thesis 3",
    "Lab 2",
    "  Thesis 1",
  ]);
});

it("opens a Collection to its subcollections, each counted alone", async () => {
  const { deps } = await pluginData();
  const view = await openTab(deps);
  await press(view, row(view, THESIS).querySelector("[data-library-expand]")!);
  expect(tree(view)).toEqual([
    "Recent",
    "My Library 5",
    "  Reading list 1",
    "  Thesis 3",
    "    Chapter 1 1",
    "    Chapter 2 2",
    "Lab 2",
    "  Thesis 1",
  ]);
});

it("keeps the nodes the researcher opens and closes in the document, and opens on them again", async () => {
  const { deps, settings } = await pluginData();
  const first = await openTab(deps);
  await press(
    first,
    row(first, THESIS).querySelector("[data-library-expand]")!,
  );
  await press(
    first,
    row(first, { kind: "library", library: LAB }).querySelector(
      "[data-library-expand]",
    )!,
  );
  await act(() => settings.bridge.runPromise(settings.flush));
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"]?.expanded,
  ).toEqual([
    JSON.stringify(["personal", "Thesis"]),
    `closed:${JSON.stringify(["group:4815"])}`,
  ]);
  await act(() => first.close());
  const view = await openTab(deps);
  expect(tree(view)).toEqual([
    "Recent",
    "My Library 5",
    "  Reading list 1",
    "  Thesis 3",
    "    Chapter 1 1",
    "    Chapter 2 2",
    "Lab 2",
  ]);
  await press(view, row(view, THESIS).querySelector("[data-library-expand]")!);
  await act(() => settings.bridge.runPromise(settings.flush));
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"]?.expanded,
  ).toEqual([`closed:${JSON.stringify(["group:4815"])}`]);
});

it("drops the open nodes Zotero no longer has from the document, and keeps the rest", async () => {
  const { deps, settings } = await pluginData({
    node: { kind: "recent" },
    expanded: [
      JSON.stringify(["personal", "Thesis"]),
      JSON.stringify(["personal", "Old name"]),
      // A Library outside the Library Scope keeps its nodes for when it shows.
      JSON.stringify(["group:77", "Drafts"]),
    ],
  });
  const view = await openTab(deps);
  expect(tree(view)).toContain("    Chapter 1 1");
  await act(() => settings.bridge.runPromise(settings.flush));
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"]?.expanded,
  ).toEqual([
    JSON.stringify(["personal", "Thesis"]),
    JSON.stringify(["group:77", "Drafts"]),
  ]);
});

it("lists a Collection with its subcollections' Items, names it in the header, and keeps it", async () => {
  const { deps, run, settings } = await pluginData();
  const view = await openTab(deps);
  await press(view, row(view, THESIS));
  expect(listRuns(run).at(-1)).toMatchObject({
    libraries: { mode: "selected", libraries: [PERSONAL] },
    filter: 'collections.within("Thesis")',
  });
  expect(row(view, THESIS).getAttribute("aria-selected")).toBe("true");
  expect(header(view)).toBe("My Library› | Thesis | 3 papers · 1 unread");
  await settings.bridge.runPromise(settings.flush);
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"]?.node,
  ).toEqual(THESIS);
});

it("lists a group library on its own, with no filter", async () => {
  const { deps, run } = await pluginData();
  const view = await openTab(deps);
  await press(view, row(view, THESIS));
  await press(view, row(view, { kind: "library", library: LAB }));
  const last = listRuns(run).at(-1)!;
  expect(last.libraries).toEqual({ mode: "selected", libraries: [LAB] });
  expect(last).not.toHaveProperty("filter");
  expect(header(view)).toBe("Lab | 2 papers · 2 unread");
});

it("shows the libraries outside the Library Scope on request, and lists one", async () => {
  const { deps, run } = await pluginData();
  const view = await openTab(deps);
  const all = () =>
    view.contentEl.querySelector<HTMLElement>("[data-library-all]")!;
  expect(all().textContent).toBe("Show all libraries");
  // It ends the Libraries it widens, before the facets.
  expect(all().previousElementSibling?.getAttribute("role")).toBe("tree");
  await press(view, all());
  expect(tree(view)).toEqual([
    "Recent",
    "My Library 5",
    "  Reading list 1",
    "  Thesis 3",
    "Lab 2",
    "  Thesis 1",
    "Archive 1",
  ]);
  await press(view, row(view, { kind: "library", library: ARCHIVE }));
  expect(listRuns(run).at(-1)!.libraries).toEqual({
    mode: "selected",
    libraries: [ARCHIVE],
  });
  // An Item of it expands to its Attachments, read in its Library.
  await act(() =>
    view.contentEl
      .querySelector<HTMLElement>('[data-query-expand="item:HHHHHHHH"]')!
      .click(),
  );
  await vi.waitFor(() =>
    expect(
      view.contentEl.querySelector('[data-query-papers-child="attachment"]')
        ?.textContent,
    ).toBe("HPDFHPDF"),
  );
  expect(all().textContent).toBe("Hide other libraries");
  // The selected library stays in the tree while it shows the scope alone.
  await press(view, all());
  expect(tree(view).at(-1)).toBe("Archive 1");
});

it("lets go of Show all libraries once the Library Scope holds every Library, and offers it again when the scope narrows", async () => {
  const { deps, rescope } = await pluginData();
  const view = await openTab(deps);
  const all = () =>
    view.contentEl.querySelector<HTMLElement>("[data-library-all]");
  await press(view, all()!);
  expect(all()?.dataset.libraryAll).toBe("on");
  await act(async () => {
    await rescope(LIBRARIES);
    await view.tree.settled;
  });
  // No Library lies outside the scope, so there is nothing to show or hide.
  expect(all()).toBeNull();
  await act(async () => {
    await rescope(LIBRARIES.slice(0, 1));
    await view.tree.settled;
  });
  expect(all()?.dataset.libraryAll).toBe("off");
  expect(tree(view)).not.toContain("Archive 1");
});

it("opens again on the node the tree selected", async () => {
  const { deps, run } = await pluginData();
  const first = await openTab(deps);
  await press(first, row(first, { kind: "library", library: LAB }));
  const selected = listRuns(run).at(-1)!;
  await act(() => first.close());
  run.mockClear();
  const view = await openTab(deps);
  expect(listRuns(run)).toEqual([selected]);
  expect(header(view)).toBe("Lab | 2 papers · 2 unread");
});

it("counts again after a database change", async () => {
  const { deps, change } = await pluginData();
  const view = await openTab(deps);
  await act(async () => {
    await change([
      ...SEED,
      { key: "JJJJJJJJ", libraryID: 1, collections: ["Thesis/Chapter 1"] },
    ]);
    await view.tree.settled;
  });
  expect(tree(view).slice(0, 4)).toEqual([
    "Recent",
    "My Library 6",
    "  Reading list 1",
    "  Thesis 4",
  ]);
});

it("moves the selection up to its library where Zotero no longer has the Collection", async () => {
  const { deps, run, settings } = await pluginData({
    node: { kind: "collection", library: PERSONAL, path: ["Old name"] },
    facets: [],
    search: "",
    sort: [{ property: "dateModified", direction: "DESC" }],
  });
  const view = await openTab(deps);
  await act(() => view.query.settled);
  expect(listRuns(run).at(-1)).not.toHaveProperty("filter");
  expect(header(view)).toBe("My Library | 5 papers · 2 unread");
  await settings.bridge.runPromise(settings.flush);
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"]?.node,
  ).toEqual({
    kind: "library",
    library: PERSONAL,
  });
});

it("names the tree and the facets for a screen reader, with no tooltip over them", async () => {
  const { deps } = await pluginData();
  const view = await openTab(deps);
  const pane = view.contentEl.querySelector("[data-library-tree]")!;
  // Obsidian shows every `aria-label` as a tooltip on hover.
  expect(pane.querySelectorAll("[aria-label]")).toHaveLength(0);
  expect(accessibleName(pane.querySelector("nav")!)).toBe("");
  expect(accessibleName(pane.querySelector("[role=tree]")!)).toBe("Libraries");
  expect(accessibleName(pane.querySelector("[role=group]")!)).toBe(
    m.library_view_facets_label(),
  );
});

it("puts the open tree away on Escape from inside it, on a Scope above the list's", async () => {
  const { deps } = await pluginData();
  const app = keymapApp();
  Object.assign(deps.app, { keymap: app.keymap });
  const view = await openTab(deps);
  const pane = view.contentEl.querySelector<HTMLElement>(
    "[data-library-tree]",
  )!;
  const shell = pane.parentElement!;
  const escape = async (target: Element, init: KeyboardEventInit = {}) => {
    let event: KeyboardEvent | undefined;
    await act(() => {
      event = pressTop(app, { key: "Escape", ...init }, target);
    });
    return event!;
  };

  // A closed tree, on a wide pane, leaves Escape to the list.
  row(view, THESIS).dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  expect(app.scopes).toEqual([]);

  await press(
    view,
    view.contentEl.querySelector<HTMLElement>("[data-library-tree-toggle]")!,
  );
  expect(shell.hasAttribute("data-tree-open")).toBe(true);
  row(view, THESIS).dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  expect(app.scopes).toHaveLength(1);

  // A tag filter with text in it clears its own text first.
  await act(() => view.tree.setTagFilter("method"));
  const filter = pane.querySelector<HTMLInputElement>(
    "[data-library-tags-filter]",
  )!;
  expect((await escape(filter)).defaultPrevented).toBe(true);
  expect(view.tree.state.tagFilter).toBe("");
  expect(shell.hasAttribute("data-tree-open")).toBe(true);

  // An Escape that drops a composition stays the input method's.
  await escape(row(view, THESIS), { isComposing: true });
  expect(shell.hasAttribute("data-tree-open")).toBe(true);

  // From a row, the tree goes and the list's own Escape never runs.
  expect((await escape(row(view, THESIS))).defaultPrevented).toBe(true);
  expect(shell.hasAttribute("data-tree-open")).toBe(false);
  expect(app.scopes).toEqual([]);
});

it("says where Zotero's data folder cannot be found, offers to locate it, and lists the papers once it is set", async () => {
  const { deps, lose, locate, setupActions } = await pluginData();
  await lose();
  const view = await openTab(deps);
  const shell = view.contentEl.querySelector(
    "[data-library-tree]",
  )!.parentElement!;
  const notFound = (part: "tree" | "list") =>
    view.contentEl.querySelector<HTMLElement>(
      `[data-library-not-found="${part}"]`,
    )!;
  // The not-found parts show in place of the tree and the list.
  expect(shell.hasAttribute("data-zotero-missing")).toBe(true);
  // The tree part is one line; the list says the rest, once.
  expect(notFound("tree").textContent).toBe("Zotero not found");
  expect(notFound("tree").querySelectorAll("button")).toHaveLength(0);
  // Both name it in the same words.
  expect(notFound("list").querySelector('[role="heading"]')?.textContent).toBe(
    "Zotero not found",
  );
  // The list's card stands centred in the list, as an empty list does; the
  // tree's line stays at the top of the tree.
  expect(notFound("list").closest("[data-pane-state]")).not.toBeNull();
  expect(notFound("tree").closest("[data-pane-state]")).toBeNull();
  // The toggle still opens the tree and its not-found part.
  const toggle = view.contentEl.querySelector<HTMLElement>(
    "[data-library-tree-toggle]",
  )!;
  await press(view, toggle);
  expect(shell.hasAttribute("data-tree-open")).toBe(true);
  expect(notFound("tree").textContent).toBe("Zotero not found");
  const button = (part: "tree" | "list", text: string) =>
    [...notFound(part).querySelectorAll("button")].find(
      (el) => el.textContent === text,
    )!;
  await press(view, button("list", "Locate data folder"));
  await press(view, button("list", "Open settings"));
  expect(setupActions.locateZotero).toHaveBeenCalledOnce();
  expect(setupActions.openSettings).toHaveBeenCalledOnce();
  // No setup-time hint names ZotLit Companion or Better BibTeX.
  expect(view.contentEl.textContent).not.toMatch(/Companion|Better BibTeX/);

  await act(async () => {
    await locate();
    await view.tree.settled;
    await view.query.settled;
  });
  expect(shell.hasAttribute("data-zotero-missing")).toBe(false);
  expect(tree(view)).toContain("My Library 5");
});

it("keeps the last rows with a note where a refresh of the database fails, and drops the note once it reads again", async () => {
  const { deps, refreshFails, locate } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  const rows = shown(view);
  const shell = view.contentEl.querySelector(
    "[data-library-tree]",
  )!.parentElement!;
  const note = () =>
    view.contentEl.querySelector<HTMLElement>("[data-library-refresh-failed]");
  await act(async () => {
    await refreshFails();
    await view.query.settled;
  });
  expect(shell.hasAttribute("data-zotero-missing")).toBe(false);
  expect(shown(view)).toEqual(rows);
  expect(note()?.textContent).toContain("Couldn't refresh from Zotero");
  await act(async () => {
    await locate();
    await view.query.settled;
  });
  expect(note()).toBeNull();
});

it("says Zotero is not found where the data folder changes to one that does not read, though the earlier database still serves", async () => {
  const { deps, moveFails } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  const shell = view.contentEl.querySelector(
    "[data-library-tree]",
  )!.parentElement!;
  await act(async () => {
    await moveFails();
    await view.query.settled;
  });
  expect(shell.hasAttribute("data-zotero-missing")).toBe(true);
  expect(
    view.contentEl.querySelector("[data-library-refresh-failed]"),
  ).toBeNull();
});

it("reads the new Library Scope on Recent once the researcher changes it", async () => {
  const { deps, run, rescope } = await pluginData();
  const view = await openTab(deps);
  await act(async () => {
    await rescope([LIBRARIES[1]!]);
    await view.query.settled;
  });
  expect(listRuns(run).at(-1)!.libraries).toEqual({
    mode: "selected",
    libraries: [LAB],
  });
});

it("reads the saved Library Scope on Recent where the database holds none of its Libraries, so the view names the one missing", async () => {
  const { deps, run, rescope } = await pluginData();
  const view = await openTab(deps);
  await act(async () => {
    await rescope([], [GONE]);
    await view.query.settled;
  });
  expect(listRuns(run).at(-1)!.libraries).toEqual({
    mode: "selected",
    libraries: [GONE],
  });
});

it("keeps Recent selected through a sort change, and selecting it again sorts newest activity first", async () => {
  const { deps, run, settings } = await pluginData();
  const view = await openTab(deps);
  await act(async () => {
    view.query.document.editView({
      sort: [{ property: "title", direction: "ASC" }],
    });
    await view.query.flush();
    await view.query.settled;
  });
  expect(row(view, RECENT).getAttribute("aria-selected")).toBe("true");
  expect(listRuns(run).at(-1)!.sort).toEqual([
    { field: "title", direction: "asc" },
  ]);
  // A Library keeps the sort the researcher chose.
  await press(view, row(view, { kind: "library", library: LAB }));
  expect(listRuns(run).at(-1)!.sort).toEqual([
    { field: "title", direction: "asc" },
  ]);
  await press(view, row(view, RECENT));
  expect(listRuns(run).at(-1)).toMatchObject({
    libraries: { mode: "selected", libraries: [PERSONAL, LAB] },
    sort: [{ field: "lastActivity", direction: "desc" }],
  });
  expect(header(view)).toBe("Recent | 7 papers");
  await settings.bridge.runPromise(settings.flush);
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"],
  ).toMatchObject({
    node: RECENT,
    sort: [{ property: "lastActivity", direction: "DESC" }],
  });
});

it("marks the Sort button as set only for a sort other than the one the selected node writes", async () => {
  const { deps, run, settings } = await pluginData();
  const view = await openTab(deps);
  /** The Sort button: whether it shows a sort as set, and its text. */
  const sort = () => {
    const button = view.contentEl.querySelector<HTMLElement>(
      '[data-query-toolbar="sort"]',
    )!;
    return {
      set: button.hasAttribute("data-active"),
      text: button.textContent,
    };
  };
  // Recent writes newest activity first itself.
  expect(sort()).toEqual({ set: false, text: "Sort" });
  await act(async () => {
    view.query.document.editView({
      sort: [{ property: "title", direction: "ASC" }],
    });
    await view.query.flush();
    await view.query.settled;
  });
  expect(sort()).toEqual({ set: true, text: "Sort1" });
  await press(view, row(view, RECENT));
  expect(sort()).toEqual({ set: false, text: "Sort" });
  // Leaving Recent clears its own sort: the Library lists unsorted.
  await press(view, row(view, { kind: "library", library: LAB }));
  expect(sort()).toEqual({ set: false, text: "Sort" });
  expect(listRuns(run).at(-1)).not.toHaveProperty("sort");
  await settings.bridge.runPromise(settings.flush);
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"],
  ).toMatchObject({
    node: { kind: "library", library: LAB },
    sort: [],
  });
});

it("keeps a sort the researcher changed on Recent once they leave it", async () => {
  const { deps, run, settings } = await pluginData();
  const view = await openTab(deps);
  await act(async () => {
    view.query.document.editView({
      sort: [{ property: "title", direction: "ASC" }],
    });
    await view.query.flush();
    await view.query.settled;
  });
  await press(view, row(view, { kind: "library", library: LAB }));
  expect(
    view.contentEl
      .querySelector('[data-query-toolbar="sort"]')!
      .hasAttribute("data-active"),
  ).toBe(true);
  expect(listRuns(run).at(-1)!.sort).toEqual([
    { field: "title", direction: "asc" },
  ]);
  await settings.bridge.runPromise(settings.flush);
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"],
  ).toMatchObject({
    node: { kind: "library", library: LAB },
    sort: [{ property: "title", direction: "ASC" }],
  });
});

it("marks the Sort button again on a switch between Recent and My Library that leaves the query text as it was", async () => {
  // On My Library, newest activity first is the researcher's sort.
  const { deps, rescope } = await pluginData({
    ...ON_MY_LIBRARY,
    sort: [{ property: "lastActivity", direction: "DESC" }],
  });
  const view = await openTab(deps);
  await act(async () => {
    await rescope([LIBRARIES[0]!]);
    await view.query.settled;
  });
  const set = () =>
    view.contentEl
      .querySelector('[data-query-toolbar="sort"]')!
      .hasAttribute("data-active");
  const text = view.query.document.text;
  expect(set()).toBe(true);
  // Recent writes that same sort itself.
  await press(view, row(view, RECENT));
  expect(view.query.document.text).toBe(text);
  expect(set()).toBe(false);
});

/** Two sorts from the toolbar, the second before the first is saved. */
function sortTwice(view: LibraryView) {
  view.query.document.editView({
    sort: [{ property: "title", direction: "ASC" }],
  });
  view.query.document.editView({
    sort: [{ property: "title", direction: "DESC" }],
  });
}

it("selects Recent with its own sort after two quick sorts, on screen and in plugin data", async () => {
  const { deps, run, settings } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  await act(async () => {
    sortTwice(view);
    row(view, RECENT).click();
    await view.query.flush();
    await view.searched;
    await view.query.settled;
  });
  expect(listRuns(run).at(-1)!.sort).toEqual([
    { field: "lastActivity", direction: "desc" },
  ]);
  await settings.bridge.runPromise(settings.flush);
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"],
  ).toMatchObject({
    node: RECENT,
    sort: [{ property: "lastActivity", direction: "DESC" }],
  });
});

it("keeps the last of two quick sorts once the search is cleared", async () => {
  const { deps, run, settings } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  await type(view, "figures");
  await act(async () => {
    sortTwice(view);
    view.search.clear();
    await view.query.flush();
    await view.searched;
    await view.query.settled;
  });
  expect(listRuns(run).at(-1)!.sort).toEqual([
    { field: "title", direction: "desc" },
  ]);
  await settings.bridge.runPromise(settings.flush);
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"],
  ).toMatchObject({
    sort: [{ property: "title", direction: "DESC" }],
  });
});

it("reads only the Library Scope on Recent while the tree shows every Library", async () => {
  const { deps, run } = await pluginData();
  const view = await openTab(deps);
  await press(
    view,
    view.contentEl.querySelector<HTMLElement>("[data-library-all]")!,
  );
  await press(view, row(view, RECENT));
  expect(listRuns(run).at(-1)!.libraries).toEqual({
    mode: "selected",
    libraries: [PERSONAL, LAB],
  });
});

/** The Items the list shows, by Indexed Key, in order. */
function listed(view: LibraryView) {
  return [
    ...view.contentEl.querySelectorAll<HTMLElement>("[data-query-papers-row]"),
  ].map((el) => el.dataset.queryPapersRow);
}

function facet(view: LibraryView, id: string): HTMLElement {
  const found = view.contentEl.querySelector<HTMLElement>(
    `[data-library-facet="${id}"]`,
  );
  if (!found) throw new Error(`No facet ${id}`);
  return found;
}

describe("Reading State facets", () => {
  // Of My Library's A–E: A and C have Annotations, A and B a PDF on this
  // device, A and D a Literature Note; B and E have none of the three.
  it.each([
    ["unread", ["BBBBBBBB", "EEEEEEEE"]],
    ["annotated", ["AAAAAAAA", "CCCCCCCC"]],
    ["has-note", ["AAAAAAAA", "DDDDDDDD"]],
    ["pdf", ["AAAAAAAA", "BBBBBBBB"]],
  ])("narrows My Library to the Items %s holds", async (id, keys) => {
    const { deps } = await pluginData();
    const view = await openTab(deps);
    await press(view, row(view, MY_LIBRARY));
    expect(listed(view)).toEqual([
      "AAAAAAAA",
      "BBBBBBBB",
      "CCCCCCCC",
      "DDDDDDDD",
      "EEEEEEEE",
    ]);
    await press(view, facet(view, id));
    expect(facet(view, id).getAttribute("aria-pressed")).toBe("true");
    expect(listed(view)).toEqual(keys);
    // The heading counts the papers the facet leaves of all My Library holds.
    expect(header(view)).toBe("My Library | 2 of 5 papers · 2 unread");
    // A second press shows every Item again.
    await press(view, facet(view, id));
    expect(listed(view)).toHaveLength(5);
  });

  it("narrows Recent, over every Library in the Library Scope", async () => {
    const { deps, run } = await pluginData();
    const view = await openTab(deps);
    await press(view, facet(view, "unread"));
    expect(listRuns(run).at(-1)).toMatchObject({
      libraries: { mode: "selected", libraries: [PERSONAL, LAB] },
      filter: expect.stringContaining("annotations.isEmpty()"),
    });
    // B and E of My Library, F and G of Lab: no Annotation, no note.
    expect(listed(view)).toEqual([
      "BBBBBBBB",
      "EEEEEEEE",
      "FFFFFFFF",
      "GGGGGGGG",
    ]);
  });

  it("combines with the Collection selected and with each other", async () => {
    const { deps } = await pluginData();
    const view = await openTab(deps);
    await press(view, row(view, THESIS));
    await press(view, facet(view, "pdf"));
    expect(listed(view)).toEqual(["AAAAAAAA", "BBBBBBBB"]);
    await press(view, facet(view, "has-note"));
    expect(listed(view)).toEqual(["AAAAAAAA"]);
  });

  it("counts the unread Items of the selection in the header, once the vault answers for their notes", async () => {
    const { deps, addNote } = await pluginData();
    const view = await openTab(deps);
    // Recent counts no unread Items.
    expect(header(view)).toBe("Recent | 7 papers");
    await press(view, row(view, MY_LIBRARY));
    expect(header(view)).toBe("My Library | 5 papers · 2 unread");
    await press(view, row(view, THESIS));
    expect(header(view)).toBe("My Library› | Thesis | 3 papers · 1 unread");
    await press(view, facet(view, "unread"));
    expect(listed(view)).toEqual(["BBBBBBBB"]);
    // A new Literature Note takes B out of the unread Items.
    await act(async () => {
      await addNote("BBBBBBBB");
      await view.query.settled;
      await view.tree.settled;
    });
    expect(listed(view)).toEqual([]);
    expect(header(view)).toBe("My Library› | Thesis | 0 of 3 papers");
  });

  it("opens again with the facets the researcher left on", async () => {
    const { deps, settings } = await pluginData();
    const first = await openTab(deps);
    await press(first, facet(first, "pdf"));
    await press(first, facet(first, "annotated"));
    await settings.bridge.runPromise(settings.flush);
    expect(
      settings.bridge.runSync(settings.current)?.["library.document"]?.facets,
    ).toEqual(["annotated", "pdf"]);
    await act(() => first.close());

    const view = await openTab(deps);
    expect(facet(view, "annotated").getAttribute("aria-pressed")).toBe("true");
    expect(facet(view, "pdf").getAttribute("aria-pressed")).toBe("true");
    expect(facet(view, "unread").getAttribute("aria-pressed")).toBe("false");
    expect(listed(view)).toEqual(["AAAAAAAA"]);
  });
});

/** The Item rows on screen, by Indexed Key, the selected one marked `*`. */
function itemRows(view: LibraryView): string[] {
  return [
    ...view.contentEl.querySelectorAll<HTMLElement>("[data-query-item-row]"),
  ].map(
    (el) =>
      `${el.dataset.queryItemRow}${el.hasAttribute("data-selected") ? " *" : ""}`,
  );
}

function itemRow(view: LibraryView, key: string): HTMLElement {
  const found = view.contentEl.querySelector<HTMLElement>(
    `[data-query-item-row="${key}"]`,
  );
  if (!found) throw new Error(`No Item row for ${key}`);
  return found;
}

/**
 * Press `key` with `modifiers` on `target`, as Obsidian hands a key to the
 * view's Scope: the first handler that matches and answers `false` takes it.
 * Whether one took it.
 */
async function pressKey(
  view: LibraryView,
  target: Element,
  [key, modifiers = []]: [key: string, modifiers?: string[]],
): Promise<boolean> {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: modifiers.includes("Mod"),
    shiftKey: modifiers.includes("Shift"),
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "target", { value: target });
  // The mock Scope records what it was given, which the real type hides.
  const { handlers } = view.scope as unknown as {
    handlers: {
      modifiers: string[] | null;
      key: string | null;
      func: (event: KeyboardEvent) => unknown;
    }[];
  };
  let handled = false;
  await act(() => {
    for (const handler of handlers) {
      const fits =
        (handler.key === null || handler.key === key) &&
        (handler.modifiers === null ||
          handler.modifiers.join() === modifiers.join());
      if (fits && handler.func(event) === false) {
        handled = true;
        return;
      }
    }
  });
  return handled;
}

const A = "AAAAAAAA";
const B = "BBBBBBBB";
const C = "CCCCCCCC";
const D = "DDDDDDDD";
const E = "EEEEEEEE";

it("expands a paper whose only child is its Literature Note, to that note", async () => {
  const { deps } = await pluginData();
  const view = await openTab(deps);
  // D has a Literature Note, and no Attachment, Child Note or Annotation.
  await act(() =>
    view.contentEl
      .querySelector<HTMLElement>('[data-query-expand="item:DDDDDDDD"]')!
      .click(),
  );
  expect(
    view.contentEl
      .querySelector('[data-query-papers-row="DDDDDDDD"]')!
      .querySelector('[data-query-papers-child="literature-note"]')
      ?.textContent,
  ).toContain("DDDDDDDD");
});

it("selects a row on a click and moves the selection with the arrow keys", async () => {
  const { deps, items } = await pluginData();
  const view = await openTab(deps);
  // The tab opens on Recent, which lists every Library in the scope.
  expect(itemRows(view)).toEqual([
    A,
    B,
    C,
    "DDDDDDDD",
    "EEEEEEEE",
    "FFFFFFFF",
    "GGGGGGGG",
  ]);
  await act(() => itemRow(view, B).click());
  expect(itemRows(view).slice(0, 3)).toEqual([A, `${B} *`, C]);
  // A click only selects.
  expect(items.openNote).not.toHaveBeenCalled();
  expect(items.openPdf).not.toHaveBeenCalled();
  expect(await pressKey(view, itemRow(view, B), ["ArrowDown"])).toBe(true);
  expect(itemRows(view).slice(0, 3)).toEqual([A, B, `${C} *`]);
  expect(await pressKey(view, itemRow(view, C), ["ArrowUp"])).toBe(true);
  expect(await pressKey(view, itemRow(view, B), ["ArrowUp"])).toBe(true);
  expect(itemRows(view).slice(0, 3)).toEqual([`${A} *`, B, C]);
});

it("lets the keyboard enter the list at its first row while none is selected, and names the selected row to assistive technology", async () => {
  const { deps } = await pluginData();
  const view = await openTab(deps);
  const stops = () =>
    [...view.contentEl.querySelectorAll<HTMLElement>("[data-query-item-row]")]
      .filter((el) => el.tabIndex === 0)
      .map((el) => el.dataset.queryItemRow);
  expect(stops()).toEqual([A]);
  await act(() => itemRow(view, C).click());
  expect(stops()).toEqual([C]);
  expect(itemRow(view, C).getAttribute("aria-current")).toBe("true");
  expect(itemRow(view, A).hasAttribute("aria-current")).toBe(false);
  // A row that takes focus is a group named by its title, with no tooltip.
  expect(itemRow(view, C).getAttribute("role")).toBe("group");
  expect(itemRow(view, C).hasAttribute("aria-label")).toBe(false);
  expect(accessibleName(itemRow(view, C))).toBe("Figures that work");
});

it("selects the row the keyboard enters the list at, with no Reading Card, so its keys act on it", async () => {
  const { deps, items } = await pluginData();
  const view = await openTab(deps);
  await act(() => itemRow(view, A).focus());
  expect(view.selected).toEqual({ key: A, card: false });
  expect(await pressKey(view, itemRow(view, A), ["Enter"])).toBe(true);
  expect(items.openNote).toHaveBeenLastCalledWith(A, false);
  expect(await pressKey(view, itemRow(view, A), [" "])).toBe(true);
  expect(view.selected).toEqual({ key: A, card: true });
});

it("selects a row whose expand button is clicked, and asks for no Reading Card", async () => {
  const { deps } = await pluginData();
  const view = await openTab(deps);
  const expand = itemRow(view, A).querySelector<HTMLElement>(
    "button[data-query-expand]",
  )!;
  await act(() => expand.click());
  expect(view.selected).toEqual({ key: A, card: false });
});

it("answers the quick switcher's keys on the selected row: Enter the note, Mod+Enter the note in a new pane, Shift+Enter the PDF", async () => {
  const { deps, items } = await pluginData();
  const view = await openTab(deps);
  await act(() => itemRow(view, B).click());
  const row = itemRow(view, B);
  expect(await pressKey(view, row, ["Enter"])).toBe(true);
  expect(items.openNote).toHaveBeenLastCalledWith(B, false);
  expect(await pressKey(view, row, ["Enter", ["Mod"]])).toBe(true);
  expect(items.openNote).toHaveBeenLastCalledWith(B, "tab");
  expect(await pressKey(view, row, ["Enter", ["Shift"]])).toBe(true);
  expect(items.openPdf).toHaveBeenLastCalledWith(B, false);
  expect(await pressKey(view, row, ["Enter", ["Mod", "Shift"]])).toBe(true);
  expect(items.openPdf).toHaveBeenLastCalledWith(B, "tab");
  expect(items.openNote).toHaveBeenCalledTimes(2);
  expect(items.openPdf).toHaveBeenCalledTimes(2);
});

it("leaves Enter and the arrow keys to a field, a button and the Library Tree", async () => {
  const { deps, items } = await pluginData();
  const view = await openTab(deps);
  await act(() => itemRow(view, B).click());
  const field = view.contentEl.createEl("input");
  const button =
    itemRow(view, B).querySelector("button") ??
    view.contentEl.createEl("button");
  const tree = view.contentEl.querySelector("[role=tree] [data-library-node]")!;
  for (const target of [field, button, tree]) {
    expect(await pressKey(view, target, ["Enter"])).toBe(false);
    expect(await pressKey(view, target, ["ArrowDown"])).toBe(false);
  }
  expect(items.openNote).not.toHaveBeenCalled();
  expect(itemRows(view)[1]).toBe(`${B} *`);
});

it("opens the PDF on a double click", async () => {
  const { deps, items } = await pluginData();
  const view = await openTab(deps);
  await act(() => {
    itemRow(view, C).dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true }),
    );
  });
  expect(items.openPdf).toHaveBeenCalledExactlyOnceWith(C, false);
});

it("lists the row's actions in its menu, which other plugins add to", async () => {
  const { deps, items } = await pluginData();
  const trigger = vi.fn();
  deps.app.workspace.trigger = trigger;
  const view = await openTab(deps);
  await act(() => {
    itemRow(view, B).dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
  });
  const menu = Menu.instances.at(-1)!;
  expect(menu.items.map((item) => [item.section, item.title])).toEqual([
    ["open", "Open PDF"],
    ["open", "Open PDF to the right"],
    ["open", "Write literature note"],
    ["insert", "Insert citation"],
    ["clipboard", "Copy citation key"],
    ["zotero", "Show in Zotero"],
  ]);
  expect(menu.items.every((item) => item.icon !== null)).toBe(true);
  expect(trigger).toHaveBeenCalledExactlyOnceWith("zotlit:item-menu", menu, {
    source: "library-view",
    indexedKey: B,
  });
  // The menu acts on the row it opened over, which it selects without
  // opening its Reading Card.
  expect(itemRows(view)[1]).toBe(`${B} *`);
  expect(view.selected).toEqual({ key: B, card: false });
  menu.items[1]!.click();
  expect(items.openPdf).toHaveBeenCalledExactlyOnceWith(B, "split");
  menu.items[5]!.click();
  expect(items.showInZotero).toHaveBeenCalledExactlyOnceWith(B);
});

it("offers no PDF to open in the menu of a row whose Item has no PDF", async () => {
  const { deps } = await pluginData();
  deps.app.workspace.trigger = vi.fn();
  const view = await openTab(deps);
  await act(() => {
    itemRow(view, C).dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
  });
  expect(Menu.instances.at(-1)!.items.map((item) => item.title)).toEqual([
    "Write literature note",
    "Insert citation",
    "Copy citation key",
    "Show in Zotero",
  ]);
});

it("shows an Item in its first Collection, selected, with its Reading Card", async () => {
  const { deps, run } = await pluginData();
  const view = await openTab(deps);
  await act(async () => {
    await view.reveal(A);
  });
  // A is filed in Chapter 1 and Chapter 2 of Thesis; Chapter 1 comes first.
  expect(listRuns(run).at(-1)).toMatchObject({
    libraries: { mode: "selected", libraries: [PERSONAL] },
    filter: 'collections.within("Thesis/Chapter 1")',
  });
  expect(header(view)).toBe("My Library›Thesis› | Chapter 1 | 1 paper");
  expect(itemRows(view)).toContain(`${A} *`);
  // Show in Library asks for the Item's Reading Card, as a click does.
  expect(view.selected).toEqual({ key: A, card: true });
});

it("turns the Reading State facets off to show an Item they leave out", async () => {
  const { deps, run, settings } = await pluginData();
  const view = await openTab(deps);
  // A has Annotations, so Unread leaves it out.
  await press(view, facet(view, "unread"));
  await press(view, facet(view, "pdf"));
  await act(async () => {
    await view.reveal(A);
  });
  expect(listRuns(run).at(-1)).toMatchObject({
    filter: 'collections.within("Thesis/Chapter 1")',
  });
  expect(facet(view, "unread").getAttribute("aria-pressed")).toBe("false");
  expect(facet(view, "pdf").getAttribute("aria-pressed")).toBe("false");
  expect(itemRows(view)).toContain(`${A} *`);
  await settings.bridge.runPromise(settings.flush);
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"]?.facets,
  ).toEqual([]);
});

it("says it cannot show an Item past the rows the list holds, and selects nothing", async () => {
  const { deps, change } = await pluginData();
  // A thousand Items of My Library come before the one revealed.
  const octal = (n: number) =>
    Array.from(n.toString(8).padStart(6, "0"))
      .map((digit) => "ABCDEFGH"[Number(digit)])
      .join("");
  const many = Array.from({ length: 1000 }, (_, n) => ({
    key: `ZZ${octal(n)}`,
    libraryID: 1,
    collections: [] as string[],
  }));
  await change([...many, { key: "YYYYYYYY", libraryID: 1, collections: [] }]);
  const view = await openTab(deps);
  // The second time the list already shows My Library, and runs nothing.
  for (const _ of [1, 2]) {
    let outcome: unknown;
    await act(async () => {
      outcome = await view.reveal("YYYYYYYY");
    });
    expect(outcome).toBe("not-listed");
    expect(view.selected).toEqual({ key: null, card: false });
  }
});

it("shows an Item filed in no Collection in its Library", async () => {
  const { deps, run } = await pluginData();
  const view = await openTab(deps);
  await press(view, row(view, THESIS));
  await act(async () => {
    await view.reveal("EEEEEEEE");
  });
  expect(listRuns(run).at(-1)!.libraries).toEqual({
    mode: "selected",
    libraries: [PERSONAL],
  });
  expect(listRuns(run).at(-1)).not.toHaveProperty("filter");
  expect(itemRows(view)).toContain("EEEEEEEE *");
});

/** A document of plugin data that lists My Library. */
const ON_MY_LIBRARY = {
  node: { kind: "library", library: PERSONAL },
  facets: [],
  search: "",
  sort: [{ property: "dateModified", direction: "DESC" }],
};

/** The offer to search all libraries beside the header, while it shows. */
function searchAll(view: LibraryView) {
  return view.contentEl.querySelector<HTMLElement>("[data-library-search-all]");
}

/** The search box of the tab. */
function searchBox(view: LibraryView): HTMLInputElement {
  return view.contentEl.querySelector("[data-library-search] input")!;
}

/** Type `text` into the search box, and wait for the list. */
async function type(view: LibraryView, text: string) {
  await act(async () => {
    const input = searchBox(view);
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await view.searched;
    await view.query.settled;
  });
}

/** The Indexed Keys of the rows on screen, in order. */
function shown(view: LibraryView) {
  return (view.query.state.getState().results?.rows ?? []).map(
    (r) => r.indexedKey,
  );
}

it("offers no toolbar search of the rows on screen beside its own search box", async () => {
  const { deps } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  expect(
    view.contentEl.querySelector('[data-query-toolbar="search"]'),
  ).toBeNull();
});

it("keeps Sort in place but off while a search lists its hits in rank order, and turns it on again once the search is cleared", async () => {
  const { deps } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  const sort = () =>
    view.contentEl.querySelector<HTMLElement>('[data-query-toolbar="sort"]');
  const state = () =>
    sort() === null
      ? "gone"
      : sort()!.getAttribute("aria-disabled") === "true"
        ? "off"
        : "on";
  expect(state()).toBe("on");
  await type(view, "figures");
  expect(state()).toBe("off");
  // It says why, and opens nothing.
  expect(sort()!.getAttribute("aria-label")).toBe(m.query_view_sort_ranked());
  expect(sort()!.hasAttribute("popovertarget")).toBe(false);
  await type(view, "");
  expect(state()).toBe("on");
});

/** Bring `view`'s tab forward, as the command that opens the Library View does. */
async function bringForward(view: LibraryView) {
  const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
    view,
    updateHeader: () => {},
  });
  await openLibraryView(
    stubService<App>("App", {
      workspace: stubService<App["workspace"]>("Workspace", {
        getLeavesOfType: () => [leaf],
        setActiveLeaf: () => {},
        revealLeaf: () => Promise.resolve(),
      }),
    }),
  );
}

it("has the search box focused when the command brings the tab forward", async () => {
  const { deps, host } = await pluginData();
  // Setup is complete, so no Welcome View banner shows.
  host.vault.addFile("literatures/Paper.md", "");
  const view = await openTab(deps);
  await act(() => view.welcome.settled);
  expect(document.activeElement).not.toBe(searchBox(view));
  await bringForward(view);
  expect(document.activeElement).toBe(searchBox(view));
});

it("leaves the search box unfocused when the command brings the tab forward under the Welcome View banner", async () => {
  const { deps } = await pluginData();
  const view = await openTab(deps);
  await act(() => view.welcome.settled);
  expect(view.contentEl.querySelector("[data-welcome-banner]")).not.toBeNull();
  await bringForward(view);
  expect(document.activeElement).not.toBe(searchBox(view));
});

/**
 * Hold the banner's connection readout until the returned call lands it, as
 * on a first launch, where Zotero's database is still loading.
 */
async function holdReadout(deps: LibraryViewDeps & QueryHostDeps) {
  const ready = Promise.withResolvers<{ itemCount: number }>();
  await using lease = await deps.reads.acquireRead();
  Object.assign(lease.reads, {
    ConnectionReadout: () => Effect.promise(() => ready.promise),
  });
  return async (view: LibraryView) => {
    await act(async () => {
      ready.resolve({ itemCount: 8 });
      await view.welcome.settled;
    });
    await act(() => view.arrived);
  };
}

it("leaves the search box unfocused when the command brings the tab forward before the banner's readout lands, and the banner comes to show", async () => {
  const { deps } = await pluginData();
  const land = await holdReadout(deps);
  const view = await openTab(deps);
  await bringForward(view);
  await land(view);
  expect(view.contentEl.querySelector("[data-welcome-banner]")).not.toBeNull();
  expect(document.activeElement).not.toBe(searchBox(view));
});

it("has the search box focused once the banner's readout lands where no banner comes to show", async () => {
  const { deps, host } = await pluginData();
  host.vault.addFile("literatures/Paper.md", "");
  const land = await holdReadout(deps);
  const view = await openTab(deps);
  await bringForward(view);
  await land(view);
  expect(view.contentEl.querySelector("[data-welcome-banner]")).toBeNull();
  expect(document.activeElement).toBe(searchBox(view));
});

it("leaves the cursor where the researcher moved it while the banner's readout was pending", async () => {
  const { deps, host } = await pluginData();
  host.vault.addFile("literatures/Paper.md", "");
  const land = await holdReadout(deps);
  const view = await openTab(deps);
  await bringForward(view);
  const elsewhere = document.body.createEl("input");
  cleanup.defer(() => elsewhere.remove());
  elsewhere.focus();
  await land(view);
  expect(document.activeElement).toBe(elsewhere);
});

it("puts the cursor in its own search box from the Welcome View banner's Search your library", async () => {
  const { deps } = await pluginData();
  const view = await openTab(deps);
  await act(() => view.welcome.settled);
  expect(document.activeElement).not.toBe(searchBox(view));
  const button = [
    ...view.contentEl.querySelectorAll<HTMLElement>(
      "[data-welcome-banner] button",
    ),
  ].find((el) => el.textContent === m.welcome_action_search());
  expect(button).toBeInstanceOf(HTMLElement);
  await act(() => button!.click());
  expect(document.activeElement).toBe(searchBox(view));
});

it("lists a search's hits in the rank of the worker search, inside the selected node", async () => {
  const { deps, searches } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  expect(shown(view)).toEqual([
    "AAAAAAAA",
    "BBBBBBBB",
    "CCCCCCCC",
    "DDDDDDDD",
    "EEEEEEEE",
  ]);
  await type(view, "figures");
  expect(searches.at(-1)).toEqual({ query: "figures", libraries: [1] });
  expect(shown(view)).toEqual(["DDDDDDDD", "CCCCCCCC", "AAAAAAAA"]);
  expect(header(view)).toBe(
    "My Library› | 3 matches for “figures” | Search all libraries",
  );
  expect(searchAll(view)?.textContent).toBe("Search all libraries");
  await press(view, row(view, THESIS));
  expect(shown(view)).toEqual(["CCCCCCCC", "AAAAAAAA"]);
  expect(header(view)).toBe(
    "My Library›Thesis› | 2 matches for “figures” | Search all libraries",
  );
  expect(searchAll(view)?.textContent).toBe("Search all libraries");
});

it("announces the search's match count as a status, and not a tree selection", async () => {
  const { deps } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  const status = () =>
    view.contentEl.querySelectorAll<HTMLElement>('[role="status"]');
  // The status is on the page, empty, before it has anything to say, so a
  // screen reader hears the first count too.
  expect([...status()].map((el) => el.textContent)).toEqual([""]);
  await press(view, row(view, THESIS));
  expect(status()[0]!.textContent).toBe("");
  await type(view, "figures");
  expect(status()[0]!.textContent).toBe("2 matches in Thesis");
  await type(view, "");
  expect(status()[0]!.textContent).toBe("");
});

it("searches all libraries in the Library Scope on request, past the selected Collection", async () => {
  const { deps, run, searches } = await pluginData();
  const view = await openTab(deps);
  await press(view, row(view, THESIS));
  await type(view, "figures");
  await press(
    view,
    view.contentEl.querySelector<HTMLElement>("[data-library-search-all]")!,
  );
  expect(searches.at(-1)).toEqual({ query: "figures", libraries: [1, 2] });
  expect(shown(view)).toEqual(["FFFFFFFF", "DDDDDDDD", "CCCCCCCC", "AAAAAAAA"]);
  expect(listRuns(run).at(-1)!.libraries).toEqual({
    mode: "selected",
    libraries: [PERSONAL, LAB],
  });
  expect(header(view)).toBe("All libraries› | 4 matches for “figures”");
  // The tree marks no node while the list reads every Library, and marks
  // the node again once the search keeps to it.
  const selected = () =>
    [
      ...view.contentEl.querySelectorAll<HTMLElement>(
        '[role="treeitem"][aria-selected="true"]',
      ),
    ].map((el) => el.dataset.libraryNode);
  expect(selected()).toEqual([]);
  // The node keeps the tree's one stop for Tab.
  expect(
    view.contentEl.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')
      ?.dataset.libraryNode,
  ).toBe(nodeKey(THESIS));
  await type(view, "");
  expect(selected()).toEqual([nodeKey(THESIS)]);
});

it("narrows a tag: token to the Items with that tag, in the list's order", async () => {
  const { deps, searches } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  const before = searches.length;
  await type(view, "tag:method");
  expect(searches).toHaveLength(before);
  expect(shown(view)).toEqual(["AAAAAAAA", "CCCCCCCC", "EEEEEEEE"]);
  await type(view, "tag:method figures");
  expect(shown(view)).toEqual(["CCCCCCCC", "AAAAAAAA"]);
});

it("asks the search again after a database change, so a renamed Item joins its hits", async () => {
  const { deps, change } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  await type(view, "figures");
  expect(shown(view)).toEqual(["DDDDDDDD", "CCCCCCCC", "AAAAAAAA"]);
  await act(async () => {
    await change(
      SEED.map((item) =>
        item.key === B ? { ...item, title: "Figures of attention" } : item,
      ),
    );
    await view.searched;
    await view.query.settled;
  });
  expect(shown(view)).toEqual(["DDDDDDDD", "CCCCCCCC", B, "AAAAAAAA"]);
});

it("clears the search on Escape, and lists the selected node again", async () => {
  const { deps, settings } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  await type(view, "figures");
  await act(async () => {
    searchBox(view).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await view.searched;
    await view.query.settled;
  });
  expect(searchBox(view).value).toBe("");
  expect(shown(view)).toEqual([
    "AAAAAAAA",
    "BBBBBBBB",
    "CCCCCCCC",
    "DDDDDDDD",
    "EEEEEEEE",
  ]);
  expect(header(view)).toBe("My Library | 5 papers · 2 unread");
  await act(() => view.close());
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"]?.search,
  ).toBe("");
});

it("says how to recover from a search that finds nothing, offering to search all libraries, then to clear it, with no filter hint", async () => {
  const { deps } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  const empty = () =>
    view.contentEl.querySelector<HTMLElement>("[data-query-empty]");
  await type(view, "Engelbart");
  expect(shown(view)).toEqual([]);
  // One sentence and one action: the heading says nothing matched, so the
  // list says how to recover, with no dataset sentence, no filter hint, and
  // the header leaves its own offer to the empty list.
  expect(view.contentEl.querySelector("[data-query-empty-hint]")).toBeNull();
  expect(empty()?.textContent).toBe(
    `${m.library_view_empty_search_widen()}${m.library_view_search_everywhere()}`,
  );
  expect(searchAll(view)).toBeNull();
  // The empty list stands centred in the space under the header.
  expect(empty()?.closest("[data-pane-state]")).not.toBeNull();
  const action = () =>
    empty()?.querySelector<HTMLElement>("[data-library-empty-action]");
  expect(action()?.textContent).toBe(m.library_view_search_everywhere());
  await act(async () => {
    action()!.click();
    await view.searched;
    await view.query.settled;
  });
  expect(shown(view)).toEqual([]);
  expect(empty()?.textContent).toBe(
    `${m.library_view_empty_search_clear()}${m.library_view_search_clear()}`,
  );
  expect(action()?.textContent).toBe(m.library_view_search_clear());
  await act(async () => {
    action()!.click();
    await view.searched;
    await view.query.settled;
  });
  expect(searchBox(view).value).toBe("");
  expect(shown(view)).toHaveLength(5);
});

it("says the facets left nothing to list where no paper passes them", async () => {
  const { deps } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  // An unread paper has no Literature Note, so none passes both.
  await press(view, facet(view, "has-note"));
  await press(view, facet(view, "unread"));
  expect(shown(view)).toEqual([]);
  expect(view.contentEl.querySelector("[data-query-empty-hint]")).toBeNull();
  expect(view.contentEl.querySelector("[data-query-empty]")?.textContent).toBe(
    m.library_view_empty_facets(),
  );
});

it("keeps a search inside the active facets, the vault's among them, in the search's rank", async () => {
  const { deps } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  await type(view, "figures");
  expect(shown(view)).toEqual(["DDDDDDDD", "CCCCCCCC", "AAAAAAAA"]);
  await press(view, facet(view, "has-note"));
  expect(shown(view)).toEqual(["DDDDDDDD", "AAAAAAAA"]);
  await press(view, facet(view, "annotated"));
  expect(shown(view)).toEqual(["AAAAAAAA"]);
  expect(header(view)).toBe(
    "My Library› | 1 match for “figures” | Search all libraries",
  );
  expect(searchAll(view)?.textContent).toBe("Search all libraries");
});

it("keeps a search of all libraries inside the active facets", async () => {
  const { deps } = await pluginData();
  const view = await openTab(deps);
  await press(view, row(view, THESIS));
  await press(view, facet(view, "unread"));
  await type(view, "figures");
  // Nothing in Thesis passes, so the empty list makes the offer.
  await press(
    view,
    view.contentEl.querySelector<HTMLElement>(
      '[data-library-empty-action="widen"]',
    )!,
  );
  // Of the four hits in My Library and Lab, F has no Annotation and no
  // note; the others have one or the other.
  expect(shown(view)).toEqual(["FFFFFFFF"]);
});

it("lists nothing more once the tab closed during a search", async () => {
  const { deps, run, searchRun } = await pluginData();
  const gate = Promise.withResolvers<void>();
  const search = searchRun.search;
  searchRun.search = async (words, options, signal) => {
    await gate.promise;
    if (signal?.aborted) return [];
    return search(words, options);
  };
  const view = await openTab(deps);
  const before = listRuns(run).length;
  await act(async () => {
    const input = searchBox(view);
    input.value = "figures";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await view.close();
    gate.resolve();
    await view.searched;
  });
  expect(listRuns(run)).toHaveLength(before);
});

it("keeps the search text, and opens again on its hits", async () => {
  const { deps, settings } = await pluginData(ON_MY_LIBRARY);
  const first = await openTab(deps);
  await type(first, "figures");
  await act(() => first.close());
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"]?.search,
  ).toBe("figures");
  const view = await openTab(deps);
  expect(searchBox(view).value).toBe("figures");
  expect(shown(view)).toEqual(["DDDDDDDD", "CCCCCCCC", "AAAAAAAA"]);
});

it("searches every Library in the Library Scope on Recent, with no offer to widen", async () => {
  const { deps, searches } = await pluginData();
  const view = await openTab(deps);
  await type(view, "figures");
  expect(searches.at(-1)).toEqual({ query: "figures", libraries: [1, 2] });
  expect(shown(view)).toEqual(["FFFFFFFF", "DDDDDDDD", "CCCCCCCC", "AAAAAAAA"]);
  expect(header(view)).toBe("Recent› | 4 matches for “figures”");
  expect(view.contentEl.querySelector("[data-library-search-all]")).toBeNull();
});

it("leaves Enter and the arrow keys to the Welcome View banner's controls", async () => {
  const { deps, items } = await pluginData();
  const view = await openTab(deps);
  await act(() => itemRow(view, B).click());
  const dismiss = view.contentEl.querySelector("[data-welcome-dismiss]")!;
  expect(dismiss).not.toBeNull();
  expect(await pressKey(view, dismiss, ["Enter"])).toBe(false);
  expect(await pressKey(view, dismiss, ["ArrowDown"])).toBe(false);
  expect(items.openNote).not.toHaveBeenCalled();
  expect(itemRows(view)[1]).toBe(`${B} *`);
});

describe("Welcome View banner once setup is complete", () => {
  /** The banner's headings on screen. */
  const banner = (view: LibraryView) =>
    [
      ...view.contentEl.querySelectorAll(
        '[data-welcome-banner] [role="heading"]',
      ),
    ].map((el) => el.textContent);

  /** A tab of a vault with the literature-notes folder, its banner settled. */
  async function setUp() {
    const harness = await pluginData();
    harness.host.vault.addFile("literatures/Paper.md", "");
    const view = await openTab(harness.deps);
    await act(() => view.welcome.settled);
    return { ...harness, view };
  }

  it("shows the setup steps on Open welcome view", async () => {
    const { view } = await setUp();
    const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
      view,
      updateHeader: () => {},
    });
    await act(() =>
      openWelcomeView(
        stubService<App>("App", {
          workspace: stubService<App["workspace"]>("Workspace", {
            getLeavesOfType: () => [leaf],
            setActiveLeaf: () => {},
            revealLeaf: () => Promise.resolve(),
          }),
        }),
      ),
    );
    expect(banner(view)).toContain(m.welcome_step_connect_title());
    expect(banner(view)).toContain(m.welcome_step_folder_title());
  });

  it("toggles the banner from the Welcome & help view action, which reads as pressed while the banner shows", async () => {
    const { view, settings } = await setUp();
    await act(() => {
      settings.bridge.runSync(settings.update({ "welcome.dismissed": true }));
    });
    // One action in the tab header, named by its tooltip; the Library Tree
    // keeps no row of its own for it.
    const { actions } = view as unknown as { actions: HTMLElement[] };
    expect(actions.map((a) => a.getAttribute("aria-label"))).toEqual([
      m.library_view_help_action(),
    ]);
    const [help] = actions as [HTMLElement];
    expect(view.contentEl.querySelector("[data-welcome-help-row]")).toBeNull();
    expect(help.classList.contains("is-active")).toBe(false);
    expect(help.getAttribute("aria-pressed")).toBe("false");

    // Hidden: it shows the banner with its setup steps and moves focus to it.
    await act(() => help.click());
    expect(
      settings.bridge.runSync(settings.current)?.["welcome.dismissed"],
    ).toBe(false);
    expect(banner(view)).toContain(m.welcome_step_connect_title());
    expect(banner(view)).toContain(m.welcome_step_folder_title());
    expect(view.contentEl.ownerDocument.activeElement).toBe(
      view.contentEl.querySelector("[data-welcome-banner]"),
    );
    expect(help.classList.contains("is-active")).toBe(true);
    expect(help.getAttribute("aria-pressed")).toBe("true");

    // Showing: it dismisses the banner, as the dismiss button does.
    await act(() => help.click());
    expect(
      settings.bridge.runSync(settings.current)?.["welcome.dismissed"],
    ).toBe(true);
    expect(banner(view)).toEqual([]);
    expect(help.classList.contains("is-active")).toBe(false);
    expect(help.getAttribute("aria-pressed")).toBe("false");

    // The state follows the banner whatever moves it: the command shows it,
    // its dismiss button puts it away.
    await act(() => view.welcome.request());
    expect(help.getAttribute("aria-pressed")).toBe("true");
    await act(() =>
      view.contentEl
        .querySelector<HTMLElement>("[data-welcome-dismiss]")!
        .click(),
    );
    expect(help.getAttribute("aria-pressed")).toBe("false");
    expect(help.classList.contains("is-active")).toBe(false);
  });

  it("offers the template conversion while it is pending", async () => {
    const { view, settings } = await setUp();
    await act(() => {
      settings.bridge.runSync(
        settings.update({ "note.template-conversion-pending": true }),
      );
    });
    expect(banner(view)).toContain(m.welcome_template_conversion_title());
  });
});

it("asks the database nothing from the search box while Zotero's data folder is missing, and searches once it is set", async () => {
  const { deps, searches, lose, locate } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  await lose();
  await act(async () => {
    view.search.type("figures");
    await view.searched;
  });
  expect(searches).toEqual([]);
  await act(async () => {
    await locate();
    await view.searched;
    await view.query.settled;
  });
  expect(searches.at(-1)).toEqual({ query: "figures", libraries: [1] });
  expect(shown(view)).toEqual(["DDDDDDDD", "CCCCCCCC", "AAAAAAAA"]);
});

it("lets go of the selected row once a search leaves it out, and hides its Reading Card", async () => {
  const { deps } = await pluginData();
  const view = await openTab(deps);
  await act(() => itemRow(view, A).click());
  expect(view.selected.key).toBe(A);
  await type(view, "attention");
  expect(itemRows(view)).toEqual([B]);
  expect(view.selected.key).toBeNull();
  expect(
    view.contentEl.querySelector("[data-library-card]")!.hasAttribute("hidden"),
  ).toBe(true);
});

it("opens again on the paper the researcher selected, scrolled into view, with its Reading Card beside a wide list", async () => {
  const { deps, settings } = await pluginData();
  const first = await openTab(deps);
  await act(() => itemRow(first, C).click());
  await act(() => settings.bridge.runPromise(settings.flush));
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"]?.selected,
  ).toBe(C);
  await act(() => first.close());
  const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
  cleanup.defer(() => scrolled.mockRestore());
  const view = await openTab(deps);
  expect(itemRows(view).slice(0, 3)).toEqual([A, B, `${C} *`]);
  // Selected as the arrow keys select: a wide pane shows the card beside
  // the list, and a narrow one leaves the list uncovered.
  expect(view.selected).toEqual({ key: C, card: false });
  expect(
    view.contentEl.querySelector("[data-library-card]")!.hasAttribute("hidden"),
  ).toBe(false);
  // The list draws the row before it scrolls there.
  await vi.waitFor(() =>
    expect(scrolled.mock.contexts).toContain(itemRow(view, C)),
  );
});

it("lets go of the selected paper in the document once the researcher picks another node", async () => {
  const { deps, settings } = await pluginData();
  const view = await openTab(deps);
  await act(() => itemRow(view, A).click());
  await press(view, row(view, MY_LIBRARY));
  await act(() => settings.bridge.runPromise(settings.flush));
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"]?.selected,
  ).toBeNull();
});

it("opens with no paper selected where the list no longer holds the one it kept, and forgets it", async () => {
  const { deps, settings } = await pluginData({
    node: { kind: "recent" },
    selected: "1:ZZZZZZZZ",
  });
  const view = await openTab(deps);
  expect(view.selected.key).toBeNull();
  expect(itemRows(view).some((key) => key.endsWith("*"))).toBe(false);
  await act(() => settings.bridge.runPromise(settings.flush));
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"]?.selected,
  ).toBeNull();
});

describe("Reading Card", () => {
  /** The Reading Card pane, which shows while a row is selected. */
  const card = (view: LibraryView) =>
    view.contentEl.querySelector<HTMLElement>("[data-library-card]")!;
  /** The card's text by part, `null` while the card is hidden. */
  const shownCard = (view: LibraryView) => {
    const el = card(view);
    if (el.hidden) return null;
    const part = (name: string) =>
      el.querySelector(`[data-library-card-${name}]`)?.textContent ?? null;
    return {
      title: part("title"),
      creators: part("creators"),
      venue: part("venue"),
      abstract: part("abstract"),
    };
  };
  const button = (view: LibraryView, action: string) =>
    card(view).querySelector<HTMLElement>(
      `[data-library-card-action="${action}"]`,
    )!;

  it("hides while no row is selected, and shows the selected Item's title, creators in full, publication with year, and abstract", async () => {
    const { deps } = await pluginData();
    const view = await openTab(deps);
    expect(shownCard(view)).toBeNull();
    await act(async () => {
      itemRow(view, B).click();
      await view.card.settled;
    });
    expect(shownCard(view)).toEqual({
      title: "Notes on attention",
      // The authors in full, and not the editor, as on the row.
      creators: "Ashish Vaswani, Noam Shazeer",
      venue: "Advances in Neural Information Processing Systems · 2017",
      abstract: "Attention alone carries a sequence model.",
    });
    // An Item with no abstract shows none.
    await act(async () => {
      itemRow(view, C).click();
      await view.card.settled;
    });
    expect(shownCard(view)).toEqual({
      title: "Figures that work",
      creators: null,
      venue: null,
      abstract: null,
    });
  });

  it("reads the selected Item again after a database change", async () => {
    const { deps, change } = await pluginData();
    const view = await openTab(deps);
    await act(async () => {
      itemRow(view, B).click();
      await view.card.settled;
    });
    await act(async () => {
      await change(
        SEED.map((item) =>
          item.key === B ? { ...item, title: "Attention, renamed" } : item,
        ),
      );
      await view.query.settled;
      await view.card.settled;
    });
    expect(shownCard(view)?.title).toBe("Attention, renamed");
  });

  it("opens its row menu under the more button", async () => {
    const { deps } = await pluginData();
    deps.app.workspace.trigger = vi.fn();
    const view = await openTab(deps);
    await act(async () => {
      itemRow(view, B).click();
      await view.card.settled;
    });
    await act(() => button(view, "more").click());
    const menu = Menu.instances.at(-1)!;
    expect(menu.parentEl).toBe(button(view, "more"));
    expect(menu.position).not.toBeNull();
  });

  it("shows none of the last Item's Annotations while it reads another's, and says so where that read fails", async () => {
    const { deps, run, change } = await pluginData();
    const view = await openTab(deps);
    // B has an Annotation here, so its card offers it.
    const annotated = SEED.map((item) =>
      item.key === B ? { ...item, annotations: 1 } : item,
    );
    await act(async () => {
      await change(annotated);
      await view.query.settled;
    });
    await select(view, A);
    await open(view, "annotations");
    expect(view.card.query.state.getState().results).not.toBeNull();
    const failing = Promise.withResolvers<QueryViewOutcome>();
    // The Annotation Cards' read fails; the preview's, with its limit, does not.
    run.mockImplementation((request) =>
      request.from === "annotations" &&
      request.context?.item === B &&
      request.limit == null
        ? failing.promise
        : Promise.resolve(answer(annotated, request)),
    );
    await act(() => itemRow(view, B).click());
    // Once B's fields and preview land, A's cards go while B's are read.
    await vi.waitFor(() =>
      expect(view.card.state.item?.title).toBe("Notes on attention"),
    );
    expect(view.card.query.state.getState().results).toBeNull();
    await act(async () => {
      failing.reject(new Error("The database is busy"));
      await view.card.settled;
    });
    expect(view.card.query.state.getState().results).toBeNull();
    expect(
      card(view).querySelector("[data-library-card-failed]"),
    ).not.toBeNull();
  });

  it("lists the selected Item's Annotations with the Item as the Query Context, from the Item's Library", async () => {
    const { deps, run } = await pluginData();
    const view = await openTab(deps);
    await select(view, A);
    await open(view, "annotations");
    await select(view, C);
    const annotations = run.mock.calls
      .map(([request]) => request)
      .filter((request) => request.from === "annotations");
    expect(annotations.at(-1)).toMatchObject({
      filter: "item == this.item",
      context: { item: C },
      // Recent reads every Library in the Library Scope; the card, C's own.
      libraries: { mode: "selected", libraries: [PERSONAL] },
    });
  });

  it("hides once the researcher picks another node in the tree", async () => {
    const { deps } = await pluginData();
    const view = await openTab(deps);
    await act(async () => {
      itemRow(view, B).click();
      await view.card.settled;
    });
    expect(shownCard(view)).not.toBeNull();
    await press(view, row(view, THESIS));
    expect(shownCard(view)).toBeNull();
  });

  it("opens the PDF and opens or writes the Literature Note, and cites from its More menu, as the row menu does", async () => {
    const { deps, items, addNote } = await pluginData();
    deps.app.workspace.trigger = vi.fn();
    const view = await openTab(deps);
    await act(async () => {
      itemRow(view, B).click();
      await view.card.settled;
    });
    // Two buttons, and the rest of the row menu under More.
    expect(
      [
        ...card(view).querySelectorAll<HTMLElement>(
          "[data-library-card-action]",
        ),
      ].map((el) => el.dataset.libraryCardAction),
    ).toEqual(["pdf", "note", "more", "sidebar"]);
    // B has no Literature Note yet.
    expect(button(view, "note").textContent).toBe("Write literature note");
    await act(() => {
      button(view, "pdf").click();
      button(view, "note").click();
      button(view, "more").click();
    });
    expect(items.openPdf).toHaveBeenCalledExactlyOnceWith(B, false);
    expect(items.openNote).toHaveBeenCalledExactlyOnceWith(B, false);
    Menu.instances
      .at(-1)!
      .items.find((item) => item.title === "Insert citation")!
      .click();
    expect(items.insertCitation).toHaveBeenCalledExactlyOnceWith(B);
    await act(() => addNote(B));
    expect(button(view, "note").textContent).toBe("Open literature note");
  });

  it("offers no Open PDF for an Item with no PDF, and makes its Literature Note the primary button, from the row's header on", async () => {
    const { deps, addNote } = await pluginData();
    deps.app.workspace.trigger = vi.fn();
    const view = await openTab(deps);
    const actions = () =>
      [
        ...card(view).querySelectorAll<HTMLElement>(
          "[data-library-card-action]",
        ),
      ].map(
        (el) =>
          `${el.dataset.libraryCardAction}${el.classList.contains("mod-cta") ? " (primary)" : ""}`,
      );
    // While the card reads C, it shows C's header from its row.
    await act(() => itemRow(view, C).click());
    expect(actions()).toEqual(["note (primary)", "more", "sidebar"]);
    await act(() => view.card.settled);
    expect(actions()).toEqual(["note (primary)", "more", "sidebar"]);
    await act(() => button(view, "more").click());
    expect(
      Menu.instances.at(-1)!.items.map((item) => item.title),
    ).not.toContain("Open PDF");
    await act(() => addNote(C));
    expect(actions()).toEqual(["note (primary)", "more", "sidebar"]);
    expect(button(view, "note").textContent).toBe("Open literature note");
    // An Item with a PDF keeps Open PDF first, as the primary button.
    await act(async () => {
      itemRow(view, B).click();
      await view.card.settled;
    });
    expect(actions()).toEqual(["pdf (primary)", "note", "more", "sidebar"]);
  });

  it("closes from its close button, gives the focus back to the row, and keeps it closed", async () => {
    const { deps, settings } = await pluginData();
    const view = await openTab(deps);
    await act(async () => {
      itemRow(view, B).click();
      await view.card.settled;
    });
    const close = card(view).querySelector<HTMLElement>(
      "[data-library-card-close]",
    )!;
    expect(close.getAttribute("aria-label")).toBe(m.library_view_card_close());
    await act(() => close.click());
    expect(view.selected).toEqual({ key: B, card: false });
    expect(document.activeElement).toBe(itemRow(view, B));
    // A pane wide enough for the card beside the list hides it too.
    expect(shownCard(view)).toBeNull();
    await act(() => settings.bridge.runPromise(settings.flush));
    expect(
      settings.bridge.runSync(settings.current)?.["library.document"]
        ?.cardClosed,
    ).toBe(true);
  });

  it("stays closed while the arrow keys move the selection, and opens again on a row click", async () => {
    const { deps, settings } = await pluginData();
    const view = await openTab(deps);
    await act(async () => {
      itemRow(view, B).click();
      await view.card.settled;
    });
    await act(() =>
      card(view)
        .querySelector<HTMLElement>("[data-library-card-close]")!
        .click(),
    );
    expect(await pressKey(view, itemRow(view, B), ["ArrowDown"])).toBe(true);
    expect(view.selected).toEqual({ key: C, card: false });
    expect(shownCard(view)).toBeNull();
    await act(async () => {
      itemRow(view, C).click();
      await view.card.settled;
    });
    expect(shownCard(view)).not.toBeNull();
    await act(() => settings.bridge.runPromise(settings.flush));
    expect(
      settings.bridge.runSync(settings.current)?.["library.document"],
    ).not.toHaveProperty("cardClosed");
    // Opened again, it follows the arrow keys beside the list once more.
    expect(await pressKey(view, itemRow(view, C), ["ArrowUp"])).toBe(true);
    expect(shownCard(view)).not.toBeNull();
  });

  it("opens again on Space on the selected row", async () => {
    const { deps } = await pluginData({
      node: { kind: "recent" },
      cardClosed: true,
    });
    const view = await openTab(deps);
    expect(await pressKey(view, itemRow(view, A), ["ArrowDown"])).toBe(true);
    expect(view.selected.key).not.toBeNull();
    expect(shownCard(view)).toBeNull();
    const key = view.selected.key!;
    expect(await pressKey(view, itemRow(view, key), [" "])).toBe(true);
    expect(shownCard(view)).not.toBeNull();
  });

  it("opens on a click or on Space on the selected row, and stays closed while the arrow keys move the selection", async () => {
    const { deps, items } = await pluginData();
    const view = await openTab(deps);
    // Space with no row selected leaves the list to scroll.
    expect(await pressKey(view, itemRow(view, A), [" "])).toBe(false);
    await act(() => itemRow(view, B).click());
    expect(view.selected).toEqual({ key: B, card: true });
    expect(await pressKey(view, itemRow(view, B), ["ArrowDown"])).toBe(true);
    expect(view.selected).toEqual({ key: C, card: false });
    expect(document.activeElement).toBe(itemRow(view, C));
    // Space on a button inside the row is the button's.
    const inside = itemRow(view, C).createEl("button");
    expect(await pressKey(view, inside, [" "])).toBe(false);
    expect(view.selected).toEqual({ key: C, card: false });
    expect(await pressKey(view, itemRow(view, C), [" "])).toBe(true);
    expect(view.selected).toEqual({ key: C, card: true });
    // Space only opens the card.
    expect(items.openNote).not.toHaveBeenCalled();
    expect(items.openPdf).not.toHaveBeenCalled();
  });

  /** The parts the card shows under its buttons, in order. */
  const parts = (view: LibraryView) =>
    [
      ...card(view).querySelectorAll<HTMLElement>("[data-library-card-part]"),
    ].map((el) => el.dataset.libraryCardPart);
  const toggle = (view: LibraryView, name: string) =>
    card(view).querySelector<HTMLElement>(
      `[data-library-card-toggle="${name}"]`,
    );
  /** Each label and value of a list of fields, `null` where the list is not shown. */
  const pairs = (view: LibraryView, part: string) => {
    const list = card(view).querySelector(`[data-library-card-part="${part}"]`);
    if (!list) return null;
    return [...list.querySelectorAll("dt")].map((dt) => [
      dt.textContent,
      dt.nextElementSibling?.textContent,
    ]);
  };
  const annotationRuns = (run: Awaited<ReturnType<typeof pluginData>>["run"]) =>
    run.mock.calls.filter(([request]) => request.from === "annotations");
  async function select(view: LibraryView, key: string) {
    await act(async () => {
      itemRow(view, key).click();
      await view.card.settled;
    });
  }
  async function open(view: LibraryView, name: string) {
    await act(async () => {
      toggle(view, name)!.click();
      await view.card.settled;
    });
  }

  /** A journal article with its files, Zotero notes and Collections, and a letter. */
  const FILLED: readonly SeedItem[] = SEED.map((item): SeedItem => {
    if (item.key === A)
      return {
        ...item,
        card: {
          "attachments[].indexedKey": ["APDFAPDF", "AWEBAWEB"],
          "attachments[].title": ["Full text PDF", "Snapshot"],
          "attachments[].fileType": ["pdf", "web"],
          notes: [{ indexedKey: "ANTEANTE", title: "Reading notes" }],
          abstractNote: "Drawing graphs for figures.",
          citationKey: "drawing2020",
          language: "en",
        },
      };
    if (item.key === B)
      return {
        ...item,
        card: {
          volume: "30",
          issue: "1",
          pages: "5998–6008",
          DOI: "10.5555/attention",
          url: "",
          citationKey: "vaswani2017",
          ISSN: "1049-5258",
          journalAbbreviation: "NeurIPS",
          language: "en",
          // A field a journal article does not have.
          eventPlace: "Long Beach",
          dateAdded: "2024-03-10T12:00:00Z",
        },
      };
    if (item.key === C) return { ...item, card: { language: "de" } };
    if (item.key === D)
      return {
        ...item,
        itemType: "letter",
        fields: {
          creators: [
            {
              role: "author",
              family: "Darwin",
              given: "Charles",
              literal: null,
              fullName: "Charles Darwin",
            },
          ],
          date: {
            kind: "date",
            value: "1859-11-24",
            year: 1859,
            month: 11,
            day: 24,
            text: null,
            raw: "1859-11-24 24 November 1859",
          },
        },
        card: {
          letterType: "Personal letter",
          // The base field the engine also gives the letter's Type under.
          type: "Personal letter",
          eventPlace: "Down House",
          DOI: "10.1000/letter",
          url: "https://example.org/letter",
          accessDate: "2024-05-01",
          archive: "Darwin Correspondence Project",
          archiveLocation: "DCP-LETT-2575",
          citationKey: "darwin1859",
          language: "en",
          rights: "CC BY",
          extra: "Original in Cambridge",
          // A field a letter does not have.
          volume: "3",
          dateAdded: "2024-05-01T12:00:00Z",
          dateModified: "2024-06-02T12:00:00Z",
        },
      };
    return item;
  });

  it("shows its parts in order under the buttons, with All fields and Annotations closed and the Annotations unread until opened", async () => {
    const { deps, run, change } = await pluginData();
    const view = await openTab(deps);
    await act(async () => {
      await change(FILLED);
      await view.query.settled;
    });
    await select(view, A);
    // The title page first, then the abstract and the info, and the
    // Annotations last.
    expect(parts(view)).toEqual([
      "type",
      "ids",
      "abstract",
      "where",
      "tags",
      "files",
      "notes",
      "footer",
      "annotations",
    ]);
    expect(
      card(view).querySelector('[data-library-card-part="type"]')!.textContent,
    ).toBe("Journal Article");
    // Two disclosures, both native buttons that say they are closed and
    // name the body they control.
    for (const name of ["fields", "annotations"]) {
      const button = toggle(view, name)!;
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("aria-expanded")).toBe("false");
      expect(button.getAttribute("aria-controls")).toBeTruthy();
    }
    expect(toggle(view, "annotations")!.textContent).toBe(
      "See all 2 annotations",
    );
    // Selecting a paper reads its first two Annotations alone, for the
    // preview, and mounts none of the Annotation Cards.
    expect(annotationRuns(run).map(([request]) => request)).toEqual([
      expect.objectContaining({
        filter: "item == this.item",
        context: { item: A },
        limit: 2,
      }),
    ]);
    expect(
      card(view).querySelector("[data-library-card-annotations]"),
    ).toBeNull();

    await open(view, "annotations");
    const button = toggle(view, "annotations")!;
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(
      document.getElementById(button.getAttribute("aria-controls")!),
    ).not.toBeNull();
    expect(annotationRuns(run).at(-1)?.[0]).toMatchObject({
      filter: "item == this.item",
      context: { item: A },
    });
  });

  it("lists the files, which open in their reader, the Zotero notes, which link to Zotero, and the tags as chips", async () => {
    const { deps, change } = await pluginData();
    const open = vi.fn(() => Promise.resolve());
    Object.assign(deps, { opener: { open } });
    const view = await openTab(deps);
    await act(async () => {
      await change(FILLED);
      await view.query.settled;
    });
    await select(view, A);
    const files = [
      ...card(view).querySelectorAll<HTMLAnchorElement>(
        '[data-library-card-part="files"] a',
      ),
    ];
    expect(files.map((a) => a.textContent)).toEqual([
      "Full text PDF",
      "Snapshot",
    ]);
    await act(() => files[0]!.click());
    expect(open).toHaveBeenCalledExactlyOnceWith(
      { kind: "attachment", attachmentKey: "APDFAPDF" },
      false,
    );
    const note = card(view).querySelector<HTMLAnchorElement>(
      '[data-library-card-part="notes"] a',
    )!;
    expect(note.textContent).toBe("Reading notes");
    expect(note.getAttribute("href")).toBe(
      "zotero://select/library/items/ANTEANTE",
    );
    expect(
      [
        ...card(view).querySelectorAll('[data-library-card-part="tags"] li'),
      ].map((el) => el.textContent),
    ).toEqual(["method", "figure"]);
  });

  it("shows where the Item sits as its Library and each Collection path", async () => {
    const { deps } = await pluginData();
    const view = await openTab(deps);
    await select(view, A);
    expect(
      [...card(view).querySelectorAll("[data-library-card-path]")].map(
        (el) => el.textContent,
      ),
    ).toEqual([
      "My Library › Thesis › Chapter 1",
      "My Library › Thesis › Chapter 2",
    ]);
    // An Item in no Collection sits in its Library.
    await select(view, E);
    expect(
      [...card(view).querySelectorAll("[data-library-card-path]")].map(
        (el) => el.textContent,
      ),
    ).toEqual(["My Library"]);
  });

  /** The header's DOI and citation key chips, `null` for one not shown. */
  const ids = (view: LibraryView) => {
    const doi = card(view).querySelector<HTMLAnchorElement>(
      "[data-library-card-doi]",
    );
    return {
      doi: doi && { text: doi.textContent, href: doi.getAttribute("href") },
      citationKey:
        card(view).querySelector("[data-library-card-citekey]")?.textContent ??
        null,
    };
  };
  const added = (view: LibraryView) =>
    card(view).querySelector("[data-library-card-added]")?.textContent ?? null;

  it("shows a journal article's Venue with volume, issue, pages and year, its DOI and citation key as chips, the date added, and its other filled fields under All fields with Zotero's labels", async () => {
    const { deps, change, items } = await pluginData();
    const view = await openTab(deps);
    await act(async () => {
      await change(FILLED);
      await view.query.settled;
    });
    await select(view, B);
    expect(shownCard(view)?.venue).toBe(
      "Advances in Neural Information Processing Systems, 30(1), 5998–6008 · 2017",
    );
    expect(ids(view)).toEqual({
      doi: {
        text: "doi:10.5555/attention",
        href: "https://doi.org/10.5555/attention",
      },
      citationKey: "vaswani2017",
    });
    await act(() =>
      card(view)
        .querySelector<HTMLElement>("[data-library-card-copy]")!
        .click(),
    );
    expect(items.copyCitationKey).toHaveBeenCalledExactlyOnceWith(B);
    expect(added(view)).toBe("Added March 10, 2024");
    expect(pairs(view, "fields")).toBeNull();
    await open(view, "fields");
    // The editor is no author, so the header leaves the creators to All
    // fields; the year says all of the date.
    expect(pairs(view, "fields")).toEqual([
      ["Creators", "Ashish Vaswani; Noam Shazeer; Isabelle Guyon"],
      ["Journal Abbr", "NeurIPS"],
      ["ISSN", "1049-5258"],
      ["Language", "en"],
    ]);
  });

  it("names every author in full up to ten, then et al., with the rest under All fields", async () => {
    const { deps, change } = await pluginData();
    const view = await openTab(deps);
    const authors = Array.from({ length: 12 }, (_, index) => ({
      role: "author",
      family: `Author${index + 1}`,
      given: "Ada",
      literal: null,
    }));
    await act(async () => {
      await change(
        SEED.map((item) =>
          item.key === C ? { ...item, fields: { creators: authors } } : item,
        ),
      );
      await view.query.settled;
    });
    await select(view, C);
    expect(shownCard(view)?.creators).toBe(
      "Ada Author1, Ada Author2, Ada Author3, Ada Author4, Ada Author5, Ada Author6, Ada Author7, Ada Author8, Ada Author9, Ada Author10 et al.",
    );
    await open(view, "fields");
    expect(pairs(view, "fields")?.[0]?.[1]).toContain(
      "Ada Author11; Ada Author12",
    );
  });

  it("shows a letter's year under its title, and its full date, URL and other filled fields in a letter's order", async () => {
    const { deps, change } = await pluginData();
    const view = await openTab(deps);
    await act(async () => {
      await change(FILLED);
      await view.query.settled;
    });
    await select(view, D);
    expect(
      card(view).querySelector('[data-library-card-part="type"]')!.textContent,
    ).toBe("Letter");
    expect(shownCard(view)).toMatchObject({
      creators: "Charles Darwin",
      venue: "1859",
    });
    expect(ids(view)).toEqual({
      doi: {
        text: "doi:10.1000/letter",
        href: "https://doi.org/10.1000/letter",
      },
      citationKey: "darwin1859",
    });
    expect(added(view)).toBe("Added May 1, 2024");
    await open(view, "fields");
    // In Zotero's order for a letter; the creators are all in the header.
    expect(pairs(view, "fields")).toEqual([
      ["Type", "Personal letter"],
      ["Date", "November 24, 1859"],
      ["Event Place", "Down House"],
      ["URL", "https://example.org/letter"],
      ["Accessed", "May 1, 2024"],
      ["Archive", "Darwin Correspondence Project"],
      ["Loc. in Archive", "DCP-LETT-2575"],
      ["Language", "en"],
      ["License", "CC BY"],
      ["Extra", "Original in Cambridge"],
      ["Modified", "June 2, 2024"],
    ]);
    // The URL is a link.
    expect(
      card(view)
        .querySelector('[data-library-card-fact="url"] a')
        ?.getAttribute("href"),
    ).toBe("https://example.org/letter");
  });

  it("remembers All fields and Annotations open for the Library View, across Items and when the tab opens again", async () => {
    const { deps, settings, run, change } = await pluginData();
    const view = await openTab(deps);
    await act(async () => {
      await change(FILLED);
      await view.query.settled;
    });
    await select(view, A);
    await open(view, "fields");
    await open(view, "annotations");
    await select(view, C);
    expect(toggle(view, "fields")!.getAttribute("aria-expanded")).toBe("true");
    expect(toggle(view, "annotations")!.getAttribute("aria-expanded")).toBe(
      "true",
    );
    // Open, the Annotations of the next Item are read as it shows.
    expect(annotationRuns(run).at(-1)?.[0]).toMatchObject({
      context: { item: C },
    });
    await act(() => settings.bridge.runPromise(settings.flush));
    expect(
      settings.bridge.runSync(settings.current)?.["library.document"],
    ).toMatchObject({
      card: { allFields: true, annotations: true },
    });
    await act(() => view.close());
    const again = await openTab(deps);
    await select(again, A);
    expect(toggle(again, "fields")!.getAttribute("aria-expanded")).toBe("true");
    await open(again, "fields");
    expect(toggle(again, "fields")!.getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  /** A's Annotations: a highlight, a comment alone, an area, a second highlight. */
  const MARKED: readonly SeedItem[] = SEED.map((item) =>
    item.key === A
      ? {
          ...item,
          marks: [
            {
              key: "AANNOT01",
              values: {
                type: "highlight",
                color: "#FFD400",
                text: "Scientific visualization is classically defined.",
                comment: "",
                pageLabel: "1",
              },
            },
            {
              key: "AANNOT02",
              values: {
                type: "note",
                color: "#5fb236",
                text: "",
                comment: "Making figures is hard",
                pageLabel: "1",
              },
            },
            {
              key: "AANNOT03",
              values: { type: "image", color: "#ff6666", pageLabel: "3" },
            },
            {
              key: "AANNOT04",
              values: { type: "highlight", color: "#ffd400", text: "Later" },
            },
          ],
        }
      : item,
  );
  const quotes = (view: LibraryView) =>
    [
      ...card(view).querySelectorAll<HTMLElement>("[data-library-card-quote]"),
    ].map((el) => [el.dataset.libraryCardQuote, el.textContent]);
  const colours = (view: LibraryView) =>
    [
      ...card(view).querySelectorAll<HTMLElement>("[data-library-card-colour]"),
    ].map((el) => el.textContent);

  it("previews the first two Annotations as quotes with their page, under the count of each colour as text, and mounts every Annotation Card from See all", async () => {
    const { deps, run, change } = await pluginData();
    const view = await openTab(deps);
    await act(async () => {
      await change(MARKED);
      await view.query.settled;
    });
    await select(view, A);
    expect(
      card(view).querySelector(
        '[data-library-card-part="annotations"] [role="heading"]',
      )?.textContent,
    ).toBe("Your annotations");
    // Each colour names itself and its count in text, in Zotero's order.
    expect(colours(view)).toEqual(["Yellow: 2", "Red: 1", "Green: 1"]);
    expect(quotes(view)).toEqual([
      [
        "quote",
        `“Scientific visualization is classically defined.”${m.annot_view_page({ page: "1" })}`,
      ],
      [
        "note",
        `Making figures is hard${m.annot_view_page({ page: "1" })} · note`,
      ],
    ]);
    // The preview reads the paths it quotes, and two Annotations alone.
    expect(annotationRuns(run).at(-1)?.[0]).toMatchObject({
      limit: 2,
      fields: ["type", "text", "comment", "color", "pageLabel"],
    });
    expect(
      card(view).querySelector("[data-library-card-annotations]"),
    ).toBeNull();
    const runs = annotationRuns(run).length;
    await open(view, "annotations");
    expect(
      card(view).querySelector("[data-library-card-annotations]"),
    ).not.toBeNull();
    // Every Annotation, with no limit, for the Annotation Cards.
    expect(annotationRuns(run)).toHaveLength(runs + 1);
    expect(annotationRuns(run).at(-1)?.[0]).toMatchObject({
      filter: "item == this.item",
      context: { item: A },
    });
    expect(annotationRuns(run).at(-1)?.[0].limit ?? null).toBeNull();
    // The cards take the quotes' place.
    expect(quotes(view)).toEqual([]);
    expect(toggle(view, "annotations")!.textContent).toBe("Hide annotations");
  });

  it("previews an area as an image and an ink drawing as a drawing, each with its page", async () => {
    const { deps, change } = await pluginData();
    const view = await openTab(deps);
    await act(async () => {
      await change(
        MARKED.map((item) =>
          item.key === A
            ? {
                ...item,
                marks: [
                  item.marks![2]!,
                  {
                    key: "AANNOT05",
                    values: { type: "ink", color: "#2ea8e5", pageLabel: "4" },
                  },
                ],
              }
            : item,
        ),
      );
      await view.query.settled;
    });
    await select(view, A);
    expect(quotes(view)).toEqual([
      ["image", `Image · ${m.annot_view_page({ page: "3" })}`],
      ["image", `Drawing · ${m.annot_view_page({ page: "4" })}`],
    ]);
    expect(toggle(view, "annotations")!.textContent).toBe(
      "See all 2 annotations",
    );
  });

  it("leaves out every part an Item has nothing for", async () => {
    const { deps } = await pluginData();
    const view = await openTab(deps);
    // E has a tag and nothing else: no fields, abstract, file, note or Annotation.
    await select(view, E);
    expect(parts(view)).toEqual(["type", "where", "tags"]);
    expect(toggle(view, "fields")).toBeNull();
    expect(toggle(view, "annotations")).toBeNull();
    expect(card(view).textContent).not.toMatch(/\b0\b/);
  });

  it("cuts a long abstract to a few lines, with Show more and Show less", async () => {
    const { deps, change } = await pluginData();
    const view = await openTab(deps);
    await act(async () => {
      await change(
        SEED.map((item) =>
          item.key === B
            ? {
                ...item,
                card: {
                  abstractNote:
                    "Attention alone carries a sequence model. ".repeat(8),
                },
              }
            : item,
        ),
      );
      await view.query.settled;
    });
    await select(view, B);
    const abstract = card(view).querySelector<HTMLElement>(
      "[data-library-card-abstract]",
    )!;
    expect(abstract.className).toContain("line-clamp-4");
    const more = toggle(view, "abstract")!;
    expect(more.textContent).toBe("Show more");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    await act(() => more.click());
    expect(abstract.className).not.toContain("line-clamp-4");
    expect(toggle(view, "abstract")!.textContent).toBe("Show less");
  });

  it("leaves Enter and the arrow keys inside the card to the card", async () => {
    const { deps, items } = await pluginData();
    const view = await openTab(deps);
    await act(async () => {
      itemRow(view, B).click();
      await view.card.settled;
    });
    const inside = card(view).createDiv();
    expect(await pressKey(view, inside, ["Enter"])).toBe(false);
    expect(await pressKey(view, inside, ["ArrowDown"])).toBe(false);
    expect(items.openNote).not.toHaveBeenCalled();
  });
});

it("says in the Save as query file dialog, from the toolbar button, what the file leaves out, and offers the selected Collection's name", async () => {
  const { deps } = await pluginData();
  Object.assign(deps.app, {
    fileManager: {
      getNewFileParent: () => ({ isRoot: () => true, path: "/" }),
    },
  });
  deps.app.workspace.getActiveFile = () => null;
  Object.assign(deps.app, {
    keymap: { pushScope: () => {}, popScope: () => {} },
  });
  const view = await openTab(deps);
  await press(view, row(view, THESIS));
  await press(view, facet(view, "has-note"));
  await type(view, "figures");
  Modal.instances.length = 0;
  await act(() =>
    view.contentEl.querySelector<HTMLElement>("[data-query-save-as]")!.click(),
  );
  await vi.waitFor(() => expect(Modal.instances).toHaveLength(1));
  const modal = Modal.instances[0]!;
  modal.onOpen();
  expect(
    [...modal.contentEl.querySelectorAll("[data-save-left-out]")].map(
      (el) => el.textContent,
    ),
  ).toEqual([
    m.library_view_save_leaves_out_facets({
      facets: m.library_view_facet_has_note(),
    }),
    m.library_view_save_leaves_out_search(),
  ]);
  const name = [...modal.contentEl.querySelectorAll<HTMLElement>("label")]
    .flatMap((label) => controlsOf(label.lastElementChild as HTMLElement))
    .find((control) => control instanceof TextComponent);
  expect(name?.getValue()).toBe("Thesis");
  modal.close();
});

describe("Tag Selector", () => {
  // Of My Library's A–E: A has method and figure, B talk, C method, D
  // figure, E method. Lab's F has lab-meeting.
  /** The tag names on screen, in order. */
  function tags(view: LibraryView) {
    return [
      ...view.contentEl.querySelectorAll<HTMLElement>("[data-library-tag]"),
    ].map((el) => el.dataset.libraryTag);
  }

  /** The selected tags on screen. */
  function pressed(view: LibraryView) {
    return [
      ...view.contentEl.querySelectorAll<HTMLElement>(
        '[data-library-tag][aria-pressed="true"]',
      ),
    ].map((el) => el.dataset.libraryTag);
  }

  function tag(view: LibraryView, name: string): HTMLElement {
    const found = [
      ...view.contentEl.querySelectorAll<HTMLElement>("[data-library-tag]"),
    ].find((el) => el.dataset.libraryTag === name);
    if (!found) throw new Error(`No tag ${name}`);
    return found;
  }

  function deselectAll(view: LibraryView) {
    return view.contentEl.querySelector<HTMLElement>(
      "[data-library-tags-clear]",
    );
  }

  /** Type `text` into the "Filter tags" box. */
  async function filterTags(view: LibraryView, text: string) {
    await act(async () => {
      const input = view.contentEl.querySelector<HTMLInputElement>(
        "[data-library-tags-filter]",
      )!;
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await view.tree.settled;
    });
  }

  it("lists the tags of the Items the selected node lists, by name", async () => {
    const { deps } = await pluginData();
    const view = await openTab(deps);
    // Recent reads My Library and Lab, the Library Scope.
    expect(tags(view)).toEqual(["figure", "lab-meeting", "method", "talk"]);
    await press(view, row(view, MY_LIBRARY));
    expect(tags(view)).toEqual(["figure", "method", "talk"]);
    await press(view, row(view, { ...THESIS, path: ["Reading list"] }));
    expect(tags(view)).toEqual(["figure"]);
  });

  it("narrows the list to the Items with a tag, and with every tag selected", async () => {
    const { deps } = await pluginData();
    const view = await openTab(deps);
    await press(view, row(view, MY_LIBRARY));
    await press(view, tag(view, "method"));
    expect(pressed(view)).toEqual(["method"]);
    expect(listed(view)).toEqual(["AAAAAAAA", "CCCCCCCC", "EEEEEEEE"]);
    // Only the tags of A, C and E are left to narrow by.
    expect(tags(view)).toEqual(["figure", "method"]);
    await press(view, tag(view, "figure"));
    expect(pressed(view)).toEqual(["figure", "method"]);
    expect(listed(view)).toEqual(["AAAAAAAA"]);
    // A second press lets go of a tag.
    await press(view, tag(view, "method"));
    expect(listed(view)).toEqual(["AAAAAAAA", "DDDDDDDD"]);
  });

  it("shows the selected tags as chips under the heading, on Recent too", async () => {
    const { deps } = await pluginData();
    const view = await openTab(deps);
    expect(filterChips(view)).toEqual([]);
    await press(view, tag(view, "method"));
    expect(header(view)).toBe("Recent | 3 papers");
    expect(filterChips(view)).toEqual(["tag:method"]);
    await press(view, row(view, MY_LIBRARY));
    await press(view, tag(view, "figure"));
    expect(header(view)).toBe("My Library | 1 of 5 papers · 2 unread");
    expect(filterChips(view)).toEqual(["tag:figure", "tag:method"]);
  });

  it("removes a facet or a tag from its chip under the heading, which names what it removes", async () => {
    const { deps, settings } = await pluginData(ON_MY_LIBRARY);
    const view = await openTab(deps);
    await press(view, facet(view, "annotated"));
    await press(view, tag(view, "figure"));
    expect(listed(view)).toEqual(["AAAAAAAA"]);
    expect(filterChips(view)).toEqual(["facet:annotated", "tag:figure"]);
    const chip = (key: string) =>
      view.contentEl.querySelector<HTMLElement>(
        `[data-library-filter="${key}"]`,
      )!;
    // A control: its name is its tooltip.
    expect(chip("tag:figure").getAttribute("role")).toBe("button");
    expect(chip("tag:figure").getAttribute("aria-label")).toBe(
      m.library_view_heading_remove_filter({ name: "figure" }),
    );
    await press(view, chip("facet:annotated"));
    expect(facet(view, "annotated").getAttribute("aria-pressed")).toBe("false");
    // A and D carry the figure tag.
    expect(listed(view)).toEqual(["AAAAAAAA", "DDDDDDDD"]);
    expect(filterChips(view)).toEqual(["tag:figure"]);
    await press(view, chip("tag:figure"));
    expect(pressed(view)).toEqual([]);
    expect(listed(view)).toHaveLength(5);
    // With nothing on, the chips and Clear all go.
    expect(filterChips(view)).toEqual([]);
    expect(
      view.contentEl.querySelector("[data-library-filter-clear]"),
    ).toBeNull();
    await act(() => settings.bridge.runPromise(settings.flush));
    expect(
      settings.bridge.runSync(settings.current)?.["library.document"],
    ).toMatchObject({
      facets: [],
      tags: [],
    });
  });

  it("clears every facet and tag from Clear all, in one run of the list", async () => {
    const { deps, run, settings } = await pluginData(ON_MY_LIBRARY);
    const view = await openTab(deps);
    await press(view, facet(view, "pdf"));
    await press(view, tag(view, "method"));
    expect(listed(view)).toEqual(["AAAAAAAA"]);
    const runs = listRuns(run).length;
    await press(
      view,
      view.contentEl.querySelector<HTMLElement>("[data-library-filter-clear]")!,
    );
    expect(listRuns(run)).toHaveLength(runs + 1);
    expect(listed(view)).toHaveLength(5);
    expect(pressed(view)).toEqual([]);
    expect(facet(view, "pdf").getAttribute("aria-pressed")).toBe("false");
    expect(header(view)).toBe("My Library | 5 papers · 2 unread");
    await act(() => settings.bridge.runPromise(settings.flush));
    expect(
      settings.bridge.runSync(settings.current)?.["library.document"],
    ).toMatchObject({
      facets: [],
      tags: [],
    });
  });

  it("deselects every tag at once, and offers that only while one is selected", async () => {
    const { deps } = await pluginData(ON_MY_LIBRARY);
    const view = await openTab(deps);
    expect(deselectAll(view)).toBeNull();
    await press(view, tag(view, "method"));
    await press(view, tag(view, "figure"));
    await press(view, deselectAll(view)!);
    expect(pressed(view)).toEqual([]);
    expect(listed(view)).toHaveLength(5);
    expect(header(view)).toBe("My Library | 5 papers · 2 unread");
    expect(deselectAll(view)).toBeNull();
  });

  it("selects a tag the Reading Card shows, beside those selected already", async () => {
    const { deps, settings } = await pluginData(ON_MY_LIBRARY);
    const view = await openTab(deps);
    await press(view, tag(view, "method"));
    await act(async () => {
      itemRow(view, "AAAAAAAA").click();
      await view.card.settled;
    });
    const chip = (name: string) =>
      view.contentEl.querySelector<HTMLElement>(
        `[data-library-card] [data-library-card-tag="${name}"]`,
      )!;
    expect(chip("figure").getAttribute("role")).toBe("button");
    await press(view, chip("figure"));
    expect(pressed(view)).toEqual(["figure", "method"]);
    expect(listed(view)).toEqual(["AAAAAAAA"]);
    expect(header(view)).toBe("My Library | 1 of 5 papers · 2 unread");
    expect(filterChips(view)).toEqual(["tag:figure", "tag:method"]);
    expect(
      settings.bridge.runSync(settings.current)?.["library.document"]?.tags,
    ).toEqual(["figure", "method"]);
    // A tag selected already stays selected.
    await press(view, chip("method"));
    expect(pressed(view)).toEqual(["figure", "method"]);
  });

  it("filters the tag names it shows, never the papers, and keeps a selected tag in view", async () => {
    const { deps, run } = await pluginData(ON_MY_LIBRARY);
    const view = await openTab(deps);
    await press(view, tag(view, "talk"));
    const runs = listRuns(run).length;
    await filterTags(view, "FIG");
    expect(tags(view)).toEqual(["talk"]);
    await press(view, deselectAll(view)!);
    await filterTags(view, "FIG");
    expect(tags(view)).toEqual(["figure"]);
    expect(listed(view)).toHaveLength(5);
    // The box asked the list nothing.
    expect(listRuns(run)).toHaveLength(runs + 1);
  });

  it("keeps the selected tags on another node, where they still show though no Item there has them", async () => {
    const { deps, settings } = await pluginData(ON_MY_LIBRARY);
    const view = await openTab(deps);
    await press(view, tag(view, "talk"));
    await press(view, row(view, { ...THESIS, path: ["Reading list"] }));
    expect(listed(view)).toEqual([]);
    expect(tags(view)).toEqual(["talk"]);
    expect(pressed(view)).toEqual(["talk"]);
    expect(
      view.contentEl.querySelector("[data-query-empty]")?.textContent,
    ).toBe(m.library_view_empty_facets());
    await settings.bridge.runPromise(settings.flush);
    expect(
      settings.bridge.runSync(settings.current)?.["library.document"]?.tags,
    ).toEqual(["talk"]);
  });

  it("opens again with the tags the researcher left selected", async () => {
    const { deps } = await pluginData({
      ...ON_MY_LIBRARY,
      tags: ["figure", "method"],
    });
    const view = await openTab(deps);
    expect(pressed(view)).toEqual(["figure", "method"]);
    expect(listed(view)).toEqual(["AAAAAAAA"]);
  });

  it("lists the tags again after a database change", async () => {
    const { deps, change } = await pluginData(ON_MY_LIBRARY);
    const view = await openTab(deps);
    await act(async () => {
      await change([
        ...SEED,
        { key: "JJJJJJJJ", libraryID: 1, collections: [], tags: ["pitfall"] },
      ]);
      await view.tree.settled;
    });
    expect(tags(view)).toEqual(["figure", "method", "pitfall", "talk"]);
  });

  it("lets go of the selected tags to show an Item they leave out", async () => {
    const { deps } = await pluginData(ON_MY_LIBRARY);
    const view = await openTab(deps);
    await press(view, tag(view, "talk"));
    await act(async () => {
      await view.reveal(A);
    });
    expect(pressed(view)).toEqual([]);
    expect(itemRows(view)).toContain(`${A} *`);
  });

  it("names the tags for a screen reader by their heading, each a toggle button, with one stop for Tab and the arrow keys between them", async () => {
    const { deps } = await pluginData(ON_MY_LIBRARY);
    const view = await openTab(deps);
    const pane = view.contentEl.querySelector("[data-library-tree]")!;
    expect(pane.querySelectorAll("[aria-label]")).toHaveLength(0);
    const group = pane.querySelector("[data-library-tags]")!;
    expect(group.getAttribute("role")).toBe("group");
    expect(accessibleName(group)).toBe(m.library_view_tags_label());
    const names = [
      ...group.querySelectorAll<HTMLElement>("[data-library-tag]"),
    ];
    expect(names.map((el) => el.getAttribute("role"))).toEqual([
      "button",
      "button",
      "button",
    ]);
    expect(names.map((el) => el.tabIndex)).toEqual([0, -1, -1]);
    const input = pane.querySelector("[data-library-tags-filter]")!;
    expect(accessibleName(input)).toBe(m.library_view_tags_filter());
    await act(async () => {
      names[0]!.focus();
      names[0]!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(tag(view, "method"));
    expect(tag(view, "method").tabIndex).toBe(0);
    await act(async () => {
      tag(view, "method").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      await view.query.settled;
      await view.tree.settled;
    });
    expect(pressed(view)).toEqual(["method"]);
  });
});

// #1710: a shared item gesture finishes after the last Library tab closes.
effectIt.live(
  "opens the created note after the last Library tab closes during creation planning",
  () =>
    Effect.promise(async () => {
      const item = makeItem({ itemType: "journalArticle", title: "Paper" });
      let created = Promise.withResolvers<TFile>();
      let cancelled = false;
      const planCreations = vi.fn<NoteFeature["Service"]["planCreations"]>(
        (keys) =>
          Effect.promise((signal) => {
            signal.addEventListener(
              "abort",
              () => {
                cancelled = true;
              },
              { once: true },
            );
            return created.promise.then(
              (file) =>
                new Map(
                  keys.map((key) => [
                    key,
                    {
                      item,
                      selection: {
                        selector: "default" as const,
                        source: "match" as const,
                        shouldAsk: false,
                        reason: "Fixture match",
                      },
                      previews: [
                        {
                          selector: "default" as const,
                          label: undefined,
                          folder: "literatures",
                          citationStyle: null,
                          document: undefined,
                          path: file.path,
                          create: () =>
                            Effect.succeed({
                              outcome: "created" as const,
                              file,
                            }),
                        },
                      ],
                    },
                  ]),
                ),
            );
          }),
      );
      const workspace = new MemoryWorkspace();
      const openLinkText = vi.spyOn(workspace, "openLinkText");
      const { deps, host } = await pluginData(
        undefined,
        item,
        Layer.mergeAll(
          Layer.mock(NoteFeature, { planCreations }),
          layerWorkspaceFrom(workspace),
          Layer.mock(ZoteroPref, {
            current: Effect.succeed(
              stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", {
                dataDir: "",
              }),
            ),
          }),
        ),
      );
      const pluginLifetime = new DisposableStack();
      cleanup.defer(() => pluginLifetime.dispose());
      registerLibraryView(
        stubService<Plugin>("Plugin", {
          app: deps.app,
          register: (release) => pluginLifetime.defer(release),
          registerView: () => {},
          addCommand: (command) => command,
          addRibbonIcon: () => document.createElement("div"),
        }),
        deps,
      );
      const view = await openTab(deps);
      const actions = itemActions({
        app: deps.app,
        registry: deps.registry,
        opener: deps.opener,
        noteFeature: { renderCitation: () => "" },
        creation: {
          app: deps.app,
          createProfile: vi.fn(),
          importProfile: vi.fn(),
        },
      });
      const opening = actions.openNote(item.indexedKey, "tab");
      await waitFor(() => expect(planCreations).toHaveBeenCalledOnce());
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      cleanup.defer(() => void vi.useRealTimers());
      await view.close();
      await vi.advanceTimersByTimeAsync(10);
      const file = host.vault.addFile("literatures/paper.md", "Paper");
      created.resolve(file);
      await opening;
      expect(openLinkText).toHaveBeenCalledWith(file.path, "", "tab", {
        active: true,
      });
      created = Promise.withResolvers<TFile>();
      const interrupted = actions.openNote(item.indexedKey, "tab");
      await waitFor(() => expect(planCreations).toHaveBeenCalledTimes(2));
      pluginLifetime.dispose();
      await vi.advanceTimersByTimeAsync(10);
      await interrupted;
      expect(cancelled).toBe(true);
      created.resolve(file);
      expect(openLinkText).toHaveBeenCalledOnce();
    }),
);
