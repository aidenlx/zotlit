// @vitest-environment happy-dom
import { Menu, setMockPlatform } from "@mock/obsidian";
import { delay } from "@std/async";
import { Effect } from "effect";
import type { Menu as ObsidianMenu, WorkspaceLeaf } from "obsidian";
import { act } from "preact/test-utils";
import { expect, it, vi } from "vitest";

import type { AnnotViewAttachment } from "@zotlit/db";

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
import { noLiteratureNotes } from "@/views/query-view/__fixtures__/literature-notes";
import { requested } from "@/views/query-view/__fixtures__/query-run";
import { serializeQueryFile } from "@/views/query-view/query-file";

import { editorApp } from "./__fixtures__/editor-app";
import { AnnotationView } from "./view";
import type { AnnotViewDeps } from "./view";

vi.mock("zustand", () => import("../__fixtures__/zustand"));

class TestView extends AnnotationView {
  close(): Promise<void> {
    return this.onClose();
  }
}

it("settles a pending attachment load without restarting a closed view", async () => {
  const pending = Promise.withResolvers<AnnotViewAttachment[]>();
  const started = Promise.withResolvers<void>();
  const subscribe = vi.fn(() => vi.fn());
  const read = vi.fn(() => Promise.resolve({ annotations: [], source: null }));
  const deps = {
    app: {
      scope: {},
      loadLocalStorage: () => null,
      workspace: { getActiveFile: () => null },
    },
    reads: {
      state: "ready",
      ready: Promise.resolve({
        reads: {
          ItemsByIndexedKeys: () => Effect.succeed(new Map()),
          AnnotViewAttachments: () =>
            Effect.promise(() => {
              started.resolve();
              return pending.promise;
            }),
        },
      }),
    },
    libraryScope: { libraryRows: [] },
    annotations: { on: subscribe, read },
    zoteroPref: { dataDir: "/data" },
  } as unknown as AnnotViewDeps;
  const view = new TestView({} as WorkspaceLeaf, deps);
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => view.close());
  await view.setState(
    { followMode: "pinned", pinnedItemKey: "BKRV2345" },
    { history: false },
  );
  let settled = false;
  const reading = view.read.then(() => {
    settled = true;
  });
  await started.promise;
  expect(settled).toBe(false);
  await view.close();
  pending.resolve([
    {
      itemID: 2,
      indexedKey: "ATTACH23",
      path: "storage:test.pdf",
      annotCount: 0,
    },
  ]);
  await reading;
  expect(subscribe).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});

// The sidebar is a Query View: the Annotations of the followed Attachment,
// read through `attachment == this.attachment`.

