// @vitest-environment happy-dom
import type { App, EventRef, WorkspaceLeaf } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnnotViewItem, Item } from "@zotlit/db";

const item = {
  itemID: 1,
  libraryID: 1,
  key: "ABCD2345",
  groupID: null,
  indexedKey: "ABCD2345",
  creators: [],
  primaryCreatorType: "author",
  fields: { itemType: "book", title: "A Book" },
} as unknown as Item;

const annot: AnnotViewItem = {
  itemID: 42,
  key: "ANNOTKEY",
  type: 1, // highlight
  text: "raw highlighted text",
  comment: null,
  color: "#ffd400",
  pageLabel: "1",
  parentKey: "ATCHKEY1",
  tags: [],
};

vi.mock("@zotlit/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@zotlit/db")>();
  return {
    ...actual,
    getLibraries: () => [],
    getItemsByKey: () => [item],
    getItemRefByID: () => null,
    getItemDisplayInfoByID: () => null,
    getAnnotViewAttachments: () => [
      { itemID: 7, path: "storage:a.pdf", annotCount: 1 },
    ],
    getAnnotViewAnnotations: () => [annot],
  };
});

// The React tree is not under test here; the drag handler is.
vi.mock("./AnnotView", () => ({ AnnotView: () => null }));

/** Captured from `createAnnotActions` so the test can fire a drag directly. */
let onDragStart: (evt: unknown, annot: AnnotViewItem) => void;

vi.mock("./actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./actions")>();
  return {
    ...actual,
    createAnnotActions: (deps: { onDragStart: typeof onDragStart }) => {
      onDragStart = deps.onDragStart;
      return {} as never;
    },
  };
});

const { AnnotationView } = await import("./view");

const RENDERED = "> [!quote] rendered by the annotation template";
const LIT_NOTE = "Lit Note.md";

function createDeps() {
  let activeFile: { path: string } | null = null;
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const on = (name: string, cb: (...args: unknown[]) => void): EventRef => {
    (listeners.get(name) ?? listeners.set(name, new Set()).get(name)!).add(cb);
    return {} as EventRef;
  };
  const app = {
    workspace: {
      getActiveFile: () => activeFile,
      on,
      offref: () => undefined,
    },
    metadataCache: {
      on,
      // Only the literature note carries the item key; a blank Ctrl+N note does not.
      getFileCache: (file: { path: string }) =>
        file.path === LIT_NOTE
          ? { frontmatter: { "zotero-key": "ABCD2345" } }
          : null,
    },
    loadLocalStorage: () => null,
    saveLocalStorage: () => undefined,
  } as unknown as App;

  const deps = {
    app,
    db: {
      state: "ready" as const,
      client: {},
      ready: Promise.resolve(),
      on: () => () => undefined,
      refresh: () => Promise.resolve(),
    },
    liveUpdate: {
      available: false,
      readerTarget: null,
      on: () => () => undefined,
    },
    zoteroPref: { dataDir: "/zotero" },
    noteFeature: {
      renderAnnotation: () => RENDERED,
      renderAnnotationCitation: () => null,
    },
    noteIndex: { getNotesByItemKey: () => [] },
    attachmentImport: {
      prepare: () => Promise.resolve({ flush: async () => undefined }),
    },
    itemLookup: { search: () => [] },
    settings: {},
  };

  return {
    deps: deps as unknown as ConstructorParameters<typeof AnnotationView>[1],
    openNote(path: string) {
      activeFile = { path };
      for (const cb of listeners.get("active-leaf-change") ?? []) cb();
    },
  };
}

function drag(): string {
  const data = new Map<string, string>();
  const evt = {
    timeStamp: 1,
    target: { win: globalThis.window } as unknown as HTMLElement,
    dataTransfer: {
      dropEffect: "none",
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? "",
    },
  };
  onDragStart(evt, annot);
  return data.get("text/plain") ?? "";
}

describe("annot view drag-insert", () => {
  let harness: ReturnType<typeof createDeps>;
  let view: InstanceType<typeof AnnotationView>;

  beforeEach(async () => {
    harness = createDeps();
    view = new AnnotationView({} as WorkspaceLeaf, harness.deps);
  });

  it("renders the template when a note is opened after a linked-mode restore", async () => {
    // Startup: the view opens and its persisted state is restored before the
    // workspace has an active file.
    await (view as unknown as { onOpen(): Promise<void> }).onOpen();
    await view.setState(
      { followMode: "linked", linkedIndexedKey: "ABCD2345" },
      {} as never,
    );
    await Promise.resolve();

    // The user then creates a new note (Ctrl+N) and drags an annotation in.
    harness.openNote("Untitled.md");
    await Promise.resolve();
    await Promise.resolve();

    expect(drag()).toBe(RENDERED);
  });

  it("renders the template in note-follow mode", async () => {
    await (view as unknown as { onOpen(): Promise<void> }).onOpen();
    await view.setState({ followMode: "note" }, {} as never);
    await Promise.resolve();

    harness.openNote(LIT_NOTE);
    await Promise.resolve();
    await Promise.resolve();

    expect(drag()).toBe(RENDERED);
  });

  it("renders the template when a note is already open at restore time", async () => {
    harness.openNote("Untitled.md");
    await (view as unknown as { onOpen(): Promise<void> }).onOpen();
    await view.setState(
      { followMode: "linked", linkedIndexedKey: "ABCD2345" },
      {} as never,
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(drag()).toBe(RENDERED);
  });
});
