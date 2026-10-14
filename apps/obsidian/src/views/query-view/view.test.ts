// @vitest-environment happy-dom
// The Query View runs one view of a Query File through ZotLit Query and shows
// its rows as live Annotation Cards. These tests drive it as a host does: the
// file's text in, the cards, the count and the messages out.
import { resetMockPlatform, setMockPlatform } from "@mock/obsidian";
import { Scope } from "obsidian";
import type { App } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";

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

async function mount(answers: QueryViewOutcome[]) {
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
  const deps = {
    app: editorApp() as unknown as App,
    reads: { on: reads.on },
    libraryScope: { on: libraryScope.on },
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
  } as unknown as QueryViewDeps;
  const view = new QueryView(deps, {
    scope: new Scope(),
    sourcePath: () => "query-files/Reading.zotquery",
    context: () => undefined,
    save: (text) => saved.push(text),
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
  return { view, el, run, reads, libraryScope, held, released, settle, saved };
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
    view.setText("views:\n  - type: table\n    name: Items\n    from: items\n"),
  );
  await settle();
  expect(run).not.toHaveBeenCalled();
  expect(el.querySelector("[data-query-problems]")?.textContent).toContain(
    "table",
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
