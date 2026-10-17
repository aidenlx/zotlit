// @vitest-environment happy-dom
// The Library View tab runs the query its Library View Document derives: the
// document plugin data holds when the tab opens, and after a toolbar change,
// the same query when the tab opens again.
import { resetMockPlatform, setMockPlatform } from "@mock/obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";

import { createNanoEvents } from "@zotlit/shared/nanoevents";

import {
  createObsidianHost,
  PluginStub,
} from "@/lib/__fixtures__/obsidian-host";
import { Effect } from "@/lib/effect";
import type {
  QueryViewOutcome,
  QueryViewRequest,
} from "@/services/item-query/query-view";
import type {
  AvailableLibrary,
  LibraryScope,
} from "@/services/library-scope/scope";
import { selectorKey } from "@/services/library-scope/scope";
import { SettingsService } from "@/services/settings/service";

import type { LibraryNode } from "./document";
import { nodeKey } from "./library-tree";
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

/** One Item of the fake Zotero database: its Library and the Collections it is filed in. */
interface SeedItem {
  readonly key: string;
  readonly libraryID: number;
  readonly collections: readonly string[];
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
  },
  { key: "BBBBBBBB", libraryID: 1, collections: ["Thesis/Chapter 2"] },
  { key: "CCCCCCCC", libraryID: 1, collections: ["Thesis"] },
  { key: "DDDDDDDD", libraryID: 1, collections: ["Reading list"] },
  { key: "EEEEEEEE", libraryID: 1, collections: [] },
  { key: "FFFFFFFF", libraryID: 2, collections: ["Thesis"] },
  { key: "GGGGGGGG", libraryID: 2, collections: [] },
  { key: "HHHHHHHH", libraryID: 3, collections: [] },
];

/**
 * ZotLit Query over {@link SEED} for a grouped request, as the engine groups:
 * an Item joins one group for each Collection it is filed in, or the `null`
 * group for none. Any other request finds nothing.
 */
function answer(
  items: readonly SeedItem[],
  request: QueryViewRequest,
): QueryViewOutcome {
  if (request.group !== "collections[]") return EMPTY;
  const named =
    request.libraries?.mode === "selected" ? request.libraries.libraries : [];
  const ids = new Set(
    LIBRARIES.filter(({ selector }) =>
      named.some((s) => selectorKey(s) === selectorKey(selector)),
    ).map(({ libraryID }) => libraryID),
  );
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
  const reads = createNanoEvents<{ changed: () => void }>();
  const scopeEvents = createNanoEvents<{ changed: () => void }>();
  const off = () => () => {};
  const libraryScope = {
    on: scopeEvents.on.bind(scopeEvents),
    effective: {
      mode: "selected",
      libraries: LIBRARIES.slice(0, 2).map(({ selector }) => selector),
    } as LibraryScope,
    current: {
      mode: "selected",
      invalid: false,
      available: LIBRARIES.slice(0, 2),
      unavailable: [],
    },
    libraries: LIBRARIES,
  };
  const deps = {
    app: {
      ...host.app,
      scope: undefined,
      workspace: { ...host.workspace, leftSplit: null, rightSplit: null },
    },
    reads: {
      on: reads.on.bind(reads),
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
    cardFocus: { hold: () => ({ [Symbol.dispose]: () => {} }) },
    annotations: { on: off, hold: () => ({ [Symbol.dispose]: () => {} }) },
    settings,
  } as unknown as LibraryViewDeps;
  /** Zotero's database changes to hold `items`, and says so. */
  const change = (items: readonly SeedItem[]) => {
    database.items = items;
    reads.emit("changed");
  };
  /** The researcher saves `scope` as the Library Scope. */
  const rescope = (scope: LibraryScope) => {
    libraryScope.effective = scope;
    scopeEvents.emit("changed");
  };
  return { deps, run, settings, change, rescope };
}

/** The Items requests, without the count requests of the Library Tree. */
function listRuns(run: ReturnType<typeof pluginData>["run"]) {
  return run.mock.calls
    .map(([request]) => request)
    .filter((request) => request.group === undefined);
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
  expect(header(view)).toBe("Thesis · 3 papers");
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
  expect(header(view)).toBe("Lab · 2 papers");
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
  expect(header(view)).toBe("Lab · 2 papers");
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
  expect(header(view)).toBe("My Library · 5 papers");
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
    rescope({ mode: "selected", libraries: [LAB] });
    await view.query.settled;
  });
  expect(listRuns(run).at(-1)!.libraries).toEqual({
    mode: "selected",
    libraries: [LAB],
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