function record(key: string, color: string): AnnotationRecord {
  return {
    key,
    parentKey: "PDFAAAAA",
    type: "highlight",
    color,
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
  annotations: [record("ANNOTAAA", "#ffd400"), record("ANNOTBBB", "#ff6666")],
};

function row(key: string, colorName: string, color: string): QueryViewRow {
  return {
    indexedKey: key,
    attachmentIndexedKey: "PDFAAAAA",
    itemIndexedKey: "ITEMAAAA",
    values: { color, colorName, tags: [] },
  };
}

const ROWS = [
  row("ANNOTAAA", "yellow", "#ffd400"),
  row("ANNOTBBB", "red", "#ff6666"),
];

function rows(list: QueryViewRow[]): QueryViewOutcome {
  return {
    kind: "result",
    result: {
      libraries: [{ type: "personal" }],
      query: {} as never,
      returnedCount: list.length,
      matchedCount: list.length,
      truncated: false,
      warnings: [],
      rows: list,
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

class OpenView extends AnnotationView {
  override readonly containerEl = document.createElement("div");
  open(): Promise<void> {
    return this.onOpen();
  }
  close(): Promise<void> {
    return this.onClose();
  }
}

async function openSidebar(
  attachments: AnnotViewAttachment[],
  answer: (request: QueryViewRequest) => QueryViewOutcome = () => rows(ROWS),
  {
    readsState = "ready",
    query,
    attachmentsOf,
    listOf,
    workspace,
    pdfReaders,
  }: {
    readsState?: "ready" | "degraded";
    /** Replaces members of the workspace the view reads. */
    workspace?: Record<string, unknown>;
    /** The open PDF views' Reader Sessions; none otherwise. */
    pdfReaders?: Pick<AnnotViewDeps["pdfReaders"], "sessionFor">;
    query?: string;
    /** Each Item's attachments, by its key; `attachments` for every Item otherwise. */
    attachmentsOf?: (key: string) => AnnotViewAttachment[];
    /** Each Attachment's list, by its key; the one list otherwise. */
    listOf?: (attachmentKey: string) => AnnotationList;
  } = {},
) {
  setMockPlatform({ isMacOS: true });
  let list = LIST;
  const run = vi.fn((request: QueryViewRequest, _signal: AbortSignal) =>
    Promise.resolve(requested(answer(request), request)),
  );
  const reads = emitter();
  const app = Object.assign(editorApp(), {
    loadLocalStorage: () => null,
    saveLocalStorage: () => {},
    workspace: {
      trigger: () => {},
      getActiveFile: () => null,
      on: () => ({}),
      requestSaveLayout: () => Promise.resolve(),
      leftSplit: {},
      rightSplit: {},
      getMostRecentLeaf: () => null,
      ...workspace,
    },
    metadataCache: { on: () => ({}), getFileCache: () => null },
  });
  const repository = emitter();
  const deps = {
    app,
    reads: {
      state: readsState,
      on: reads.on,
      ready: Promise.resolve({
        reads: {
          ItemsByIndexedKeys: () => Effect.succeed(new Map()),
          AnnotViewAttachments: ({ key }: { key: string }) =>
            Effect.succeed(attachmentsOf?.(key) ?? attachments),
        },
      }),
    },
    libraryScope: { libraryRows: [], on: () => () => {}, current: null },
    liveUpdate: {
      available: false,
      readerClosed: false,
      readerTarget: null,
      on: () => () => {},
    },
    pdfReaders: { on: () => () => {}, sessionFor: () => null, ...pdfReaders },
    query: { run, on: () => () => {} },
    cardFocus: { hold: () => ({ [Symbol.dispose]: () => {} }) },
    annotations: {
      capability: { kind: "writable" },
      read: (attachmentKey: string) =>
        Promise.resolve(listOf?.(attachmentKey) ?? list),
      peek: () => ({ value: list }),
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
      hold: () => ({ [Symbol.dispose]: () => {} }),
    },
    zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
    excerptDisplay: { open: vi.fn(), refresh: vi.fn(), revalidate: vi.fn() },
    noteFeature: {},
    noteIndex: { getNotesByItemKey: () => [] },
    literatureNotes: noLiteratureNotes(),
    libraryTagNames: () => Promise.resolve([]),
    allowEditing: vi.fn(),
    reportBlockedGesture: vi.fn(),
  } as unknown as AnnotViewDeps;
  const view = new OpenView({} as WorkspaceLeaf, deps);
  document.body.append(view.contentEl);
  await act(() => view.open());
  await act(() =>
    view.setState(
      {
        followMode: "pinned",
        pinnedItemKey: "ITEMAAAA",
        ...(query !== undefined && { query }),
      },
      { history: false },
    ),
  );
  const settle = () =>
    act(async () => {
      await view.read;
    });
  await settle();
  return {
    view,
    run,
    reads,
    settle,
    repository,
    /** What the repository holds for the Attachment from now on. */
    setList: (next: AnnotationList) => {
      list = next;
    },
  };
}

function cards(el: HTMLElement): (string | null)[] {
  return [...el.querySelectorAll(".zt-annot-card")].map((node) =>
    node.getAttribute("data-zotero-annotation-key"),
  );
}

const PDF: AnnotViewAttachment = {
  itemID: 2,
  indexedKey: "PDFAAAAA",
  path: "storage:test.pdf",
  annotCount: 2,
};

// Two Attachments can keep one file, so two tabs on that one file can be two
// Reader Sessions; the sidebar follows the tab, not the first session the
// file has.
it("follows the tab it is beside when two tabs show one file as two Attachments", async () => {
  const shared = { ...PDF, indexedKey: "PDFBBBBB", itemID: 3 };
  const tab = (attachmentKey: string) => ({
    view: {},
    session: {
      target: { attachmentKey, itemKey: "ITEMAAAA" },
      addSelectionSurface: () => () => {},
      on: () => () => {},
      source: "obsidian-pdf",
      selected: [],
    },
  });
  const first = tab("PDFAAAAA");
  const second = tab("PDFBBBBB");
  let recent = first;
  const leafChanged: (() => void)[] = [];
  const { view, run, settle } = await openSidebar([PDF, shared], undefined, {
    workspace: {
      getActiveFile: () => ({ path: "storage/shared.pdf" }),
      getMostRecentLeaf: () => recent,
      on: (event: string, cb: () => void) => {
        if (event === "active-leaf-change") leafChanged.push(cb);
        return {};
      },
    },
    pdfReaders: {
      sessionFor: (pdfView) =>
        ([first, second].find((open) => open.view === pdfView)?.session ??
          null) as never,
    },
  });
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => act(() => view.close()));
  await act(() =>
    view.setState({ followMode: "active-tab" }, { history: false }),
  );
  await settle();
  expect(run.mock.calls.at(-1)![0].context).toMatchObject({
    attachment: "PDFAAAAA",
  });

  recent = second;
  await act(() => {
    for (const cb of leafChanged) cb();
  });
  await settle();

  expect(run.mock.calls.at(-1)![0].context).toMatchObject({
    attachment: "PDFBBBBB",
  });
});

function paneMenu(view: AnnotationView, source = "more-options"): Menu {
  const menu = new Menu();
  view.onPaneMenu(menu as unknown as ObsidianMenu, source);
  return menu;
}

function menuItem(menu: Menu, title: string) {
  const item = menu.items.find((entry) => entry.title === title);
  if (!item) throw new Error(`No menu item "${title}"`);
  return item;
}

it("sorts the cards by one property and direction from More options", async () => {
  const { view, run, settle } = await openSidebar([PDF]);
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => act(() => view.close()));

  const sort = menuItem(paneMenu(view), "Sort").submenu!;
  // The Item and the Attachment are the same for every card the sidebar shows.
  expect(sort.items.some(({ title }) => title === "Item title")).toBe(false);
  await act(() => menuItem(sort, "Date added").click());
  await settle();
  await act(() =>
    menuItem(menuItem(paneMenu(view), "Sort").submenu!, "New to old").click(),
  );
  await settle();

  expect(run.mock.calls.at(-1)![0].sort).toEqual([
    { field: "dateAdded", direction: "desc" },
  ]);
});

it("runs the query once for a reload that keeps the Attachment, and again on a database change", async () => {
  const { view, run, reads, settle } = await openSidebar([PDF]);
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => act(() => view.close()));
  const runs = run.mock.calls.length;

  await act(() => view.setState(view.getState(), { history: false }));
  await settle();
  expect(run.mock.calls.length).toBe(runs);

  await act(() => reads.emit("changed"));
  await settle();
  expect(run.mock.calls.length).toBeGreaterThan(runs);
  expect(cards(view.contentEl)).toEqual(["ANNOTAAA", "ANNOTBBB"]);
});

it("runs no query and shows no card while the Item has no Attachment", async () => {
  const { view, run } = await openSidebar([]);
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => act(() => view.close()));

  expect(run).not.toHaveBeenCalled();
  expect(cards(view.contentEl)).toEqual([]);
  // Nothing to sort, group or filter.
  expect(paneMenu(view).items.some(({ title }) => title === "Sort")).toBe(
    false,
  );
});

