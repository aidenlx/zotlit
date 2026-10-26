// @vitest-environment happy-dom
import { Menu, setMockPlatform } from "@mock/obsidian";
import { delay } from "@std/async";
import { Effect, Stream, SubscriptionRef } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { debounce, Scope } from "obsidian";
import type { App, Menu as ObsidianMenu, WorkspaceLeaf } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";

import type { AnnotViewAttachment } from "@zotlit/db";

import { testEvents } from "@/lib/__fixtures__/event-stream";
import { testRuntime } from "@/lib/__fixtures__/runtime";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { effectBridge } from "@/lib/effect-bridge";
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
import type {
  LocalServer,
  ReaderTarget,
} from "@/services/local-server/service";
import { annotationReads } from "@/services/pdf-annotation-editor/__fixtures__";
import { stubbedReads } from "@/services/zotero-reads/test-utils";
import { noLiteratureNotes } from "@/views/query-view/__fixtures__/literature-notes";
import { requested } from "@/views/query-view/__fixtures__/query-run";
import { serializeQueryFile } from "@/views/query-view/query-file";

import { editorApp } from "./__fixtures__/editor-app";
import { AnnotationView } from "./view";
import type { AnnotViewDeps } from "./view";

vi.mock("zustand", () => import("@/views/__fixtures__/zustand"));

let readsCleanup = new AsyncDisposableStack();
afterEach(async () => {
  await readsCleanup.disposeAsync();
  readsCleanup = new AsyncDisposableStack();
});

class TestView extends AnnotationView {
  close(): Promise<void> {
    return this.onClose();
  }
}

