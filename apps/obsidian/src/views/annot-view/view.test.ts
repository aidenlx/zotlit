// @vitest-environment happy-dom
import { Menu, setMockPlatform } from "@mock/obsidian";
import { Effect, Layer, Stream } from "effect";
import { debounce, Scope, TFile } from "obsidian";
import type { App, Menu as ObsidianMenu, WorkspaceLeaf } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";

import type { AnnotViewAttachment } from "@zotlit/db";

import { testEvents, testEvent } from "@/lib/__fixtures__/event-stream";
import { MemoryMetadataCache } from "@/lib/__fixtures__/obsidian-metadata-cache";
import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { testRuntime } from "@/lib/__fixtures__/runtime";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { effectBridge } from "@/lib/effect-bridge";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import type {
  AnnotationRepository,
  AnnotationList,
  AnnotationRecord,
} from "@/services/annotation-repository/service";
import { IDLE } from "@/services/annotation-repository/write";
import type {
  QueryViewOutcome,
  QueryViewRequest,
  QueryViewRow,
} from "@/services/item-query/query-view";
import { libraryScopeStateAtom } from "@/services/library-scope/atoms";
import { DEFAULT_LIBRARY_SCOPE } from "@/services/library-scope/scope";
import { LibraryScope } from "@/services/library-scope/service";
import type { LibraryScopeState } from "@/services/library-scope/service";
import { activeNoteAtom } from "@/services/note-index/atoms";
import { annotationReads } from "@/services/pdf-annotation-editor/__fixtures__";
import { zoteroRevisionAtom } from "@/services/zotero-reads/atoms";
import { stubbedReads } from "@/services/zotero-reads/test-utils";
import { makeQueryHost } from "@/views/query-view/__fixtures__/host";
import { noLiteratureNotes } from "@/views/query-view/__fixtures__/literature-notes";
import { requested } from "@/views/query-view/__fixtures__/query-run";
import { serializeQueryFile } from "@/views/query-view/query-file";
import { waitFor } from "@/views/template-data-explorer/__fixtures__";

