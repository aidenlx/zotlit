// @vitest-environment happy-dom
// The Library View tab runs the query its Library View Document derives: the
// document plugin data holds when the tab opens, and after a toolbar change,
// the same query when the tab opens again.
import { Menu, resetMockPlatform, setMockPlatform } from "@mock/obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { testItemSeed } from "@zotlit/item-query";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import {
  createObsidianHost,
  PluginStub,
} from "@/lib/__fixtures__/obsidian-host";
import { Effect } from "@/lib/effect";
import * as m from "@/lib/i18n/generated/messages";
import type { SearchHit, SearchOptions } from "@/services/item-lookup/service";
import type {
  QueryViewOutcome,
  QueryViewRequest,
  QueryViewValue,
} from "@/services/item-query/query-view";
import type {
  AvailableLibrary,
  LibraryScope,
  LibrarySelector,
  ResolvedLibraryScope,
} from "@/services/library-scope/scope";
import { selectorKey } from "@/services/library-scope/scope";
import { QueryClientService } from "@/services/query-client/service";
import { SettingsService } from "@/services/settings/service";
import { requested } from "@/views/query-view/__fixtures__/query-run";
import { openWelcomeView } from "@/views/welcome/register";

import type { LibraryNode } from "./document";
import { nodeKey } from "./library-tree";
import { openLibraryView } from "./register";
import { LibraryView } from "./view";
import type { LibraryViewDeps } from "./view";

vi.mock("zustand", () => import("../__fixtures__/zustand"));

const EMPTY = {
  kind: "result",
  result: {
    libraries: [{ type: "personal" }],
    query: {} as never,
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
    tags: ["method"],
  },
  {
    key: "BBBBBBBB",
    libraryID: 1,
    collections: ["Thesis/Chapter 2"],
    pdf: true,
    title: "Notes on attention",
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
  },
  { key: "EEEEEEEE", libraryID: 1, collections: [], tags: ["method"] },
  {
    key: "FFFFFFFF",
    libraryID: 2,
    collections: ["Thesis"],
    title: "Figures in the lab",
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
 * ZotLit Query over {@link SEED}. A grouped request groups as the engine
 * does: an Item joins one group for each Collection it is filed in, or the
 * `null` group for none. A list request answers the Items its filter selects,
 * in seed order.
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
  // The fake database holds no Annotation.
  if (request.from === "annotations") return EMPTY;
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
  if (request.group !== "collections[]") {
    const rows = items
      .filter(
        (item) => ids.has(item.libraryID) && selects(request.filter, item),
      )
      // The engine lists an Item's Collections as sorted joined paths.
      .map(({ key, collections, title, fields, attachments }) => ({
        indexedKey: key,
        values: {
          collections: collections.toSorted(),
          ...(attachments && { "attachments[].indexedKey": [...attachments] }),
          ...(title !== undefined && { title }),
          ...fields,
        },
      }));
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
  const matched = items.filter(({ libraryID }) => ids.has(libraryID));
  const groups = new Map<string | null, SeedItem[]>();
  for (const item of matched)
    for (const value of item.collections.length > 0 ? item.collections : [null])
      groups.set(value, [...(groups.get(value) ?? []), item]);
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
        rows: rows.map(({ key }) => ({ indexedKey: key, values: {} })),
      })),
    },
  };
}

