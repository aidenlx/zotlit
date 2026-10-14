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

function result(rows: QueryViewRow[]): QueryViewOutcome {
  return {
    kind: "result",
    result: {
      libraries: [{ type: "personal" }],
      query: {} as never,
      returnedCount: rows.length,
      truncated: false,
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
  });
  const el = document.createElement("div");
  document.body.append(el);
  view.load();
  await act(() => view.render(el));
  cleanup.defer(() => act(() => view.unload()));
  const settle = () =>
    act(async () => {
      await view.settled;
    });
  return { view, el, run, reads, libraryScope, held, released, settle };
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
