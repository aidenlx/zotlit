// @vitest-environment happy-dom
// The Query View runs one view of a Query File through ZotLit Query and shows
// its rows as live Annotation Cards. These tests drive it as a host does: the
// file's text in, the cards, the count and the messages out.
import { resetMockPlatform, setMockPlatform } from "@mock/obsidian";
import { Scope } from "obsidian";
import type { App } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";

import { Effect } from "@/lib/effect";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import type {
  AnnotationList,
  AnnotationRecord,
} from "@/services/annotation-repository/service";
import { IDLE } from "@/services/annotation-repository/write";
import type {
  QueryViewOutcome,
  QueryViewRequest,
  QueryViewRow,
} from "@/services/item-query/query-view";
import { editorApp } from "@/views/annot-view/__fixtures__/editor-app";

import { QueryView } from "./view";
import type { QueryViewDeps } from "./view";

vi.mock("zustand", () => import("../__fixtures__/zustand"));

function record(key: string, parentKey: string): AnnotationRecord {
  return {
    key,
    parentKey,
    type: "highlight",
    color: "#ffd400",
    comment: null,
    text: `text of ${key}`,
    pageLabel: "1",
    sortIndex: "00000|000000|00000",
    tags: [],
    version: 1,
    lock: null,
    position: { kind: "pdf-rects", pageIndex: 0, rects: [[0, 0, 10, 10]] },
  };
}

const LIST: AnnotationList = {
  source: {
    kind: "zotero-db",
    database: { userID: 1, localUserKey: "LOCALKEY", serverID: null },
    libraryID: 1,
    libraryRevision: 7,
  },
  annotations: [record("ANNOTAAA", "PDFAAAAA"), record("ANNOTBBB", "PDFAAAAA")],
};

const FILE = `views:
  - type: annotations
    name: Yellow
    from: annotations
    filters: colorName == "yellow"
    groupBy:
      property: item.indexedKey
      direction: ASC
    limit: 100
  - type: annotations
    name: Everything
    from: annotations
`;

function row(key: string): QueryViewRow {
  return {
    indexedKey: key,
    attachmentIndexedKey: "PDFAAAAA",
    itemIndexedKey: "ITEMAAAA",
    values: { "item.title": "Ten simple rules", "attachment.title": "PDF" },
  };
}

function result(
  rows: QueryViewRow[],
  matchedCount = rows.length,
): QueryViewOutcome {
  return {
    kind: "result",
    result: {
      libraries: [{ type: "personal" }],
      query: {} as never,
      returnedCount: rows.length,
      matchedCount,
      truncated: matchedCount > rows.length,
      warnings: [],
      rows,
    },
  };
}

type Listener = (...args: unknown[]) => void;

function emitter() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    on: (event: string, cb: Listener) => {
      const set = listeners.get(event) ?? new Set();
      set.add(cb);
      listeners.set(event, set);
      return () => set.delete(cb);
    },
    emit: (event: string, ...args: unknown[]) => {
      for (const cb of listeners.get(event) ?? []) cb(...args);
    },
  };
}

let cleanup = new DisposableStack();
afterEach(() => {
  cleanup.dispose();
  cleanup = new DisposableStack();
  document.body.replaceChildren();
});

async function mount(
  answers: QueryViewOutcome[],
  onWrite?: (text: string) => void,
  { notes = {} }: { notes?: Record<string, string> } = {},
) {
  setMockPlatform({ isMacOS: true });
  cleanup.defer(resetMockPlatform);
  const reads = emitter();
  const libraryScope = emitter();
  const repository = emitter();
  const held: string[][] = [];
  const released: string[][] = [];
  const run = vi.fn((_request: QueryViewRequest, _signal: AbortSignal) =>
    Promise.resolve(answers.shift() ?? result([])),
  );
  const notesChanged = emitter();
  const literatureNotes = {
    find: (itemKey: string) => {
      const path = notes[itemKey];
      return path === undefined
        ? null
        : { path, basename: path.replace(/\.md$/, "") };
    },
    on: notesChanged.on,
    open: vi.fn(),
    create: vi.fn(async (itemKey: string) => {
      notes[itemKey] = `${itemKey}.md`;
      notesChanged.emit("changed");
    }),
  };
  const deps = {
    app: editorApp() as unknown as App,
    reads: {
      on: reads.on,
      acquireRead: () =>
        Promise.resolve({
          reads: {
            TagNames: ({ libraryID }: { libraryID: number }) =>
              Effect.succeed(
                libraryID === 1 ? ["figure", "method"] : ["group"],
              ),
            CollectionPaths: ({ libraryIDs }: { libraryIDs: number[] }) =>
              Effect.succeed(
                libraryIDs.length === 2 ? [["Thesis", "Methods"]] : [],
              ),
          },
          [Symbol.asyncDispose]: () => Promise.resolve(),
        }),
    },
    libraryScope: {
      on: libraryScope.on,
      current: {
        available: [
          { selector: { type: "personal" }, libraryID: 1, name: null },
          {
            selector: { type: "group", groupID: 4815 },
            libraryID: 2,
            name: "Lab",
          },
        ],
      },
    },
    query: { run },
    annotations: {
      read: () => Promise.resolve(LIST),
      peek: () => ({ value: LIST }),
      refresh: () => Promise.resolve(),
      capabilityFor: (): EditingCapability => ({ kind: "writable" }),
      textDraftFor: () => null,
      tagDraftFor: () => null,
      annotationState: () => ({
        mutation: IDLE,
        textDrafts: {},
        tagDraft: null,
        hidden: false,
        gone: false,
      }),
      on: repository.on,
      hold: (keys: Iterable<string>) => {
        const list = [...keys];
        held.push(list);
        return { [Symbol.dispose]: () => released.push(list) };
      },
    },
    zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
    excerptDisplay: { open: vi.fn(), refresh: vi.fn() },
    noteFeature: {},
    libraryTagNames: () => Promise.resolve([]),
    allowEditing: vi.fn(),
    reportBlockedGesture: vi.fn(),
    literatureNotes,
  } as unknown as QueryViewDeps;
  const save = vi.fn((_text: string) => {});
  const onSelectView = vi.fn((_name: string) => {});
  const view = new QueryView(deps, {
    scope: new Scope(),
    sourcePath: () => "query-files/Reading.zotquery",
    context: () => undefined,
    save: (text) => {
      saved.push(text);
      save(text);
      onWrite?.(text);
    },
    onSelectView,
  });
  const saved: string[] = [];
  const el = document.createElement("div");
  document.body.append(el);
  view.load();
  await act(() => view.render(el));
  cleanup.defer(() => act(() => view.unload()));
  const settle = () =>
    act(async () => {
      await view.settled;
    });
  return {
    view,
    el,
    run,
    reads,
    libraryScope,
    held,
    released,
    settle,
    save,
    onSelectView,
    saved,
    literatureNotes,
  };
}