/** Plugin data with `stored` as its Library View Document, still loading. */
function pluginData(stored?: unknown) {
  setMockPlatform({ isMacOS: true });
  cleanup.defer(resetMockPlatform);
  const host = createObsidianHost({});
  const plugin = new PluginStub(host.app as unknown as App, {
    __VERSION__: 10,
    ...(stored !== undefined && { "library.document": stored }),
  });
  const settings = cleanup.use(
    new SettingsService({
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
  const reads = createNanoEvents<Record<string, () => void>>();
  /** What the database service says of Zotero's database. */
  const database_ = {
    state: "ready" as "ready" | "degraded",
    error: null as Error | null,
  };
  const readsDeps = {
    on: reads.on.bind(reads),
    get state() {
      return database_.state;
    },
    get error() {
      return database_.error;
    },
    ready: Promise.resolve({
      reads: { ConnectionReadout: () => Effect.succeed({ itemCount: 8 }) },
    }),
  };
  const setupActions = {
    openSettings: vi.fn(),
    pickFolder: vi.fn(),
    searchLibrary: vi.fn(),
    locateZotero: vi.fn(),
  };
  const notes = new Set(NOTED);
  const notesChanged = createNanoEvents<{ changed: () => void }>();
  const literatureNotes = {
    find: (itemKey: string) =>
      notes.has(itemKey) ? { path: `${itemKey}.md`, basename: itemKey } : null,
    on: (_event: "changed", listener: () => void) =>
      notesChanged.on("changed", listener),
    open: vi.fn(),
  };
  const items = {
    openNote: vi.fn(() => Promise.resolve()),
    openPdf: vi.fn(() => Promise.resolve()),
    insertCitation: vi.fn(() => Promise.resolve()),
    copyCitationKey: vi.fn(() => Promise.resolve()),
    showInZotero: vi.fn(),
  };
  const scopeEvents = createNanoEvents<{ changed: () => void }>();
  const off = () => () => {};
  // The saved scope also names a group the database no longer holds.
  const libraryScope = {
    on: scopeEvents.on.bind(scopeEvents),
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
  const search = (query: string, opts?: SearchOptions) => {
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
  const deps = {
    app: {
      ...host.app,
      scope: undefined,
      workspace: { ...host.workspace, leftSplit: null, rightSplit: null },
    },
    reads: {
      ...readsDeps,
      acquireRead: () =>
        Promise.resolve({
          reads: {
            CollectionPaths: ({
              libraryIDs,
            }: {
              libraryIDs: readonly number[];
            }) =>
              Effect.succeed(libraryIDs.flatMap((id) => PATHS.get(id) ?? [])),
          },
          [Symbol.asyncDispose]: () => Promise.resolve(),
        }),
    },
    libraryScope,
    query: { run },
    lookup: {
      openSession: () => ({
        search,
        close: () => {},
        [Symbol.dispose]: () => {},
      }),
    },
    cardFocus: { hold: () => ({ [Symbol.dispose]: () => {} }) },
    annotations: { on: off, hold: () => ({ [Symbol.dispose]: () => {} }) },
    items,
    settings,
    welcome: {
      app: host.app,
      reads: readsDeps,
      queries: new QueryClientService(),
      zoteroPref: { dataDir: "/Zotero" },
      settings,
      setupActions,
      templateMigration: { convert: vi.fn(), retryCleanup: vi.fn() },
      release: { hasV1Templates: () => false, acknowledgeMigration: vi.fn() },
    },
    literatureNotes,
    readers: { open: () => Promise.resolve() },
  } as unknown as LibraryViewDeps;
  /** Zotero's database changes to hold `items`, and says so. */
  const change = (items: readonly SeedItem[]) => {
    database.items = items;
    reads.emit("changed");
  };
  /** The data folder ZotLit reads can no longer be found. */
  const lose = () => {
    database_.state = "degraded";
    database_.error = new Error("No zotero.sqlite in the data folder");
    reads.emit("degraded");
  };
  /** A refresh of the database fails; the earlier connection still reads. */
  const refreshFails = () => {
    database_.error = new Error("EACCES: zotero.sqlite");
    reads.emit("refresh-failed");
  };
  /** The researcher pointed ZotLit at the data folder, and it reads again. */
  const locate = () => {
    database_.state = "ready";
    database_.error = null;
    reads.emit("changed");
  };
  /** The vault gains a Literature Note for `itemKey`. */
  const addNote = (itemKey: string) => {
    notes.add(itemKey);
    notesChanged.emit("changed");
  };
  /**
   * The researcher saves a Library Scope of the Libraries `available` and
   * those `missing` from the database.
   */
  const rescope = (
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
    locate,
    setupActions,
  };
}

/**
 * The requests of the list: without the count requests of the Library Tree,
 * which read no field, and without the Reading Card's reads of one Item.
 */
function listRuns(run: ReturnType<typeof pluginData>["run"]) {
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

function header(view: LibraryView) {
  return view.contentEl.querySelector("[data-library-header]")?.textContent;
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
  const view = new OpenView(
    {
      app: deps.app,
      getRoot: () => null,
    } as unknown as WorkspaceLeaf,
    deps,
  );
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

it("opens on Recent, every Library in the Library Scope newest change first, where plugin data holds no document", async () => {
  const { deps, run } = pluginData();
  const view = await openTab(deps);
  expect(listRuns(run)).toHaveLength(1);
  const [request] = listRuns(run) as [QueryViewRequest];
  expect(request).toMatchObject({
    from: "items",
    libraries: { mode: "selected", libraries: [PERSONAL, LAB] },
    sort: [{ field: "dateModified", direction: "desc" }],
  });
  expect(row(view, RECENT).getAttribute("aria-selected")).toBe("true");
  // Recent counts no papers: its list is the whole Library Scope.
  expect(header(view)).toBe("Recent");
  // A large library shows its newest rows; the toolbar says how many match.
  expect(request.limit).toBe(1000);
  expect(request).not.toHaveProperty("filter");
  expect(request).not.toHaveProperty("context");
});

it("opens on the document plugin data holds, once it has loaded", async () => {
  const { deps, run } = pluginData({
    node: {
      kind: "collection",
      library: { type: "group", groupID: 4815 },
      path: ["Thesis"],
    },
    facets: [],
    search: "",
    sort: [{ property: "title", direction: "ASC" }],
    layout: "table",
    order: ["title"],
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

it("opens on every field of the document plugin data holds that it can read, where one facet is unknown", async () => {
  const { deps, run } = pluginData({
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
  expect(view.query.state.getState().view?.type).toBe("table");
});

it("opens again on a sort the toolbar changed, and runs the query the toolbar ran", async () => {
  const { deps, run } = pluginData();
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
  const { deps } = pluginData();
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
  const { deps } = pluginData();
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

it("lists a Collection with its subcollections' Items, names it in the header, and keeps it", async () => {
  const { deps, run, settings } = pluginData();
  const view = await openTab(deps);
  await press(view, row(view, THESIS));
  expect(listRuns(run).at(-1)).toMatchObject({
    libraries: { mode: "selected", libraries: [PERSONAL] },
    filter: 'collections.within("Thesis")',
  });
  expect(row(view, THESIS).getAttribute("aria-selected")).toBe("true");
  expect(header(view)).toBe("Thesis · 3 papers · 1 unread");
  await settings.flush();
  expect(settings.current?.["library.document"]?.node).toEqual(THESIS);
});

it("lists a group library on its own, with no filter", async () => {
  const { deps, run } = pluginData();
  const view = await openTab(deps);
  await press(view, row(view, THESIS));
  await press(view, row(view, { kind: "library", library: LAB }));
  const last = listRuns(run).at(-1)!;
  expect(last.libraries).toEqual({ mode: "selected", libraries: [LAB] });
  expect(last).not.toHaveProperty("filter");
  expect(header(view)).toBe("Lab · 2 papers · 2 unread");
});

it("shows the libraries outside the Library Scope on request, and lists one", async () => {
  const { deps, run } = pluginData();
  const view = await openTab(deps);
  const all = () =>
    view.contentEl.querySelector<HTMLElement>("[data-library-all]")!;
  expect(all().textContent).toBe("Show all libraries");
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
  // The selected library stays in the tree while it shows the scope alone.
  await press(view, all());
  expect(tree(view).at(-1)).toBe("Archive 1");
});

it("opens again on the node the tree selected", async () => {
  const { deps, run } = pluginData();
  const first = await openTab(deps);
  await press(first, row(first, { kind: "library", library: LAB }));
  const selected = listRuns(run).at(-1)!;
  await act(() => first.close());
  run.mockClear();
  const view = await openTab(deps);
  expect(listRuns(run)).toEqual([selected]);
  expect(header(view)).toBe("Lab · 2 papers · 2 unread");
});

it("counts again after a database change", async () => {
  const { deps, change } = pluginData();
  const view = await openTab(deps);
  await act(async () => {
    change([
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
  const { deps, run, settings } = pluginData({
    node: { kind: "collection", library: PERSONAL, path: ["Old name"] },
    facets: [],
    search: "",
    sort: [{ property: "dateModified", direction: "DESC" }],
    layout: "table",
    order: ["title"],
  });
  const view = await openTab(deps);
  await act(() => view.query.settled);
  expect(listRuns(run).at(-1)).not.toHaveProperty("filter");
  expect(header(view)).toBe("My Library · 5 papers · 2 unread");
  await settings.flush();
  expect(settings.current?.["library.document"]?.node).toEqual({
    kind: "library",
    library: PERSONAL,
  });
});

it("names the tree by its heading, with no tooltip over it", async () => {
  const { deps } = pluginData();
  const view = await openTab(deps);
  const pane = view.contentEl.querySelector("[data-library-tree]")!;
  const treeEl = pane.querySelector("[role=tree]")!;
  const name = treeEl.getAttribute("aria-labelledby");
  expect(
    name && view.contentEl.querySelector(`[id="${name}"]`)?.textContent,
  ).toBe("Libraries");
  // Obsidian shows every `aria-label` as a tooltip on hover.
  expect(pane.querySelectorAll("[aria-label]")).toHaveLength(0);
});

it("says where Zotero's data folder cannot be found, offers to locate it, and lists the papers once it is set", async () => {
  const { deps, lose, locate, setupActions } = pluginData();
  lose();
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
  expect(notFound("tree").textContent).toContain("Zotero not found");
  expect(notFound("list").textContent).toContain(
    "We couldn't find your Zotero library",
  );
  // The facet chips under the tree hide with it.
  expect(
    view.contentEl
      .querySelector("[data-library-facets]")
      ?.closest(".zt\\:group-data-zotero-missing\\:hidden"),
  ).toBeInstanceOf(HTMLElement);
  const button = (part: "tree" | "list", text: string) =>
    [...notFound(part).querySelectorAll("button")].find(
      (el) => el.textContent === text,
    )!;
  await press(view, button("tree", "Locate data folder"));
  await press(view, button("list", "Locate data folder"));
  await press(view, button("list", "Open settings"));
  expect(setupActions.locateZotero).toHaveBeenCalledTimes(2);
  expect(setupActions.openSettings).toHaveBeenCalledOnce();
  // No setup-time hint names ZotLit Companion or Better BibTeX.
  expect(view.contentEl.textContent).not.toMatch(/Companion|Better BibTeX/);

  await act(async () => {
    locate();
    await view.tree.settled;
    await view.query.settled;
  });
  expect(shell.hasAttribute("data-zotero-missing")).toBe(false);
  expect(tree(view)).toContain("My Library 5");
});

it("keeps the last rows with a note where a refresh of the database fails, and drops the note once it reads again", async () => {
  const { deps, refreshFails, locate } = pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  const rows = shown(view);
  const shell = view.contentEl.querySelector(
    "[data-library-tree]",
  )!.parentElement!;
  const note = () =>
    view.contentEl.querySelector<HTMLElement>("[data-library-refresh-failed]");
  await act(async () => {
    refreshFails();
    await view.query.settled;
  });
  expect(shell.hasAttribute("data-zotero-missing")).toBe(false);
  expect(shown(view)).toEqual(rows);
  expect(note()?.textContent).toContain("couldn't read Zotero's database");
  await act(async () => {
    locate();
    await view.query.settled;
  });
  expect(note()).toBeNull();
});

it("gives each row on Recent its reason, and none on a Library", async () => {
  const { deps } = pluginData();
  const view = await openTab(deps);
  const item = { indexedKey: "AAAAAAAA", values: {} };
  expect(view.query.reason(item)).toBe("edited in Zotero");
  await press(view, row(view, { kind: "library", library: LAB }));
  expect(view.query.reason(item)).toBeNull();
});

it("reads the new Library Scope on Recent once the researcher changes it", async () => {
  const { deps, run, rescope } = pluginData();
  const view = await openTab(deps);
  await act(async () => {
    rescope([LIBRARIES[1]!]);
    await view.query.settled;
  });
  expect(listRuns(run).at(-1)!.libraries).toEqual({
    mode: "selected",
    libraries: [LAB],
  });
});

it("reads the saved Library Scope on Recent where the database holds none of its Libraries, so the view names the one missing", async () => {
  const { deps, run, rescope } = pluginData();
  const view = await openTab(deps);
  await act(async () => {
    rescope([], [GONE]);
    await view.query.settled;
  });
  expect(listRuns(run).at(-1)!.libraries).toEqual({
    mode: "selected",
    libraries: [GONE],
  });
});

it("keeps Recent selected through a sort change, and selecting it again sorts newest change first", async () => {
  const { deps, run, settings } = pluginData();
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
    sort: [{ field: "dateModified", direction: "desc" }],
  });
  expect(header(view)).toBe("Recent");
  await settings.flush();
  expect(settings.current?.["library.document"]).toMatchObject({
    node: RECENT,
    sort: [{ property: "dateModified", direction: "DESC" }],
  });
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
  const { deps, run, settings } = pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  await act(async () => {
    sortTwice(view);
    row(view, RECENT).click();
    await view.query.flush();
    await view.searched;
    await view.query.settled;
  });
  expect(listRuns(run).at(-1)!.sort).toEqual([
    { field: "dateModified", direction: "desc" },
  ]);
  await settings.flush();
  expect(settings.current?.["library.document"]).toMatchObject({
    node: RECENT,
    sort: [{ property: "dateModified", direction: "DESC" }],
  });
});

it("keeps the last of two quick sorts once the search is cleared", async () => {
  const { deps, run, settings } = pluginData(ON_MY_LIBRARY);
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
  await settings.flush();
  expect(settings.current?.["library.document"]).toMatchObject({
    sort: [{ property: "title", direction: "DESC" }],
  });
});

it("reads only the Library Scope on Recent while the tree shows every Library", async () => {
  const { deps, run } = pluginData();
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

it("opens on the Papers Layout, offers Papers and the Table only, and opens again on the Table once the researcher switches to it", async () => {
  const { deps } = pluginData();
  const first = await openTab(deps);
  expect(first.query.state.getState().view?.type).toBe("papers");
  expect(first.query.layouts).toEqual(["papers", "table"]);
  await act(async () => {
    first.query.document.setViewLayout(0, "table");
    await first.query.flush();
    await first.query.settled;
  });
  await act(() => first.close());

  const second = await openTab(deps);
  expect(second.query.state.getState().view?.type).toBe("table");
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
    const { deps } = pluginData();
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
    expect(
      view.contentEl.querySelector("[data-query-count]")?.textContent,
    ).toBe("2 results");
    // A second press shows every Item again.
    await press(view, facet(view, id));
    expect(listed(view)).toHaveLength(5);
  });

  it("narrows Recent, over every Library in the Library Scope", async () => {
    const { deps, run } = pluginData();
    const view = await openTab(deps);
    await press(view, facet(view, "unread"));
    expect(listRuns(run).at(-1)).toMatchObject({
      libraries: { mode: "selected", libraries: [PERSONAL, LAB] },
      filter: "annotations.isEmpty()",
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
    const { deps } = pluginData();
    const view = await openTab(deps);
    await press(view, row(view, THESIS));
    await press(view, facet(view, "pdf"));
    expect(listed(view)).toEqual(["AAAAAAAA", "BBBBBBBB"]);
    await press(view, facet(view, "has-note"));
    expect(listed(view)).toEqual(["AAAAAAAA"]);
  });

  it("counts the unread Items of the selection in the header, once the vault answers for their notes", async () => {
    const { deps, addNote } = pluginData();
    const view = await openTab(deps);
    // Recent names no paper count, so it names no unread count either.
    expect(header(view)).toBe("Recent");
    await press(view, row(view, MY_LIBRARY));
    expect(header(view)).toBe("My Library · 5 papers · 2 unread");
    await press(view, row(view, THESIS));
    expect(header(view)).toBe("Thesis · 3 papers · 1 unread");
    await press(view, facet(view, "unread"));
    expect(listed(view)).toEqual(["BBBBBBBB"]);
    // A new Literature Note takes B out of the unread Items.
    await act(async () => {
      addNote("BBBBBBBB");
      await view.query.settled;
      await view.tree.settled;
    });
    expect(listed(view)).toEqual([]);
    expect(header(view)).toBe("Thesis · 3 papers · 0 unread");
  });

  it("opens again with the facets the researcher left on", async () => {
    const { deps, settings } = pluginData();
    const first = await openTab(deps);
    await press(first, facet(first, "pdf"));
    await press(first, facet(first, "annotated"));
    await settings.flush();
    expect(settings.current?.["library.document"]?.facets).toEqual([
      "annotated",
      "pdf",
    ]);
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

it("expands a paper whose only child is its Literature Note, to that note", async () => {
  const { deps } = pluginData();
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
  const { deps, items } = pluginData();
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

it("answers the quick switcher's keys on the selected row: Enter the note, Mod+Enter the note in a new pane, Shift+Enter the PDF", async () => {
  const { deps, items } = pluginData();
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
  const { deps, items } = pluginData();
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
  const { deps, items } = pluginData();
  const view = await openTab(deps);
  await act(() => {
    itemRow(view, C).dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true }),
    );
  });
  expect(items.openPdf).toHaveBeenCalledExactlyOnceWith(C, false);
});

it("lists the row's actions in its menu, which other plugins add to", async () => {
  const { deps, items } = pluginData();
  const trigger = vi.fn();
  deps.app.workspace.trigger = trigger;
  const view = await openTab(deps);
  await act(() => {
    itemRow(view, C).dispatchEvent(
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
    indexedKey: C,
  });
  // The menu acts on the row it opened over, which it selects.
  expect(itemRows(view)[2]).toBe(`${C} *`);
  menu.items[1]!.click();
  expect(items.openPdf).toHaveBeenCalledExactlyOnceWith(C, "split");
  menu.items[5]!.click();
  expect(items.showInZotero).toHaveBeenCalledExactlyOnceWith(C);
});

it("shows an Item in its first Collection, selected", async () => {
  const { deps, run } = pluginData();
  const view = await openTab(deps);
  await act(async () => {
    await view.reveal(A);
  });
  // A is filed in Chapter 1 and Chapter 2 of Thesis; Chapter 1 comes first.
  expect(listRuns(run).at(-1)).toMatchObject({
    libraries: { mode: "selected", libraries: [PERSONAL] },
    filter: 'collections.within("Thesis/Chapter 1")',
  });
  expect(header(view)).toBe("Thesis / Chapter 1 · 1 paper · 0 unread");
  expect(itemRows(view)).toContain(`${A} *`);
});

it("turns the Reading State facets off to show an Item they leave out", async () => {
  const { deps, run, settings } = pluginData();
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
  await settings.flush();
  expect(settings.current?.["library.document"]?.facets).toEqual([]);
});

it("says it cannot show an Item past the rows the list holds, and selects nothing", async () => {
  const { deps, change } = pluginData();
  // A thousand Items of My Library come before the one revealed.
  const octal = (n: number) =>
    [...n.toString(8).padStart(6, "0")]
      .map((digit) => "ABCDEFGH"[Number(digit)])
      .join("");
  const many = Array.from({ length: 1000 }, (_, n) => ({
    key: `ZZ${octal(n)}`,
    libraryID: 1,
    collections: [] as string[],
  }));
  change([...many, { key: "YYYYYYYY", libraryID: 1, collections: [] }]);
  const view = await openTab(deps);
  let outcome: unknown;
  await act(async () => {
    outcome = await view.reveal("YYYYYYYY");
  });
  expect(outcome).toBe("not-listed");
  expect(view.selection.getState().key).toBeNull();
});

it("shows an Item filed in no Collection in its Library", async () => {
  const { deps, run } = pluginData();
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
  layout: "table",
  order: ["title"],
};

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
  const { deps } = pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  expect(
    view.contentEl.querySelector('[data-query-toolbar="search"]'),
  ).toBeNull();
});

it("offers no sort while a search lists its hits in rank order, and offers it again once the search is cleared", async () => {
  const { deps } = pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  const sort = () =>
    view.contentEl.querySelector('[data-query-toolbar="sort"]');
  expect(sort()).not.toBeNull();
  await type(view, "figures");
  expect(sort()).toBeNull();
  await type(view, "");
  expect(sort()).not.toBeNull();
});

it("has the search box focused when the command brings the tab forward", async () => {
  const { deps } = pluginData();
  const view = await openTab(deps);
  expect(document.activeElement).not.toBe(searchBox(view));
  const leaf = { view } as unknown as WorkspaceLeaf;
  await openLibraryView({
    workspace: {
      getLeavesOfType: () => [leaf],
      setActiveLeaf: () => {},
      revealLeaf: () => Promise.resolve(),
    },
  } as unknown as App);
  expect(document.activeElement).toBe(searchBox(view));
});

it("lists a search's hits in the rank of the worker search, inside the selected node", async () => {
  const { deps, searches } = pluginData(ON_MY_LIBRARY);
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
  expect(header(view)).toBe("3 matches in My Library · Search all libraries");
  await press(view, row(view, THESIS));
  expect(shown(view)).toEqual(["CCCCCCCC", "AAAAAAAA"]);
  expect(header(view)).toBe("2 matches in Thesis · Search all libraries");
});

it("searches all libraries in the Library Scope on request, past the selected Collection", async () => {
  const { deps, run, searches } = pluginData();
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
  expect(header(view)).toBe("4 matches in all libraries");
});

it("narrows a tag: token to the Items with that tag, in the list's order", async () => {
  const { deps, searches } = pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  const before = searches.length;
  await type(view, "tag:method");
  expect(searches).toHaveLength(before);
  expect(shown(view)).toEqual(["AAAAAAAA", "CCCCCCCC", "EEEEEEEE"]);
  await type(view, "tag:method figures");
  expect(shown(view)).toEqual(["CCCCCCCC", "AAAAAAAA"]);
});

it("asks the search again after a database change, so a renamed Item joins its hits", async () => {
  const { deps, change } = pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  await type(view, "figures");
  expect(shown(view)).toEqual(["DDDDDDDD", "CCCCCCCC", "AAAAAAAA"]);
  await act(async () => {
    change(
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
  const { deps, settings } = pluginData(ON_MY_LIBRARY);
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
  expect(header(view)).toBe("My Library · 5 papers · 2 unread");
  await act(() => view.close());
  expect(settings.current?.["library.document"]?.search).toBe("");
});

it("keeps a search inside the active facets, the vault's among them, in the search's rank", async () => {
  const { deps } = pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  await type(view, "figures");
  expect(shown(view)).toEqual(["DDDDDDDD", "CCCCCCCC", "AAAAAAAA"]);
  await press(view, facet(view, "has-note"));
  expect(shown(view)).toEqual(["DDDDDDDD", "AAAAAAAA"]);
  await press(view, facet(view, "annotated"));
  expect(shown(view)).toEqual(["AAAAAAAA"]);
  expect(header(view)).toBe("1 match in My Library · Search all libraries");
});

it("keeps a search of all libraries inside the active facets", async () => {
  const { deps } = pluginData();
  const view = await openTab(deps);
  await press(view, row(view, THESIS));
  await press(view, facet(view, "unread"));
  await type(view, "figures");
  await press(
    view,
    view.contentEl.querySelector<HTMLElement>("[data-library-search-all]")!,
  );
  // Of the four hits in My Library and Lab, F has no Annotation and no
  // note; the others have one or the other.
  expect(shown(view)).toEqual(["FFFFFFFF"]);
});

it("lists nothing more once the tab closed during a search", async () => {
  const { deps, run } = pluginData();
  // The worker answers once the tab has closed.
  const gate = Promise.withResolvers<void>();
  const open = deps.lookup.openSession.bind(deps.lookup);
  deps.lookup = {
    openSession: () => {
      const session = open();
      return {
        ...session,
        search: async (query, opts) => {
          await gate.promise;
          return session.search(query, opts);
        },
      };
    },
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
  const { deps, settings } = pluginData(ON_MY_LIBRARY);
  const first = await openTab(deps);
  await type(first, "figures");
  await act(() => first.close());
  expect(settings.current?.["library.document"]?.search).toBe("figures");
  const view = await openTab(deps);
  expect(searchBox(view).value).toBe("figures");
  expect(shown(view)).toEqual(["DDDDDDDD", "CCCCCCCC", "AAAAAAAA"]);
});

it("searches every Library in the Library Scope on Recent, with no offer to widen", async () => {
  const { deps, searches } = pluginData();
  const view = await openTab(deps);
  await type(view, "figures");
  expect(searches.at(-1)).toEqual({ query: "figures", libraries: [1, 2] });
  expect(shown(view)).toEqual(["FFFFFFFF", "DDDDDDDD", "CCCCCCCC", "AAAAAAAA"]);
  expect(header(view)).toBe("4 matches in Recent");
  expect(view.contentEl.querySelector("[data-library-search-all]")).toBeNull();
});

it("leaves Enter and the arrow keys to the Welcome View banner's controls", async () => {
  const { deps, items } = pluginData();
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
    const harness = pluginData();
    harness.host.vault.addFile("literatures/Paper.md", "");
    const view = await openTab(harness.deps);
    await act(() => view.welcome.settled);
    return { ...harness, view };
  }

  it("shows nothing until the researcher asks for it", async () => {
    const { view } = await setUp();
    expect(banner(view)).toEqual([]);
  });

  it("shows the setup steps on Open welcome view", async () => {
    const { view, settings } = await setUp();
    const leaf = { view } as unknown as WorkspaceLeaf;
    await act(() =>
      openWelcomeView(
        {
          workspace: {
            getLeavesOfType: () => [leaf],
            setActiveLeaf: () => {},
            revealLeaf: () => Promise.resolve(),
          },
        } as unknown as App,
        settings,
      ),
    );
    expect(banner(view)).toContain(m.welcome_step_connect_title());
    expect(banner(view)).toContain(m.welcome_step_library_title());
  });

  it("offers the template conversion while it is pending", async () => {
    const { view, settings } = await setUp();
    await act(() => {
      settings.update({ "note.template-conversion-pending": true });
    });
    expect(banner(view)).toContain(m.welcome_template_conversion_title());
  });
});

it("asks the database nothing from the search box while Zotero's data folder is missing, and searches once it is set", async () => {
  const { deps, searches, lose, locate } = pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  lose();
  await act(async () => {
    view.search.type("figures");
    await view.searched;
  });
  expect(searches).toEqual([]);
  await act(async () => {
    locate();
    await view.searched;
    await view.query.settled;
  });
  expect(searches.at(-1)).toEqual({ query: "figures", libraries: [1] });
  expect(shown(view)).toEqual(["DDDDDDDD", "CCCCCCCC", "AAAAAAAA"]);
});

it("lets go of the selected row once a search leaves it out, and hides its Reading Card", async () => {
  const { deps } = pluginData();
  const view = await openTab(deps);
  await act(() => itemRow(view, A).click());
  expect(view.selection.getState().key).toBe(A);
  await type(view, "attention");
  expect(itemRows(view)).toEqual([B]);
  expect(view.selection.getState().key).toBeNull();
  expect(
    view.contentEl.querySelector("[data-library-card]")!.hasAttribute("hidden"),
  ).toBe(true);
});

it("draws each row without Recent's reason once My Library is picked, where Recent reads My Library alone", async () => {
  const { deps, rescope } = pluginData();
  const view = await openTab(deps);
  await act(async () => {
    rescope(LIBRARIES.slice(0, 1));
    await view.searched;
    await view.query.settled;
  });
  const reasons = () =>
    [...view.contentEl.querySelectorAll("[data-query-papers-state]")].filter(
      (el) => el.textContent?.includes("edited in Zotero"),
    ).length;
  expect(reasons()).toBe(5);
  await press(view, row(view, MY_LIBRARY));
  expect(reasons()).toBe(0);
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
      meta: part("meta"),
      abstract: part("abstract"),
    };
  };
  const button = (view: LibraryView, action: string) =>
    card(view).querySelector<HTMLElement>(
      `[data-library-card-action="${action}"]`,
    )!;

  it("hides while no row is selected, and shows the selected Item's title, creators, year, publication and abstract", async () => {
    const { deps } = pluginData();
    const view = await openTab(deps);
    expect(shownCard(view)).toBeNull();
    await act(async () => {
      itemRow(view, B).click();
      await view.card.settled;
    });
    expect(shownCard(view)).toEqual({
      title: "Notes on attention",
      // The authors, and not the editor, as on the row.
      meta: "Vaswani, Shazeer · 2017 · Advances in Neural Information Processing Systems",
      abstract: "Attention alone carries a sequence model.",
    });
    // An Item with no abstract shows none.
    await act(async () => {
      itemRow(view, C).click();
      await view.card.settled;
    });
    expect(shownCard(view)).toEqual({
      title: "Figures that work",
      meta: "",
      abstract: null,
    });
  });

  it("reads the selected Item again after a database change", async () => {
    const { deps, change } = pluginData();
    const view = await openTab(deps);
    await act(async () => {
      itemRow(view, B).click();
      await view.card.settled;
    });
    await act(async () => {
      change(
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
    const { deps } = pluginData();
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
    const { deps, run } = pluginData();
    const view = await openTab(deps);
    await act(async () => {
      itemRow(view, A).click();
      await view.card.settled;
    });
    expect(view.card.query.state.getState().results).not.toBeNull();
    const failing = Promise.withResolvers<QueryViewOutcome>();
    run.mockImplementation((request) =>
      request.from === "annotations" && request.context?.item === B
        ? failing.promise
        : Promise.resolve(answer(SEED, request)),
    );
    await act(() => itemRow(view, B).click());
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
    const { deps, run } = pluginData();
    const view = await openTab(deps);
    await act(async () => {
      itemRow(view, B).click();
      await view.card.settled;
    });
    const annotations = run.mock.calls
      .map(([request]) => request)
      .filter((request) => request.from === "annotations");
    expect(annotations.at(-1)).toMatchObject({
      filter: "item == this.item",
      context: { item: B },
      // Recent reads every Library in the Library Scope; the card, B's own.
      libraries: { mode: "selected", libraries: [PERSONAL] },
    });
  });

  it("hides once the researcher picks another node in the tree", async () => {
    const { deps } = pluginData();
    const view = await openTab(deps);
    await act(async () => {
      itemRow(view, B).click();
      await view.card.settled;
    });
    expect(shownCard(view)).not.toBeNull();
    await press(view, row(view, THESIS));
    expect(shownCard(view)).toBeNull();
  });

  it("opens the PDF, opens or writes the Literature Note and cites, as the row menu does", async () => {
    const { deps, items, addNote } = pluginData();
    const view = await openTab(deps);
    await act(async () => {
      itemRow(view, B).click();
      await view.card.settled;
    });
    // B has no Literature Note yet.
    expect(button(view, "note").textContent).toBe("Write literature note");
    await act(() => {
      button(view, "pdf").click();
      button(view, "note").click();
      button(view, "cite").click();
    });
    expect(items.openPdf).toHaveBeenCalledExactlyOnceWith(B, false);
    expect(items.openNote).toHaveBeenCalledExactlyOnceWith(B, false);
    expect(items.insertCitation).toHaveBeenCalledExactlyOnceWith(B);
    await act(() => addNote(B));
    expect(button(view, "note").textContent).toBe("Open literature note");
  });

  it("leaves Enter and the arrow keys inside the card to the card", async () => {
    const { deps, items } = pluginData();
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
