// @vitest-environment happy-dom
// The Library View tab runs the query its Library View Document derives: the
// document plugin data holds when the tab opens, and after a toolbar change,
// the same query when the tab opens again.
import { Menu, resetMockPlatform, setMockPlatform } from "@mock/obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";

import { formatIndexedKey } from "@zotlit/db";
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
import type { AvailableLibrary } from "@/services/library-scope/scope";
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
  const named =
    request.libraries?.mode === "selected" ? request.libraries.libraries : [];
  const ids = new Set(
    LIBRARIES.filter(({ selector }) =>
      named.some((s) => selectorKey(s) === selectorKey(selector)),
    ).map(({ libraryID }) => libraryID),
  );
  const matched = items.filter(({ libraryID }) => ids.has(libraryID));
  if (request.group !== "collections[]") return list(matched, request);
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

/**
 * The Items rows of a list request, each titled by its key, in seed order;
 * a key-set filter keeps the Items it names. The rows hold the Collection
 * paths in the engine's order.
 */
function list(
  matched: readonly SeedItem[],
  request: QueryViewRequest,
): QueryViewOutcome {
  const keySet = request.filter?.endsWith(".contains(indexedKey)")
    ? (JSON.parse(
        request.filter.slice(0, request.filter.indexOf("]") + 1),
      ) as string[])
    : null;
  const shown = keySet
    ? matched.filter((item) => keySet.includes(indexedKeyOf(item)))
    : matched;
  return {
    kind: "result",
    result: {
      ...EMPTY.result,
      returnedCount: shown.length,
      matchedCount: shown.length,
      rows: shown.map((item) => ({
        indexedKey: indexedKeyOf(item),
        values: {
          title: `Paper ${item.key}`,
          collections: [...item.collections].sort(),
        },
      })),
    },
  };
}

/** The Indexed Key of a seed Item, with the group of its Library. */
function indexedKeyOf({ key, libraryID }: SeedItem): string {
  const { selector } = LIBRARIES.find((l) => l.libraryID === libraryID)!;
  return formatIndexedKey(
    key,
    selector.type === "group" ? selector.groupID : null,
  );
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
  const items = {
    openNote: vi.fn(() => Promise.resolve()),
    openPdf: vi.fn(() => Promise.resolve()),
    insertCitation: vi.fn(() => Promise.resolve()),
    copyCitationKey: vi.fn(() => Promise.resolve()),
    showInZotero: vi.fn(),
  };
  const off = () => () => {};
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
    libraryScope: {
      on: off,
      current: {
        mode: "selected",
        invalid: false,
        available: LIBRARIES.slice(0, 2),
        unavailable: [],
      },
      libraries: LIBRARIES,
    },
    query: { run },
    cardFocus: { hold: () => ({ [Symbol.dispose]: () => {} }) },
    annotations: { on: off, hold: () => ({ [Symbol.dispose]: () => {} }) },
    literatureNotes: { find: () => null, on: off, open: vi.fn() },
    items,
    settings,
  } as unknown as LibraryViewDeps;
  /** Zotero's database changes to hold `items`, and says so. */
  const change = (items: readonly SeedItem[]) => {
    database.items = items;
    reads.emit("changed");
  };
  return { deps, run, settings, change, items };
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
      } ${node.querySelector("[data-library-count]")?.textContent ?? "…"}`,
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

it("opens on My Library, newest change first, where plugin data holds no document", async () => {
  const { deps, run } = pluginData();
  await openTab(deps);
  expect(listRuns(run)).toHaveLength(1);
  const [request] = listRuns(run) as [QueryViewRequest];
  expect(request).toMatchObject({
    from: "items",
    libraries: { mode: "selected", libraries: [{ type: "personal" }] },
    sort: [{ field: "dateModified", direction: "desc" }],
  });
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
  expect(header(view)).toBe("My Library · 5 papers");
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
  expect(tree(view).slice(0, 3)).toEqual([
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

it("selects a row on a click and moves the selection with the arrow keys", async () => {
  const { deps, items } = pluginData();
  const view = await openTab(deps);
  expect(itemRows(view)).toEqual([A, B, C, "DDDDDDDD", "EEEEEEEE"]);
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
  await act(() => view.reveal(A));
  // A is filed in Chapter 1 and Chapter 2 of Thesis; Chapter 1 comes first.
  expect(listRuns(run).at(-1)).toMatchObject({
    libraries: { mode: "selected", libraries: [PERSONAL] },
    filter: 'collections.within("Thesis/Chapter 1")',
  });
  expect(header(view)).toBe("Thesis / Chapter 1 · 1 paper");
  expect(itemRows(view)).toContain(`${A} *`);
});

it("shows an Item filed in no Collection in its Library", async () => {
  const { deps, run } = pluginData();
  const view = await openTab(deps);
  await press(view, row(view, THESIS));
  const g = formatIndexedKey("GGGGGGGG", 4815);
  await act(() => view.reveal(g));
  expect(listRuns(run).at(-1)!.libraries).toEqual({
    mode: "selected",
    libraries: [LAB],
  });
  expect(listRuns(run).at(-1)).not.toHaveProperty("filter");
  expect(itemRows(view)).toContain(`${g} *`);
});