function cards(el: HTMLElement): (string | null)[] {
  return [...el.querySelectorAll(".zt-annot-card")].map((node) =>
    node.getAttribute("data-zotero-annotation-key"),
  );
}

it("runs the first view of the file and shows its rows with the count", async () => {
  const { view, el, run, settle } = await mount([result([row("ANNOTBBB")])]);
  await act(() => view.setText(FILE));
  await settle();

  expect(run).toHaveBeenCalledTimes(1);
  const [request] = run.mock.calls[0]!;
  expect(request).toMatchObject({
    from: "annotations",
    filter: 'colorName == "yellow"',
    limit: 100,
  });
  // In a Query File's own tab, `this` has no value.
  expect(request.context).toBeUndefined();
  expect(cards(el)).toEqual(["ANNOTBBB"]);
  expect(el.querySelector("[data-query-count]")?.textContent).toBe("1 result");
  expect(el.querySelector("[data-query-group]")?.textContent).toBe(
    "Ten simple rules",
  );
});

it("switches to another view of the file from the view menu", async () => {
  const { view, el, run, settle } = await mount([
    result([row("ANNOTBBB")]),
    result([row("ANNOTAAA"), row("ANNOTBBB")]),
  ]);
  await act(() => view.setText(FILE));
  await settle();
  await act(() => view.pickView("Everything"));
  await settle();

  expect(run.mock.calls[1]![0]).not.toHaveProperty("filter");
  expect(cards(el)).toEqual(["ANNOTAAA", "ANNOTBBB"]);
  expect(el.querySelector("[data-query-view-menu]")?.textContent).toBe(
    "Everything",
  );
});

it("runs again on a database change and a Library Scope change", async () => {
  const { view, run, reads, libraryScope, settle } = await mount([]);
  await act(() => view.setText(FILE));
  await settle();
  reads.emit("changed");
  await settle();
  libraryScope.emit("libraries-changed");
  await settle();
  expect(run).toHaveBeenCalledTimes(3);
});

it("holds the lists it shows, and lets the old ones go only after the new ones", async () => {
  const { view, held, released, settle } = await mount([
    result([row("ANNOTBBB")]),
    result([]),
  ]);
  await act(() => view.setText(FILE));
  await settle();
  expect(held).toEqual([["PDFAAAAA"]]);
  expect(released).toEqual([]);

  await act(() => view.refresh());
  await settle();
  expect(held).toEqual([["PDFAAAAA"], []]);
  expect(released).toEqual([["PDFAAAAA"]]);
});

it("says the Item's library is outside the library scope, rather than only that nothing matches", async () => {
  const outside = result([]);
  if (outside.kind !== "result") throw new Error("unreachable");
  const { view, el, settle } = await mount([
    {
      kind: "result",
      result: {
        ...outside.result,
        warnings: [
          {
            code: "key-outside-target-libraries",
            severity: "warning",
            message:
              'Indexed Key "RUGIER24G4815" names group:4815, which is outside the Target Libraries.',
            hint: "Use library=group:4815 to include group:4815.",
            report: [],
          } as never,
        ],
      },
    },
  ]);
  await act(() => view.setText(FILE));
  await settle();

  expect(
    el.querySelector('[data-query-warning="key-outside-target-libraries"]')
      ?.textContent,
  ).toBe(
    "This item's library is not in the library scope, so the view cannot show it. Add the library to the library scope in ZotLit settings.",
  );
});

it("says why when the query cannot read Zotero's data, rather than looking empty", async () => {
  const { view, el, settle } = await mount([
    {
      kind: "failed",
      diagnostic: {
        code: "source-unavailable",
        message: "The Zotero database cannot be read.",
        hint: "Check the Zotero data directory.",
        severity: "error",
        report: ["The Zotero database cannot be read."],
        found: "",
        expected: [],
        suggestions: [],
      },
    },
  ]);
  await act(() => view.setText(FILE));
  await settle();

  expect(
    el
      .querySelector("[data-query-diagnostic]")
      ?.getAttribute("data-query-diagnostic"),
  ).toBe("source-unavailable");
  expect(el.querySelector("[data-query-empty]")).toBeNull();
});