import { editorApp } from "./__fixtures__/editor-app";
import type { AnnotHostOptions } from "./__fixtures__/host";
import { AnnotationView } from "./view";
import type { AnnotViewDeps } from "./view";

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
  const cancelled = Promise.withResolvers<void>();
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
    Effect.promise((signal) => {
      signal.addEventListener("abort", () => cancelled.resolve());
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
      changed: Stream.empty,
      degraded: Stream.empty,
      "db-file-missing": Stream.empty,
    }),
    libraryScope: stubService<AnnotViewDeps["libraryScope"]>("LibraryScope", {
      current: null,
      changed: Stream.empty,
      "libraries-changed": Stream.empty,
    }),
    query: {
      run: async () => ({ kind: "cancelled" }),
      on: () => () => {},
      customFieldNames: async () => [],
    },
    literatureNotes: noLiteratureNotes(),
  });
  const queryHost = readsCleanup.use(
    await makeQueryHost(deps, {
      annotations: { read },
      reads: { reads: reads.reads },
    }),
  );
  deps.registry = queryHost.registry;
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
  await cancelled.promise;
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
    activeNoteKey,
    deferNoteKey = false,
  }: {
    readsState?: "ready" | "degraded";
    query?: string;
    /** Each Item's attachments, by its key; `attachments` for every Item otherwise. */
    attachmentsOf?: (key: string) => AnnotViewAttachment[];
    /** Each Attachment's list, by its key; the one list otherwise. */
    listOf?: (attachmentKey: string) => AnnotationList;
    /** Settles when the repository answers a read of the Attachment's list. */
    listRead?: (attachmentKey: string) => Promise<void>;
    activeNoteKey?: string;
    deferNoteKey?: boolean;
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
  const attachmentReads = vi
    .spyOn(sourceReads.reads, "AnnotViewAttachments")
    .mockImplementation(({ key }) =>
      Effect.succeed(attachmentsOf?.(key) ?? attachments),
    );
  const app = editorApp();
  const workspace = new MemoryWorkspace({ layoutReady: true });
  const metadata = new MemoryMetadataCache();
  if (activeNoteKey)
    workspace.open(
      Object.assign(new TFile(), {
        path: "literatures/paper.md",
        extension: "md",
      }),
    );
  if (activeNoteKey && !deferNoteKey)
    metadata.setCache("literatures/paper.md", {
      frontmatter: { "zotero-key": activeNoteKey },
    });
  app.loadLocalStorage = () => null;
  app.saveLocalStorage = () => {};
  app.workspace = stubService<App["workspace"]>("Workspace", {
    trigger: () => {},
    activeLeaf: null,
    getActiveFile: () => workspace.getActiveFile(),
    on: (name: string, callback: (...args: never[]) => unknown) =>
      workspace.on(name, (...args) => callback(...(args as never[]))),
    offref: (ref) => workspace.offref(ref),
    requestSaveLayout: debounce(() => Promise.resolve()),
    getMostRecentLeaf: () => null,
  });
  app.metadataCache = stubService<App["metadataCache"]>("MetadataCache", {
    on: (name: string, callback: (...args: never[]) => unknown) =>
      metadata.on(name, (...args) => callback(...(args as never[]))),
    offref: (ref) => metadata.offref(ref),
    getFileCache: (file) => metadata.getFileCache(file),
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
  const annotationsApi = stubService<AnnotationRepository["Service"]>(
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
  );
  const scopeChanges = testEvent<LibraryScopeState>();
  const scopeState: LibraryScopeState = {
    current: null,
    all: null,
    invalid: false,
    effective: DEFAULT_LIBRARY_SCOPE,
    libraryRows: [],
  };
  const hostOptions: AnnotHostOptions = {
    sources: { workspace },
    annotations: annotationsApi,
    services: Layer.mock(LibraryScope, {
      changes: Stream.concat(Stream.succeed(scopeState), scopeChanges.stream),
    }),
    reads: {
      reads: sourceReads.reads,
      changes: Stream.succeed({
        state: readsState,
        error: null,
        moved: false,
        dbFileMissing: false,
        activeReadMode: null,
      }),
      events: Stream.map(reads.streams.changed!, () => ({
        _tag: "changed" as const,
      })),
    },
  };
  const deps = stubService<AnnotViewDeps>("AnnotViewDeps", {
    runtime,
    bridge,
    app,
    opener: stubService<AnnotViewDeps["opener"]>("TargetOpener", {}),
    reads: stubService<AnnotViewDeps["reads"]>("ZoteroReads", {
      ...reads.streams,
    }),
    libraryScope: stubService<AnnotViewDeps["libraryScope"]>("LibraryScope", {
      changed: Stream.empty,
      "libraries-changed": Stream.empty,
      current: null,
    }),
    query: stubService<AnnotViewDeps["query"]>("Query", {
      run,
      on: () => () => {},
      customFieldNames: async () => [],
    }),
    cardFocus: { hold: () => ({ [Symbol.dispose]: () => {} }) },
    literatureNotes: noLiteratureNotes(),
  });
  const queryHost = readsCleanup.use(await makeQueryHost(deps, hostOptions));
  deps.registry = queryHost.registry;
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
        ...(activeNoteKey
          ? { followMode: "active-tab" }
          : { followMode: "pinned", pinnedItemKey: "ITEMAAAA" }),
        ...(query !== undefined && { query }),
      },
      { history: false },
    ),
  );
  const settle = () =>
    act(async () => {
      await view.read;
    });
  await act(() =>
    waitFor(() =>
      expect(deps.registry.get(activeNoteAtom).key).toBe(
        deferNoteKey ? null : (activeNoteKey ?? null),
      ),
    ),
  );
  await settle();
  await waitFor(() => expect(reads.subscribers("changed")).toBeGreaterThan(1));
  return {
    view,
    app,
    run,
    attachmentReads,
    workspace,
    metadata,
    registry: deps.registry,
    scopeChanges,
    scopeState,
    reads: {
      ...reads,
      emit: async (...args: Parameters<typeof reads.emit>) => {
        const before = deps.registry.get(zoteroRevisionAtom);
        reads.emit(...args);
        await waitFor(() =>
          expect(deps.registry.get(zoteroRevisionAtom)).toBeGreaterThan(before),
        );
      },
    },

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

it("shows the annotation cards when the Literature Note becomes active again", async () => {
  const { view, app, workspace, reads, settle } = await openSidebar(
    [PDF],
    undefined,
    {
      activeNoteKey: "ITEMAAAA",
    },
  );
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => act(() => view.close()));
  expect(cards(view.contentEl)).toEqual(["ANNOTAAA", "ANNOTBBB"]);

  // A non-file pane can take focus while the active-note Stream still holds the note.
  const note = workspace.activeFile;
  workspace.activeFile = null;
  await act(() => reads.emit("changed"));
  await settle();
  // The note becomes active again with the same key the Stream already holds.
  workspace.activeFile = note;
  app.workspace.activeLeaf = stubService<WorkspaceLeaf>(
    "LiteratureNoteLeaf",
    {},
  );
  await act(() =>
    workspace.trigger("active-leaf-change", app.workspace.activeLeaf),
  );
  await settle();

  expect(view.getState()).toEqual({
    followMode: "active-tab",
    previousMode: "active-tab",
  });
  expect(cards(view.contentEl)).toEqual(["ANNOTAAA", "ANNOTBBB"]);
});