it("shows a new Annotation's card as its write starts, before the query runs again", async () => {
  const { view, run, repository, setList } = await openSidebar([PDF]);
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => act(() => view.close()));
  const runs = run.mock.calls.length;

  // A create's Pending Proposal stands in the repository's list at once; the
  // database, which the query reads, has it only later.
  const created = {
    ...record("ANNOTNEW", "#5fb236"),
    sortIndex: "00000|000000|00001",
  };
  setList({
    ...LIST,
    annotations: [LIST.annotations[0]!, created, LIST.annotations[1]!],
  });
  await act(() => repository.emit("annotations-changed", "PDFAAAAA"));

  expect(cards(view.contentEl)).toEqual(["ANNOTAAA", "ANNOTNEW", "ANNOTBBB"]);
  expect(run.mock.calls.length).toBe(runs);
});

it("keeps a card the query left out by its filter off the list", async () => {
  const { view, repository } = await openSidebar([PDF], () =>
    rows([row("ANNOTBBB", "red", "#ff6666")]),
  );
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => act(() => view.close()));

  // A write to an Annotation the query did not give changes nothing on screen.
  await act(() => repository.emit("annotations-changed", "PDFAAAAA"));

  expect(cards(view.contentEl)).toEqual(["ANNOTBBB"]);
});