it("settles a pending attachment load without restarting a closed view", async () => {
  const pending = Promise.withResolvers<AnnotViewAttachment[]>();
  const started = Promise.withResolvers<void>();
  const subscribe = vi.fn(() => vi.fn());
  const read = vi.fn(() =>
    Effect.sync(() => {
      subscribe();
      return null;
    }),
  );
  const runtime = testRuntime();
  const reads = readsCleanup.use(stubbedReads());
  vi.spyOn(reads.reads, "AnnotViewAttachments").mockImplementation(() =>
    Effect.promise(() => {
      started.resolve();
      return pending.promise;
    }),
  );
  const deps = stubService<AnnotViewDeps>("AnnotViewDeps", {
    runtime,
    bridge: effectBridge(runtime),
    app: stubService<App>("App", {
      scope: new Scope(),
      loadLocalStorage: () => null,
      workspace: stubService<App["workspace"]>("Workspace", {
        getActiveFile: () => null,
      }),
    }),
    reads: stubService<AnnotViewDeps["reads"]>("ZoteroReads", {
      ...reads,
      state: "ready",
    }),
    libraryScope: stubService<AnnotViewDeps["libraryScope"]>("LibraryScope", {
      libraryRows: [],
    }),
    annotations: stubService<AnnotViewDeps["annotations"]>(
      "AnnotationRepository",
      { read },
    ),
    zoteroPref: { dataDir: "/data", baseAttachmentPath: null },
    literatureNotes: noLiteratureNotes(),
    registry: readsCleanup.adopt(AtomRegistry.make(), (registry) =>
      registry.dispose(),
    ),
  });
  const view = new TestView(
    stubService<WorkspaceLeaf & { app: App }>("WorkspaceLeaf", {
      app: deps.app,
      updateHeader: () => {},
    }),
    deps,
  );
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
      query: { filter: null, fields: [], sort: [], limit: null },
      returnedCount: list.length,
      matchedCount: list.length,
      truncated: false,
      warnings: [],
      rows: list,
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
    listRead,
  }: {
    readsState?: "ready" | "degraded";
    query?: string;
    /** Each Item's attachments, by its key; `attachments` for every Item otherwise. */
    attachmentsOf?: (key: string) => AnnotViewAttachment[];
    /** Each Attachment's list, by its key; the one list otherwise. */
    listOf?: (attachmentKey: string) => AnnotationList;
    /** Settles when the repository answers a read of the Attachment's list. */
    listRead?: (attachmentKey: string) => Promise<void>;
  } = {},
) {
  setMockPlatform({ isMacOS: true });
  let list = LIST;
  const run = vi.fn((request: QueryViewRequest, _signal: AbortSignal) =>
    Promise.resolve(requested(answer(request), request)),
  );
  const reads = testEvents<Record<string, (...args: unknown[]) => void>>([
    "changed",
    "degraded",
    "db-file-missing",
  ]);
  const sourceReads = readsCleanup.use(stubbedReads());
  vi.spyOn(sourceReads.reads, "AnnotViewAttachments").mockImplementation(
    ({ key }) => Effect.succeed(attachmentsOf?.(key) ?? attachments),
  );
  const app = editorApp();
  app.loadLocalStorage = () => null;
  app.saveLocalStorage = () => {};
  app.workspace = stubService<App["workspace"]>("Workspace", {
    trigger: () => {},
    getActiveFile: () => null,
    on: () => ({}),
    requestSaveLayout: debounce(() => Promise.resolve()),
    getMostRecentLeaf: () => null,
  });
  app.metadataCache = stubService<App["metadataCache"]>("MetadataCache", {
    on: () => ({}),
    getFileCache: () => null,
  });
  const events = annotationReads();
  const repository = {
    emit(event: "annotations-changed", attachmentKey: string): void {
      events.replace(
        attachmentKey,
        (listOf?.(attachmentKey) ?? list).annotations,
      );
    },
  };
  const runtime = testRuntime();
  const bridge = effectBridge(runtime);
  const available = Effect.runSync(SubscriptionRef.make(false));
  const readerTarget = Effect.runSync(
    SubscriptionRef.make<ReaderTarget | null>(null),
  );
  const readerClosed = Effect.runSync(SubscriptionRef.make(false));
  const liveUpdate = stubService<LocalServer["Service"]>("LocalServer", {
    available: SubscriptionRef.get(available),
    availableChanges: SubscriptionRef.changes(available),
    readerTarget: SubscriptionRef.get(readerTarget),
    readerTargetChanges: SubscriptionRef.changes(readerTarget),
    readerClosed: SubscriptionRef.get(readerClosed),
    readerClosedChanges: SubscriptionRef.changes(readerClosed),
  });
  const deps = stubService<AnnotViewDeps>("AnnotViewDeps", {
    runtime,
    bridge,
    app,
    opener: stubService<AnnotViewDeps["opener"]>("TargetOpener", {}),
    reads: stubService<AnnotViewDeps["reads"]>("ZoteroReads", {
      state: readsState,
      ...reads.streams,
      reads: sourceReads.reads,
    }),
    libraryScope: stubService<AnnotViewDeps["libraryScope"]>("LibraryScope", {
      libraryRows: [],
      changed: Stream.empty,
      "libraries-changed": Stream.empty,
      current: null,
    }),
    liveUpdate,
    pdfReaders: stubService<AnnotViewDeps["pdfReaders"]>("PdfReaders", {
      on: () => () => {},
      sessionFor: () => null,
    }),
    query: stubService<AnnotViewDeps["query"]>("Query", {
      run,
      on: () => () => {},
      customFieldNames: async () => [],
    }),
    cardFocus: { hold: () => ({ [Symbol.dispose]: () => {} }) },
    annotations: stubService<AnnotViewDeps["annotations"]>(
      "AnnotationRepository",
      {
        ...events,
        capability: Effect.succeed({ kind: "writable" }),
        read: (attachmentKey: string) =>
          Effect.promise(async () => {
            await listRead?.(attachmentKey);
            return listOf?.(attachmentKey) ?? list;
          }),
        peek: () =>
          Effect.succeed({
            value: list,
            status: "fresh" as const,
            settled: Promise.resolve(list),
          }),
        refresh: () => Effect.succeed(list),
        capabilityFor: (): Effect.Effect<EditingCapability> =>
          Effect.succeed({ kind: "writable" }),
        textDraftFor: () => Effect.succeed(null),
        tagDraftFor: () => Effect.succeed(null),
        annotationState: () =>
          Effect.succeed({
            mutation: IDLE,
            textDrafts: { comment: null, text: null },
            tagDraft: null,
            hidden: false,
            gone: false,
          }),
      },
    ),
    zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
    excerptDisplay: { open: vi.fn(), refresh: vi.fn(), revalidate: vi.fn() },
    noteFeature: stubService<AnnotViewDeps["noteFeature"]>(
      "NoteFeatureHandle",
      {},
    ),
    noteIndex: stubService<AnnotViewDeps["noteIndex"]>("NoteIndex", {
      getNotesByItemKey: () => [],
    }),
    literatureNotes: noLiteratureNotes(),
    libraryTagNames: () => Promise.resolve([]),
    allowEditing: vi.fn(),
    reportBlockedGesture: vi.fn(),
    registry: readsCleanup.adopt(AtomRegistry.make(), (registry) =>
      registry.dispose(),
    ),
  });
  const view = new OpenView(
    stubService<WorkspaceLeaf & { app: App }>("WorkspaceLeaf", {
      app: deps.app,
      updateHeader: () => {},
    }),
    deps,
  );
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
    app,
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

it("carries a Follow Mode gesture into the workspace layout and the cards' state", async () => {
  const { view, app, settle } = await openSidebar([PDF]);
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => act(() => view.close()));
  const requestSaveLayout = vi.spyOn(app.workspace, "requestSaveLayout");

  // Restoring the state the layout already holds asks for no save.
  await act(() => view.setState(view.getState(), { history: false }));
  await settle();
  expect(requestSaveLayout).not.toHaveBeenCalled();

  await act(() => view.gestures!.onUnpin());
  await settle();

  expect(view.getState()).toEqual({
    followMode: "active-tab",
    previousMode: "active-tab",
  });
  expect(view.snapshot).toMatchObject({
    followMode: "active-tab",
    pinnedItemKey: null,
  });
  expect(requestSaveLayout).toHaveBeenCalledTimes(1);

  // Switching to the mode in force changes nothing and saves nothing.
  await act(() => view.gestures!.onSetFollowMode("active-tab"));
  expect(requestSaveLayout).toHaveBeenCalledTimes(1);

  await act(() => view.pinItem("ITEMAAAA"));
  await settle();
  expect(view.getState()).toEqual({
    followMode: "pinned",
    previousMode: "active-tab",
    pinnedItemKey: "ITEMAAAA",
  });
  expect(requestSaveLayout).toHaveBeenCalledTimes(2);
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
    found: "",
    expected: [],
    suggestions: [],
  },
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
              found: "",
              expected: [],
              suggestions: [],
              location: {
                argument: "filter",
                span: { from, to: from + "colorName".length },
              },
            },
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

it("shows the next Item's cards where its list is read after 150 ms and its query before", async () => {
  // The query answers at once; the repository reads the next Item's list from
  // Zotero for longer than the next Item waits to show.
  const answer = (request: QueryViewRequest) =>
    rows(request.context?.attachment === "PDFBBBBB" ? ROWS_B : ROWS);
  const { view, settle } = await openSidebar([PDF], answer, {
    attachmentsOf: (key) => (key === "ITEMBBBB" ? [PDF_B] : [PDF]),
    listOf: (key) => (key === "PDFBBBBB" ? LIST_B : LIST),
    listRead: (key) => (key === "PDFBBBBB" ? delay(200) : Promise.resolve()),
  });
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => act(() => view.close()));

  await act(async () => {
    view.pinItem("ITEMBBBB");
    await delay(300);
  });
  await settle();
  expect(cards(view.contentEl)).toEqual(["ANNOTCCC"]);
  expect(view.contentEl.querySelector("[data-annot-view-loading]")).toBeNull();
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