it("shows the annotation cards when the active note key arrives after the view opens", async () => {
  const { view, workspace, metadata, registry, settle } = await openSidebar(
    [PDF],
    undefined,
    { activeNoteKey: "ITEMAAAA", deferNoteKey: true },
  );
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => act(() => view.close()));
  expect(cards(view.contentEl)).toEqual([]);

  await act(() =>
    metadata.change(workspace.activeFile!, {
      frontmatter: { "zotero-key": "ITEMAAAA" },
    }),
  );
  await act(() =>
    waitFor(() => expect(registry.get(activeNoteAtom).key).toBe("ITEMAAAA")),
  );
  await settle();

  expect(cards(view.contentEl)).toEqual(["ANNOTAAA", "ANNOTBBB"]);
});

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
  const started = Promise.withResolvers<void>();
  const sidebar = await openSidebar([PDF], first, {
    attachmentsOf: (key) => (key === "ITEMBBBB" ? [PDF_B] : [PDF]),
    listOf: (key) => (key === "PDFBBBBB" ? LIST_B : LIST),
  });
  sidebar.run.mockImplementation((request) => {
    if (request.context?.attachment === "PDFBBBBB") {
      started.resolve();
      return next.promise.then((outcome) => requested(outcome, request));
    }
    return Promise.resolve(requested(first(), request));
  });
  return { ...sidebar, next, started };
}

it("keeps the last Item's cards and attachments until the next Item's cards are read, then shows the next Item whole", async () => {
  const { view, next, started, settle } = await twoItems();
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => act(() => view.close()));
  expect(cards(view.contentEl)).toEqual(["ANNOTAAA", "ANNOTBBB"]);

  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  cleanup.defer(() => void vi.useRealTimers());
  await act(async () => {
    view.pinItem("ITEMBBBB");
    await started.promise;
  });
  // The query reads the next Item; the last one stays whole.
  expect(cards(view.contentEl)).toEqual(["ANNOTAAA", "ANNOTBBB"]);
  expect(view.snapshot).toMatchObject({
    itemKey: "ITEMAAAA",
    selectedAttachmentKey: "PDFAAAAA",
  });

  vi.useRealTimers();
  next.resolve(rows(ROWS_B));
  await settle();
  expect(cards(view.contentEl)).toEqual(["ANNOTCCC"]);
  expect(view.snapshot).toMatchObject({
    itemKey: "ITEMBBBB",
    selectedAttachmentKey: "PDFBBBBB",
  });
});