it("opens a file with a broken view and names the problem without running it", async () => {
  const { view, el, run, settle } = await mount([]);
  await act(() =>
    view.setText(
      "views:\n  - type: kanban\n    name: Items\n    from: items\n",
    ),
  );
  await settle();
  expect(run).not.toHaveBeenCalled();
  expect(el.querySelector("[data-query-problems]")?.textContent).toContain(
    "kanban",
  );
});

it("saves a view edit to the file, and keeps a renamed view on screen without running it again", async () => {
  const { view, el, run, settle, save, onSelectView } = await mount([
    result([row("ANNOTBBB")]),
  ]);
  await act(() => view.setText(FILE));
  await settle();
  await act(() => view.renameView(0, "Yellow highlights"));
  await settle();

  expect(save).toHaveBeenCalledTimes(1);
  const [text] = save.mock.calls[0]!;
  expect(text).toContain("name: Yellow highlights");
  expect(text).toContain("name: Everything");
  expect(el.querySelector("[data-query-view-menu]")?.textContent).toBe(
    "Yellow highlights",
  );
  expect(onSelectView).toHaveBeenLastCalledWith("Yellow highlights");
  expect(run).toHaveBeenCalledTimes(1);
  expect(cards(el)).toEqual(["ANNOTBBB"]);
});

it("changes the cards at once for an Annotations layout option, and saves it", async () => {
  const { view, el, run, settle, save } = await mount([
    result([row("ANNOTBBB")]),
  ]);
  await act(() => view.setText(FILE));
  await settle();
  expect(el.querySelector(".zt-annot-page-chip")?.textContent).toContain("1");

  await act(() => view.setViewOption(0, "showPage", false));
  await act(() => view.setViewOption(0, "cardWidth", 420));
  await settle();

  expect(el.querySelector(".zt-annot-page-chip")?.textContent).toBe("");
  expect(
    el.querySelector("[data-card-width]")?.getAttribute("data-card-width"),
  ).toBe("420");
  expect(save.mock.calls.at(-1)![0]).toContain("showPage: false");
  expect(save.mock.calls.at(-1)![0]).toContain("cardWidth: 420");
  expect(run).toHaveBeenCalledTimes(1);
  expect(cards(el)).toEqual(["ANNOTBBB"]);
});

it("shows the view before a deleted view, and saves a move to the top", async () => {
  const { view, el, settle, save } = await mount([
    result([row("ANNOTBBB")]),
    result([row("ANNOTAAA")]),
    result([row("ANNOTBBB")]),
  ]);
  await act(() => view.setText(FILE));
  await settle();
  await act(() => view.pickView("Everything"));
  await settle();
  await act(() => view.deleteView(1));
  await settle();
  expect(el.querySelector("[data-query-view-menu]")?.textContent).toBe(
    "Yellow",
  );
  expect(save.mock.calls.at(-1)![0]).not.toContain("Everything");

  await act(() => {
    view.addView();
  });
  await act(() => view.moveView(1, 0));
  await settle();
  const saved = save.mock.calls.at(-1)![0];
  expect(saved.indexOf("name: View")).toBeLessThan(
    saved.indexOf("name: Yellow"),
  );
});

const TAGGED = `views:
  - type: annotations
    name: Tags
    from: annotations
    groupBy:
      property: tags[]
      direction: ASC
`;

function tagged(key: string, tags: string[]): QueryViewRow {
  return { ...row(key), values: { ...row(key).values, tags } };
}

function headings(el: HTMLElement): (string | null)[] {
  return [...el.querySelectorAll("[data-query-group]")].map(
    (node) => node.textContent,
  );
}

it("shows a card with two tags under both tag headings, and counts it once", async () => {
  const { view, el, run, settle } = await mount([
    result([
      tagged("ANNOTAAA", ["figure", "method"]),
      tagged("ANNOTBBB", ["method"]),
    ]),
  ]);
  await act(() => view.setText(TAGGED));
  await settle();

  expect(run.mock.calls[0]![0].fields).toContain("tags");
  expect(headings(el)).toEqual(["figure", "method"]);
  expect(cards(el)).toEqual(["ANNOTAAA", "ANNOTAAA", "ANNOTBBB"]);
  expect(el.querySelector("[data-query-count]")?.textContent).toBe("2 results");
});

it("collapses a group heading and expands it again", async () => {
  const { view, el, settle } = await mount([
    result([tagged("ANNOTAAA", ["figure"]), tagged("ANNOTBBB", ["method"])]),
  ]);
  await act(() => view.setText(TAGGED));
  await settle();

  const toggle = () =>
    el.querySelector<HTMLElement>('[data-query-group="figure"] button')!;
  await act(() => toggle().click());
  expect(toggle().getAttribute("aria-expanded")).toBe("false");
  expect(cards(el)).toEqual(["ANNOTBBB"]);
  await act(() => toggle().click());
  expect(cards(el)).toEqual(["ANNOTAAA", "ANNOTBBB"]);
});