const FAILED: QueryViewOutcome = {
  kind: "failed",
  diagnostic: {
    code: "source-unavailable",
    message: "The Zotero database is busy.",
    hint: "Try again.",
    severity: "error",
    report: [],
  } as never,
};

it("says why the cards cannot show when the query fails", async () => {
  const { view } = await openSidebar([PDF], () => FAILED);
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => act(() => view.close()));

  const text = view.contentEl.textContent ?? "";
  expect(text).toContain("The sidebar cannot show annotations.");
  expect(text).toContain("The Zotero database is busy.");
  expect(text).not.toContain("Loading");
});

it("says that Zotero's data cannot be read", async () => {
  const { view, run } = await openSidebar([PDF], undefined, {
    readsState: "degraded",
  });
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => act(() => view.close()));

  expect(run).not.toHaveBeenCalled();
  expect(
    view.contentEl.querySelector("[data-annot-view-problem]")?.textContent,
  ).toBe("ZotLit cannot read the Zotero database.");
});

it("keeps the last cards under a note when a filter condition has an error", async () => {
  const query = serializeQueryFile({
    filters: "attachment == this.attachment",
    views: [
      {
        type: "annotations",
        name: "Annotations",
        from: "annotations",
        filters: 'colorName == "yellow"',
        problems: [],
        source: {},
      },
    ],
    problems: [],
    source: {},
  });
  // The filter ZotLit Query runs: the file's filters, then the view's.
  const composed = '(attachment == this.attachment) && (colorName == "yellow")';
  const from = composed.indexOf("colorName");
  const { view, settle } = await openSidebar(
    [PDF],
    (request) =>
      request.sort
        ? {
            kind: "failed",
            diagnostic: {
              code: "unknown-field",
              message: "colourName is not a field of Annotations.",
              hint: "",
              severity: "error",
              report: [],
              location: {
                argument: "filter",
                span: { from, to: from + "colorName".length },
              },
            } as never,
          }
        : rows(ROWS),
    { query },
  );
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => act(() => view.close()));

  await act(() =>
    menuItem(menuItem(paneMenu(view), "Sort").submenu!, "Date added").click(),
  );
  await settle();

  expect(cards(view.contentEl)).toEqual(["ANNOTAAA", "ANNOTBBB"]);
  expect(
    view.contentEl.querySelector("[data-annot-view-filter-error]")?.textContent,
  ).toBe("The filter has an error. The sidebar shows the last results.");
});

// A switch to another Item keeps the last one on screen, its name,
// attachments and cards, until the next one's cards are read.