it("shows the next Item over its cards loading, and none of the last Item's, once its read takes 150 ms", async () => {
  const { view, next, started, settle } = await twoItems();
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => act(() => view.close()));

  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  cleanup.defer(() => void vi.useRealTimers());
  await act(async () => {
    view.pinItem("ITEMBBBB");
    await started.promise;
    await vi.advanceTimersByTimeAsync(150);
  });
  expect(cards(view.contentEl)).toEqual([]);
  expect(
    view.contentEl.querySelector("[data-annot-view-loading]"),
  ).not.toBeNull();
  expect(view.snapshot).toMatchObject({
    itemKey: "ITEMBBBB",
    selectedAttachmentKey: "PDFBBBBB",
  });

  vi.useRealTimers();
  next.resolve(rows(ROWS_B));
  await settle();
  expect(cards(view.contentEl)).toEqual(["ANNOTCCC"]);
});

it("shows the next Item's cards where its list is read after 150 ms and its query before", async () => {
  // The query answers at once; the repository reads the next Item's list from
  // Zotero for longer than the next Item waits to show.
  const answer = (request: QueryViewRequest) =>
    rows(request.context?.attachment === "PDFBBBBB" ? ROWS_B : ROWS);
  const list = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const { view, settle } = await openSidebar([PDF], answer, {
    attachmentsOf: (key) => (key === "ITEMBBBB" ? [PDF_B] : [PDF]),
    listOf: (key) => (key === "PDFBBBBB" ? LIST_B : LIST),
    listRead: (key) => {
      if (key !== "PDFBBBBB") return Promise.resolve();
      started.resolve();
      return list.promise;
    },
  });
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => act(() => view.close()));

  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  cleanup.defer(() => void vi.useRealTimers());
  await act(async () => {
    view.pinItem("ITEMBBBB");
    await started.promise;
    await vi.advanceTimersByTimeAsync(150);
  });
  expect(cards(view.contentEl)).toEqual([]);
  vi.useRealTimers();
  list.resolve();
  await settle();
  expect(cards(view.contentEl)).toEqual(["ANNOTCCC"]);
  expect(view.contentEl.querySelector("[data-annot-view-loading]")).toBeNull();
});

it("waits for the next Item's own run where the last Item's run had failed", async () => {
  const { view, next, started, settle } = await twoItems(() => ({
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

  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  cleanup.defer(() => void vi.useRealTimers());
  await act(async () => {
    view.pinItem("ITEMBBBB");
    await started.promise;
  });
  // The last run's failure says nothing of the next Item.
  expect(view.snapshot.itemKey).toBe("ITEMAAAA");

  vi.useRealTimers();
  next.resolve(rows(ROWS_B));
  await settle();
  expect(cards(view.contentEl)).toEqual(["ANNOTCCC"]);
  expect(view.snapshot.itemKey).toBe("ITEMBBBB");
});

it("reloads for changed Libraries and keeps the load for a scope selection alone", async () => {
  const { view, attachmentReads, registry, scopeChanges, scopeState, settle } =
    await openSidebar([PDF]);
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => act(() => view.close()));
  const before = attachmentReads.mock.calls.length;
  const selected = { ...scopeState, invalid: true };
  await act(() => scopeChanges.emit(selected));
  expect(registry.get(libraryScopeStateAtom)).toBe(selected);
  expect(attachmentReads).toHaveBeenCalledTimes(before);
  const libraries = { ...selected, libraryRows: [] };
  await act(() => scopeChanges.emit(libraries));
  await settle();
  expect(registry.get(libraryScopeStateAtom)).toBe(libraries);
  expect(attachmentReads).toHaveBeenCalledTimes(before + 1);
});