function choose(select: HTMLSelectElement, value: string) {
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

it("adds sorts from the toolbar, runs them in order, and saves them to the file", async () => {
  const { view, el, run, settle, saved } = await mount([]);
  await act(() => view.setText(TAGGED));
  await settle();

  const editor = () =>
    el.querySelector<HTMLElement>('[data-query-popover="sort"]')!;
  // The sort list offers only properties ZotLit Query can sort.
  const offered = [
    ...editor().querySelectorAll<HTMLButtonElement>("[data-sort-add]"),
  ];
  expect(offered).toHaveLength(1);
  await act(() => offered[0]!.click());
  await act(() =>
    editor().querySelector<HTMLButtonElement>("[data-sort-add]")!.click(),
  );
  const properties = () => [
    ...editor().querySelectorAll<HTMLSelectElement>("[data-sort-property]"),
  ];
  const options = [...properties()[0]!.options].map((o) => o.value);
  expect(options).not.toContain("text");
  expect(options).not.toContain("pageLabel");
  await act(() => choose(properties()[1]!, "dateAdded"));
  await act(() =>
    choose(
      editor().querySelectorAll<HTMLSelectElement>("[data-sort-direction]")[1]!,
      "DESC",
    ),
  );
  await settle();

  expect(run.mock.calls.at(-1)![0].sort).toEqual([
    { field: "sortIndex", direction: "asc" },
    { field: "dateAdded", direction: "desc" },
  ]);
  expect(saved.at(-1)).toContain(`    sort:
      - property: sortIndex
        direction: ASC
      - property: dateAdded
        direction: DESC
`);

  // Alt+ArrowDown on the first row's handle gives it the second place.
  await act(() => {
    editor()
      .querySelector<HTMLElement>("[data-reorder-handle]")!
      .dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          altKey: true,
          bubbles: true,
        }),
      );
  });
  expect(properties().map((select) => select.value)).toEqual([
    "dateAdded",
    "sortIndex",
  ]);
});

it("sets a Manual group order where a tick hides a group, and saves it to the file", async () => {
  const { view, el, settle, saved } = await mount([
    result([tagged("ANNOTAAA", ["figure"]), tagged("ANNOTBBB", ["method"])]),
    result([tagged("ANNOTAAA", ["figure"]), tagged("ANNOTBBB", ["method"])]),
    result([tagged("ANNOTAAA", ["figure"]), tagged("ANNOTBBB", ["method"])]),
  ]);
  await act(() => view.setText(TAGGED));
  await settle();

  const editor = () =>
    el.querySelector<HTMLElement>('[data-query-popover="group"]')!;
  await act(() =>
    choose(
      editor().querySelector<HTMLSelectElement>("[data-group-direction]")!,
      "MANUAL",
    ),
  );
  await settle();
  const rows = () => [
    ...editor().querySelectorAll<HTMLElement>("[data-group-row]"),
  ];
  expect(
    rows().map((row) => [
      row.textContent,
      row.querySelector<HTMLInputElement>("input")!.checked,
    ]),
  ).toEqual([
    ["figure1", true],
    ["method1", true],
  ]);

  await act(() => rows()[0]!.querySelector<HTMLInputElement>("input")!.click());
  await settle();

  expect(headings(el)).toEqual(["method"]);
  expect(cards(el)).toEqual(["ANNOTBBB"]);
  expect(saved.at(-1)).toContain(`    groupOrder:
      - method
`);
  expect(view.state.getState().view?.groupOrder).toEqual(["method"]);
});