const PDF_B: AnnotViewAttachment = {
  itemID: 3,
  indexedKey: "PDFBBBBB",
  path: "storage:other.pdf",
  annotCount: 1,
};
const LIST_B: AnnotationList = {
  ...LIST,
  annotations: [{ ...record("ANNOTCCC", "#ffd400"), parentKey: "PDFBBBBB" }],
};
const ROWS_B: QueryViewRow[] = [
  {
    ...row("ANNOTCCC", "yellow", "#ffd400"),
    attachmentIndexedKey: "PDFBBBBB",
    itemIndexedKey: "ITEMBBBB",
  },
];

/** A sidebar pinned to ITEMAAAA, whose run for ITEMBBBB waits on `next`. */
async function twoItems(first: () => QueryViewOutcome = () => rows(ROWS)) {
  const next = Promise.withResolvers<QueryViewOutcome>();
  const sidebar = await openSidebar([PDF], first, {
    attachmentsOf: (key) => (key === "ITEMBBBB" ? [PDF_B] : [PDF]),
    listOf: (key) => (key === "PDFBBBBB" ? LIST_B : LIST),
  });
  sidebar.run.mockImplementation((request) =>
    request.context?.attachment === "PDFBBBBB"
      ? next.promise.then((outcome) => requested(outcome, request))
      : Promise.resolve(requested(first(), request)),
  );
  return { ...sidebar, next };
}

it("keeps the last Item's cards and attachments until the next Item's cards are read, then shows the next Item whole", async () => {
  const { view, next, settle } = await twoItems();
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => act(() => view.close()));
  expect(cards(view.contentEl)).toEqual(["ANNOTAAA", "ANNOTBBB"]);

  await act(async () => {
    view.pinItem("ITEMBBBB");
    await delay(20);
  });
  // The query reads the next Item; the last one stays whole.
  expect(cards(view.contentEl)).toEqual(["ANNOTAAA", "ANNOTBBB"]);
  expect(view.snapshot).toMatchObject({
    itemKey: "ITEMAAAA",
    selectedAttachmentKey: "PDFAAAAA",
  });

  next.resolve(rows(ROWS_B));
  await settle();
  expect(cards(view.contentEl)).toEqual(["ANNOTCCC"]);
  expect(view.snapshot).toMatchObject({
    itemKey: "ITEMBBBB",
    selectedAttachmentKey: "PDFBBBBB",
  });
});

it("shows the next Item over its cards loading, and none of the last Item's, once its read takes 150 ms", async () => {
  const { view, next, settle } = await twoItems();
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => act(() => view.close()));

  await act(async () => {
    view.pinItem("ITEMBBBB");
    await delay(200);
  });
  expect(cards(view.contentEl)).toEqual([]);
  expect(
    view.contentEl.querySelector("[data-annot-view-loading]"),
  ).not.toBeNull();
  expect(view.snapshot).toMatchObject({
    itemKey: "ITEMBBBB",
    selectedAttachmentKey: "PDFBBBBB",
  });

  next.resolve(rows(ROWS_B));
  await settle();
  expect(cards(view.contentEl)).toEqual(["ANNOTCCC"]);
});

it("waits for the next Item's own run where the last Item's run had failed", async () => {
  const { view, next, settle } = await twoItems(() => ({
    kind: "failed",
    diagnostic: {
      code: "database-error",
      message: "The database is busy",
      hint: "",
      severity: "error",
      report: [],
      found: "",
      expected: [],
      suggestions: [],
    },
  }));
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => act(() => view.close()));

  await act(async () => {
    view.pinItem("ITEMBBBB");
    await delay(20);
  });
  // The last run's failure says nothing of the next Item.
  expect(view.snapshot.itemKey).toBe("ITEMAAAA");

  next.resolve(rows(ROWS_B));
  await settle();
  expect(cards(view.contentEl)).toEqual(["ANNOTCCC"]);
  expect(view.snapshot.itemKey).toBe("ITEMBBBB");
});