it("finds text in the shown cards from the toolbar search", async () => {
  const { view, el, settle } = await mount([
    result([row("ANNOTAAA"), row("ANNOTBBB")]),
  ]);
  await act(() => view.setText(FILE));
  await settle();

  await act(() =>
    el.querySelector<HTMLElement>('[data-query-toolbar="search"]')!.click(),
  );
  const input = el.querySelector<HTMLInputElement>("[data-query-search]")!;
  await act(() => {
    input.value = "of ANNOTBBB";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(cards(el)).toEqual(["ANNOTBBB"]);
});

function filterFault(from: number, to: number): QueryViewOutcome {
  return {
    kind: "failed",
    diagnostic: {
      code: "unknown-field",
      message: "colourName is not a field of Annotations.",
      hint: "Use colorName.",
      severity: "error",
      report: ["colourName is not a field of Annotations."],
      location: { argument: "filter", span: { from, to } },
      found: "colourName",
      expected: [],
      suggestions: ["colorName"],
    },
  };
}

it("writes a filter change to the file, and runs the view with it", async () => {
  const written: string[] = [];
  const { view, run, settle } = await mount(
    [result([row("ANNOTBBB")]), result([row("ANNOTAAA")])],
    (text) => written.push(text),
  );
  await act(() => view.setText(FILE));
  await settle();

  await act(() => {
    view.setFilters("view", {
      and: ['colorName == "yellow"', 'tags.contains("figure")'],
    });
  });
  await settle();

  expect(written).toHaveLength(1);
  expect(written[0]).toContain(`    filters:
      and:
        - colorName == "yellow"
        - tags.contains("figure")`);
  expect(run.mock.calls[1]![0].filter).toBe(
    '(colorName == "yellow") && (tags.contains("figure"))',
  );
});

it("shows a wrong condition's diagnostic at its row and keeps the last good results", async () => {
  const { view, el, settle } = await mount(
    [result([row("ANNOTBBB")]), filterFault(1, 11)],
    () => {},
  );
  await act(() => view.setText(FILE));
  await settle();

  await act(() => {
    view.setFilters("view", {
      and: ['colourName == "yellow"', 'tags.contains("figure")'],
    });
  });
  await settle();

  expect(view.state.getState().filterIssue).toEqual({
    section: "view",
    path: [0],
    message: "colourName is not a field of Annotations. Use colorName.",
  });
  expect(cards(el)).toEqual(["ANNOTBBB"]);
  expect(el.querySelector("[data-query-filter-error]")?.textContent).toBe(
    "The filter has an error. The view shows the last results.",
  );
});

function section(el: HTMLElement, name: "all" | "view"): HTMLElement {
  return el.querySelector<HTMLElement>(`[data-filter-section="${name}"]`)!;
}

function chooseValue(select: HTMLSelectElement, value: string) {
  select.value = value;
  select.dispatchEvent(new Event("input", { bubbles: true }));
}

it("edits the filters for all views and for this view from the Filter popover", async () => {
  const written: string[] = [];
  const { view, el, run, settle } = await mount(
    [result([row("ANNOTBBB")]), result([]), result([])],
    (text) => written.push(text),
  );
  await act(() => view.setText(FILE));
  await settle();

  expect(
    el.querySelector('[data-query-toolbar="filter"]')?.textContent,
  ).toContain("Filter");
  expect(section(el, "all").textContent).toContain("All views");
  expect(section(el, "view").textContent).toContain("This view");

  const [color] = section(el, "view").querySelectorAll("[data-condition-row]");
  await act(() =>
    chooseValue(color!.querySelector('select[aria-label="Value"]')!, "red"),
  );
  await settle();
  expect(written.at(-1)).toContain(
    'filters:\n      and:\n        - colorName == "red"',
  );
  expect(run.mock.calls.at(-1)![0].filter).toBe('colorName == "red"');

  // The starter row of the empty "All views" section is a colour condition.
  const [starter] = section(el, "all").querySelectorAll("[data-condition-row]");
  await act(() =>
    chooseValue(starter!.querySelector('select[aria-label="Value"]')!, "blue"),
  );
  await settle();
  expect(written.at(-1)).toMatch(
    /^filters:\n  and:\n    - colorName == "blue"\n/,
  );
  expect(run.mock.calls.at(-1)![0].filter).toBe(
    '(colorName == "blue") && (colorName == "red")',
  );
});

it("shows the query's diagnostic at the wrong condition in the Filter popover", async () => {
  const { view, el, settle } = await mount(
    [result([row("ANNOTBBB")]), filterFault(1, 11)],
    () => {},
  );
  await act(() => view.setText(FILE));
  await settle();
  await act(() => {
    view.setFilters("view", {
      and: ['colourName == "yellow"', 'tags.contains("figure")'],
    });
  });
  await settle();

  const rows = section(el, "view").querySelectorAll("[data-condition-row]");
  expect(rows[0]!.querySelector('[role="alert"]')?.textContent).toBe(
    "colourName is not a field of Annotations. Use colorName.",
  );
  expect(rows[1]!.querySelector('[role="alert"]')).toBeNull();
});

it("offers the Tags and Collections of the Libraries the view reads", async () => {
  const { view } = await mount([]);
  await expect(view.filterValues()).resolves.toEqual({
    tags: ["figure", "group", "method"],
    collections: ["Thesis/Methods"],
    libraries: [
      { id: "personal", name: null },
      { id: "group:4815", name: "Lab" },
    ],
  });
});

it("counts every match, and says how many of them the limit shows", async () => {
  const { view, el, settle } = await mount([
    result([row("ANNOTAAA"), row("ANNOTBBB")], 12),
  ]);
  await act(() => view.setText(FILE));
  await settle();

  const count = el.querySelector("[data-query-count]");
  expect(count?.getAttribute("data-query-count")).toBe("2");
  expect(count?.getAttribute("data-query-matched")).toBe("12");
  expect(count?.textContent).toBe("2 of 12 results");
});

function valued(key: string, comment: string): QueryViewRow {
  return {
    ...row(key),
    values: { ...row(key).values, comment, pageLabel: "4" },
  };
}

it("reads the visible properties with the rows, and gives them as the table's columns in order", async () => {
  const { view, run, settle } = await mount([
    result([valued("ANNOTAAA", "Key figure"), valued("ANNOTBBB", "")]),
  ]);
  await act(() =>
    view.setText(`views:
  - type: annotations
    name: Shared
    from: annotations
    order:
      - pageLabel
      - comment
`),
  );
  await settle();

  expect(run.mock.calls[0]![0].fields).toEqual(
    expect.arrayContaining(["pageLabel", "comment"]),
  );
  expect(view.state.getState().view?.order).toEqual(["pageLabel", "comment"]);
  expect(view.table()).toEqual({
    header: ["pageLabel", "comment"],
    body: [
      ["4", "Key figure"],
      ["4", ""],
    ],
  });
});

it("saves a new order and a new limit to the file, and runs the view again with them", async () => {
  const { view, run, saved, settle } = await mount([]);
  await act(() => view.setText(FILE));
  await settle();

  await act(() => view.editView({ order: ["comment"], limit: 5 }));
  await settle();
  expect(saved).toHaveLength(1);
  expect(saved[0]).toContain("    order:\n      - comment\n");
  expect(saved[0]).toContain("    limit: 5\n");
  expect(run.mock.calls.at(-1)![0]).toMatchObject({ limit: 5 });
  expect(view.state.getState().view?.name).toBe("Yellow");

  await act(() => view.editView({ limit: undefined }));
  await settle();
  expect(saved[1]).not.toContain("limit: 5");
  expect(run.mock.calls.at(-1)![0]).toMatchObject({ limit: null });
});

/** The rows a List or Cards layout shows, as their Indexed Keys. */
function shownRows(el: HTMLElement): (string | null)[] {
  return [...el.querySelectorAll("[data-query-row]")].map((node) =>
    node.getAttribute("data-query-row"),
  );
}

function item(key: string, title: string, year: string): QueryViewRow {
  return {
    indexedKey: key,
    values: { title, "date.year": year, tags: ["thesis"] },
  };
}

it("lists the Items of an items view, with the visible properties in their order", async () => {
  const { view, el, run, settle } = await mount([
    result([
      item("ITEMAAAA", "Ten simple rules", "2021"),
      item("ITEMBBBB", "Reading at scale", "2019"),
    ]),
  ]);
  await act(() =>
    view.setText(`views:
  - type: list
    name: Sources
    from: items
    order:
      - date.year
      - title
`),
  );
  await settle();

  expect(view.state.getState().problems).toEqual([]);
  const [request] = run.mock.calls[0]!;
  expect(request.from).toBe("items");
  expect(request.fields).toEqual(
    expect.arrayContaining(["date.year", "title"]),
  );
  expect(request.fields).not.toContain("color");
  expect(shownRows(el)).toEqual(["ITEMAAAA", "ITEMBBBB"]);
  expect(
    [...el.querySelectorAll("[data-query-row]")].map((n) => n.textContent),
  ).toEqual(["2021, Ten simple rules", "2019, Reading at scale"]);
  expect(cards(el)).toEqual([]);
});

it("switches an Annotations view to Cards and to List, and keeps its rows, filters, sort and grouping", async () => {
  const { view, el, run, settle, saved } = await mount([
    result([
      tagged("ANNOTAAA", ["figure", "method"]),
      tagged("ANNOTBBB", ["method"]),
    ]),
  ]);
  await act(() =>
    view.setText(`views:
  - type: annotations
    name: Tags
    from: annotations
    filters: colorName == "yellow"
    sort:
      - property: dateAdded
        direction: DESC
    groupBy:
      property: tags[]
      direction: ASC
    order:
      - tags
`),
  );
  await settle();
  expect(cards(el)).toEqual(["ANNOTAAA", "ANNOTAAA", "ANNOTBBB"]);

  await act(() => view.setViewLayout(0, "cards"));
  await settle();
  expect(cards(el)).toEqual([]);
  expect(shownRows(el)).toEqual(["ANNOTAAA", "ANNOTAAA", "ANNOTBBB"]);
  expect(headings(el)).toEqual(["figure", "method"]);
  expect(el.querySelector("[data-query-count]")?.textContent).toBe("2 results");

  await act(() => view.setViewLayout(0, "list"));
  await settle();
  expect(shownRows(el)).toEqual(["ANNOTAAA", "ANNOTAAA", "ANNOTBBB"]);
  expect(headings(el)).toEqual(["figure", "method"]);

  // Each switch saves the layout alone; the query stays as it was.
  const text = saved.at(-1)!;
  expect(text).toContain("type: list");
  expect(text).toContain('filters: colorName == "yellow"');
  expect(text).toContain("property: dateAdded");
  expect(text).toContain("property: tags[]");
  expect(
    new Set(run.mock.calls.map(([request]) => JSON.stringify(request))),
  ).toHaveLength(1);

  // Back on the Annotations layout, the same rows are cards again.
  await act(() => view.setViewLayout(0, "annotations"));
  await settle();
  expect(cards(el)).toEqual(["ANNOTAAA", "ANNOTAAA", "ANNOTBBB"]);
  expect(shownRows(el)).toEqual([]);
});

it("draws the List and Cards options at once, and saves them to the file", async () => {
  const { view, el, run, settle, saved } = await mount([
    result([item("ITEMAAAA", "Ten simple rules", "2021")]),
  ]);
  await act(() =>
    view.setText(`views:
  - type: cards
    name: Sources
    from: items
    order:
      - title
      - date.year
`),
  );
  await settle();
  const card = el.querySelector("[data-query-row]")!;
  expect(card.textContent).toBe("Ten simple rulesdate.year2021");
  expect(
    el.querySelector("[data-card-size]")?.getAttribute("data-card-size"),
  ).toBe("200");

  await act(() => view.setViewOption(0, "cardSize", 320));
  expect(
    el.querySelector("[data-card-size]")?.getAttribute("data-card-size"),
  ).toBe("320");
  expect(saved.at(-1)).toContain("cardSize: 320");

  await act(() => view.setViewLayout(0, "list"));
  await settle();
  expect(el.querySelector("ul[data-query-markers='bullet']")).not.toBeNull();
  await act(() => view.setViewOption(0, "markers", "number"));
  await act(() => view.setViewOption(0, "separator", " · "));
  expect(el.querySelector("ol[data-query-markers='number']")).not.toBeNull();
  expect(el.querySelector("[data-query-row]")?.textContent).toBe(
    "Ten simple rules · 2021",
  );
  await act(() => view.setViewOption(0, "indentProperties", true));
  expect(
    [...el.querySelectorAll("[data-query-row] span")].map((n) => n.textContent),
  ).toEqual(["Ten simple rules", "2021", "2021"]);
  const text = saved.at(-1)!;
  expect(text).toContain("markers: number");
  expect(text).toContain("indentProperties: true");
  expect(run).toHaveBeenCalledTimes(1);
});

const TABLE_FILE = `views:
  - type: table
    name: Reading list
    from: items
    order:
      - title
      - date
`;

function itemRow(
  key: string,
  title: string,
  attachments: string[] = [],
): QueryViewRow {
  return {
    indexedKey: key,
    values: {
      title,
      // A date as ZotLit Query gives it; the Table shows it as Zotero does.
      date: {
        kind: "year",
        value: null,
        year: 2014,
        month: null,
        day: null,
        text: null,
        raw: "2014-00-00 2014",
      },
      itemType: "journalArticle",
      "attachments[].indexedKey": attachments,
    },
  };
}

/** The Table's rows as text: each cell of each row, the header first. */
function tableText(el: HTMLElement): string[][] {
  return [...el.querySelectorAll("[data-query-table] tr")].map((tr) =>
    [...tr.querySelectorAll("th, td")].map(
      (cell) => cell.textContent?.trim() ?? "",
    ),
  );
}

it("shows a view of Items as a Table: one row for each Item, a column for each visible property", async () => {
  const { view, el, run, settle } = await mount([
    result([
      itemRow("ITEMAAAA", "Ten simple rules"),
      itemRow("ITEMBBBB", "Deep learning"),
    ]),
  ]);
  await act(() => view.setText(TABLE_FILE));
  await settle();

  expect(view.state.getState().problems).toEqual([]);
  expect(run.mock.calls[0]![0]).toMatchObject({ from: "items" });
  expect(run.mock.calls[0]![0].fields).toEqual(
    expect.arrayContaining(["title", "date"]),
  );
  expect(tableText(el)).toEqual([
    ["", "Title", "Date", "Literature note"],
    ["", "Ten simple rules", "2014", "Create"],
    ["", "Deep learning", "2014", "Create"],
  ]);
  expect(cards(el)).toEqual([]);
  expect(el.querySelector("[data-query-count]")?.textContent).toBe("2 results");
});

it("expands an Item row into its Attachments, and an Attachment row into its Annotations", async () => {
  const { view, el, run, settle } = await mount([
    result([
      itemRow("ITEMAAAA", "Ten simple rules", ["PDFAAAAA"]),
      itemRow("ITEMBBBB", "Deep learning"),
    ]),
    result([
      {
        indexedKey: "PDFAAAAA",
        values: {
          title: "Full text PDF",
          "annotations[].indexedKey": ["ANNOTAAA"],
        },
      },
    ]),
    result([
      {
        indexedKey: "ANNOTAAA",
        values: {
          text: "Rule 1: know your audience",
          color: "#ffd400",
          pageLabel: "3",
        },
      },
    ]),
  ]);
  await act(() => view.setText(TABLE_FILE));
  await settle();

  // Only an Item with Attachments can expand.
  expect(
    [...el.querySelectorAll("[data-query-expand]")].map((node) =>
      node.getAttribute("data-query-expand"),
    ),
  ).toEqual(["item:ITEMAAAA"]);

  await act(async () => {
    el.querySelector<HTMLElement>(
      '[data-query-expand="item:ITEMAAAA"]',
    )!.click();
  });
  await act(async () => {});
  expect(run.mock.calls[1]![0]).toMatchObject({
    from: "attachments",
    filter: 'item.indexedKey == "ITEMAAAA"',
  });
  await act(async () => {
    el.querySelector<HTMLElement>(
      '[data-query-expand="attachment:PDFAAAAA"]',
    )!.click();
  });
  await act(async () => {});
  expect(run.mock.calls[2]![0]).toMatchObject({
    from: "annotations",
    filter: 'attachment.indexedKey == "PDFAAAAA"',
  });
  expect(tableText(el)).toEqual([
    ["", "Title", "Date", "Literature note"],
    ["", "Ten simple rules", "2014", "Create"],
    ["", "Full text PDF"],
    ["", "Rule 1: know your audiencePage 3"],
    ["", "Deep learning", "2014", "Create"],
  ]);

  // Collapsing the Item hides every row under it.
  await act(async () => {
    el.querySelector<HTMLElement>(
      '[data-query-expand="item:ITEMAAAA"]',
    )!.click();
  });
  expect(tableText(el)).toHaveLength(3);
});

it("links an Item's Literature Note, and creates one where it has none, then links it", async () => {
  const { view, el, settle, literatureNotes } = await mount(
    [
      result([
        itemRow("ITEMAAAA", "Ten simple rules"),
        itemRow("ITEMBBBB", "Deep learning"),
      ]),
    ],
    undefined,
    { notes: { ITEMAAAA: "Rougier 2014.md" } },
  );
  await act(() => view.setText(TABLE_FILE));
  await settle();

  const link = el.querySelector<HTMLElement>(
    '[data-query-note="Rougier 2014.md"]',
  )!;
  expect(link.textContent).toBe("Rougier 2014");
  await act(() => link.click());
  expect(literatureNotes.open).toHaveBeenCalledWith(
    expect.objectContaining({ path: "Rougier 2014.md" }),
    expect.anything(),
  );

  await act(async () => {
    el.querySelector<HTMLElement>(
      '[data-query-create-note="ITEMBBBB"]',
    )!.click();
  });
  expect(literatureNotes.create).toHaveBeenCalledWith("ITEMBBBB");
  expect(el.querySelector("[data-query-create-note]")).toBeNull();
  expect(el.querySelector('[data-query-note="ITEMBBBB.md"]')?.textContent).toBe(
    "ITEMBBBB",
  );
});

it("sorts, groups and searches the Table by Item fields", async () => {
  const { view, el, run, settle } = await mount([
    result([
      {
        ...itemRow("ITEMAAAA", "Ten simple rules"),
        values: {
          ...itemRow("ITEMAAAA", "Ten simple rules").values,
          itemType: "journalArticle",
        },
      },
      {
        ...itemRow("ITEMBBBB", "Deep learning"),
        values: {
          ...itemRow("ITEMBBBB", "Deep learning").values,
          itemType: "book",
        },
      },
    ]),
  ]);
  await act(() =>
    view.setText(`views:
  - type: table
    name: Reading list
    from: items
    sort:
      - property: title
        direction: DESC
    groupBy:
      property: itemType
      direction: ASC
    order:
      - title
`),
  );
  await settle();

  expect(view.state.getState().problems).toEqual([]);
  expect(run.mock.calls[0]![0]).toMatchObject({
    from: "items",
    sort: [{ field: "title", direction: "desc" }],
  });
  expect(tableText(el)).toEqual([
    ["", "Title", "Literature note"],
    ["Book"],
    ["", "Deep learning", "Create"],
    ["Journal Article"],
    ["", "Ten simple rules", "Create"],
  ]);

  await act(() =>
    el.querySelector<HTMLElement>('[data-query-toolbar="search"]')!.click(),
  );
  const input = el.querySelector<HTMLInputElement>("[data-query-search]")!;
  await act(() => {
    input.value = "deep";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(tableText(el)).toEqual([
    ["", "Title", "Literature note"],
    ["Book"],
    ["", "Deep learning", "Create"],
  ]);
});

it("offers Item fields to sort and group a view of Items by", async () => {
  const { view, el, settle } = await mount([result([])]);
  await act(() => view.setText(TABLE_FILE));
  await settle();
  await act(() =>
    el.querySelector<HTMLElement>('[data-query-toolbar="group"]')!.click(),
  );
  expect(document.body.textContent).toContain("Item type");
  expect(document.body.textContent).not.toContain("Attachment");
});

it("switches a view of Annotations to Items, saves it, and draws the Items in the Table", async () => {
  const { view, el, run, saved, settle } = await mount([
    result([row("ANNOTBBB")]),
    result([itemRow("ITEMAAAA", "Ten simple rules")]),
  ]);
  await act(() => view.setText(FILE));
  await settle();
  expect(cards(el)).toEqual(["ANNOTBBB"]);

  await act(() => view.setViewDataset(0, "items"));
  await settle();
  expect(saved.at(-1)).toContain("type: table");
  expect(saved.at(-1)).toContain("from: items");
  expect(run.mock.calls.at(-1)![0]).toMatchObject({ from: "items" });
  expect(cards(el)).toEqual([]);
  // A view with no visible properties shows the default fields of Items.
  const [header, first] = tableText(el);
  expect(header).toContain("Title");
  expect(first).toContain("Journal Article");
  expect(first).toContain("Ten simple rules");
  expect(first!.at(-1)).toBe("Create");
});

it("keeps what the new dataset lacks in the file, says the view does not use it, and uses it again on the old dataset", async () => {
  const { view, el, run, saved, settle } = await mount([
    result([row("ANNOTBBB")]),
    result([itemRow("ITEMAAAA", "Ten simple rules")]),
    result([row("ANNOTBBB")]),
  ]);
  await act(() =>
    view.setText(`views:
  - type: annotations
    name: Yellow
    from: annotations
    sort:
      - property: pageIndex
        direction: ASC
    groupBy:
      property: item.indexedKey
      direction: ASC
`),
  );
  await settle();

  await act(() => view.setViewDataset(0, "items"));
  await settle();
  // The file keeps the sort and the grouping; the Items run without them.
  expect(saved.at(-1)).toContain("property: pageIndex");
  expect(saved.at(-1)).toContain("property: item.indexedKey");
  const items = run.mock.calls.at(-1)![0];
  expect(items).toMatchObject({ from: "items" });
  expect(items).not.toHaveProperty("sort");
  expect(view.state.getState().problems).toEqual([]);
  expect(tableText(el)[1]).toContain("Ten simple rules");
  expect(el.querySelector("[data-query-unused]")?.textContent).toBe(
    "Items have no pageIndex, item.indexedKey, so this view does not use them.",
  );
  await act(() =>
    el.querySelector<HTMLElement>('[data-query-toolbar="sort"]')!.click(),
  );
  expect(
    document.body
      .querySelector('[data-sort-row="pageIndex"]')
      ?.hasAttribute("data-sort-unused"),
  ).toBe(true);
  await act(() =>
    el.querySelector<HTMLElement>('[data-query-toolbar="group"]')!.click(),
  );
  expect(document.body.querySelector("[data-group-unused]")).not.toBeNull();

  await act(() => view.setViewDataset(0, "annotations"));
  await settle();
  expect(run.mock.calls.at(-1)![0]).toMatchObject({
    from: "annotations",
    sort: [{ field: "pageIndex", direction: "asc" }],
  });
  expect(el.querySelector("[data-query-unused]")).toBeNull();
  expect(view.state.getState().groups.map((group) => group.label)).toEqual([
    "Ten simple rules",
  ]);
});

it("shows no rows of the old dataset when the filters fail on the new one", async () => {
  const { view, el, settle } = await mount([
    result([row("ANNOTBBB")]),
    filterFault(0, 9),
  ]);
  await act(() => view.setText(FILE));
  await settle();

  await act(() => {
    view.setViewDataset(0, "items");
  });
  await settle();
  expect(view.state.getState()).toMatchObject({
    phase: "failed",
    keptResults: false,
    records: [],
  });
  expect(cards(el)).toEqual([]);
});
