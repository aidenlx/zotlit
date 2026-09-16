// @vitest-environment happy-dom
import type { App, EventRef, WorkspaceLeaf } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import type { Item } from "@zotlit/db";

import type {
  AnnotationList,
  AnnotationRecord,
} from "@/services/annotation-repository/service";
import type { ReaderTarget } from "@/services/local-server/service";
import { ReaderSessionHost } from "@/services/reader-session/session";

const PAPER = "PAPER234";
const PDF_ATTACHMENT = "ATCH0001";
const OTHER_ATTACHMENT = "ATCH0002";
const STANDALONE = "LSTAND23";
const NOTE = "Lit Note.md";
const PDF_LEAF = "Reading/paper.pdf";

const item = {
  itemID: 1,
  libraryID: 1,
  key: PAPER,
  groupID: null,
  indexedKey: PAPER,
  creators: [],
  primaryCreatorType: "author",
  fields: { itemType: "book", title: "A Book" },
} as unknown as Item;

const attachments = [
  {
    itemID: 11,
    indexedKey: PDF_ATTACHMENT,
    path: "storage:first.pdf",
    annotCount: 1,
  },
  {
    itemID: 12,
    indexedKey: OTHER_ATTACHMENT,
    path: "storage:second.pdf",
    annotCount: 0,
  },
];

const annot: AnnotationRecord = {
  key: "ANNO2345",
  type: "highlight",
  color: "#ffd400",
  comment: null,
  text: "raw highlighted text",
  parentKey: PDF_ATTACHMENT,
  pageLabel: "1",
  tags: [],
  position: { kind: "pdf-rects", pageIndex: 0, rects: [] },
  version: null,
};

vi.mock("@zotlit/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@zotlit/db")>();
  return {
    ...actual,
    getLibraries: () => [],
    // Only the keys this fixture holds answer; every other key is a key the
    // database does not know, which is what a stale pin looks like.
    getItemsByKey: (_client: unknown, _libraryID: number, keys: string[]) =>
      keys.includes(PAPER) ? [item] : [],
    getItemRefByID: () => ({ ...item }),
    getAttachmentByItemId: (_client: unknown, itemID: number) =>
      itemID === 11
        ? {
            itemID: 11,
            indexedKey: PDF_ATTACHMENT,
            parentItemID: 1,
            path: "storage:first.pdf",
          }
        : null,
    getAttachmentByKey: (_client: unknown, key: string) =>
      key === STANDALONE
        ? { itemID: 21, indexedKey: STANDALONE, path: "storage:loose.pdf" }
        : null,
    getAttachmentAnnotationCount: () => 1,
    getAnnotationsByParent: () => [{ itemID: 42, indexedKey: annot.key }],
    getAnnotViewAttachments: (
      _client: unknown,
      key: string,
    ): typeof attachments => (key === PAPER ? attachments : []),
  };
});

// The React tree is not under test here; the view's own behaviour is.
vi.mock("./AnnotView", () => ({ AnnotView: () => null }));

const { AnnotationView } = await import("./view");

function createDeps() {
  let activeFile: { path: string } | null = null;
  let available = true;
  let readerClosed = false;
  let readerTarget: ReaderTarget | null = null;
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const on = (name: string, cb: (...args: unknown[]) => void) => {
    (listeners.get(name) ?? listeners.set(name, new Set()).get(name)!).add(cb);
    return (() => listeners.get(name)?.delete(cb)) as unknown as EventRef;
  };
  const emit = (name: string, ...args: unknown[]) => {
    for (const cb of listeners.get(name) ?? []) cb(...args);
  };
  const localStorage = new Map<string, unknown>();

  /** The Reader Session an open Obsidian PDF view exposes. */
  const pdfSession = new ReaderSessionHost({
    source: "obsidian-pdf",
    navigate: () => undefined,
    select: (keys) => pdfSession.reportSelection(keys),
  });

  const app = {
    workspace: {
      getActiveFile: () => activeFile,
      on,
      offref: () => undefined,
      requestSaveLayout: vi.fn(() => Promise.resolve()),
    },
    metadataCache: {
      on,
      getFileCache: (file: { path: string }) =>
        file.path === NOTE ? { frontmatter: { "zotero-key": PAPER } } : null,
    },
    loadLocalStorage: (key: string) => localStorage.get(key) ?? null,
    saveLocalStorage: (key: string, data: unknown) => {
      if (data === null) localStorage.delete(key);
      else localStorage.set(key, data);
    },
  } as unknown as App;

  /** The repository, answering one Attachment's Annotations from one source. */
  const source: AnnotationList["source"] = { kind: "zotero-db" };
  const reads: string[] = [];
  const annotations = {
    read: (attachmentKey: string) => {
      reads.push(attachmentKey);
      return Promise.resolve<AnnotationList>({
        source,
        annotations: attachmentKey === PDF_ATTACHMENT ? [annot] : [],
      });
    },
    on,
  };

  const settingsUpdate = vi.fn();
  const deps = {
    app,
    db: {
      state: "ready" as const,
      client: {},
      ready: Promise.resolve(),
      on,
      refresh: () => Promise.resolve(),
    },
    liveUpdate: {
      get available() {
        return available;
      },
      get readerTarget() {
        return readerTarget;
      },
      get readerClosed() {
        return readerClosed;
      },
      on,
    },
    pdfReaders: {
      sessionForPath: (path: string) => (path === PDF_LEAF ? pdfSession : null),
    },
    annotations,
    zoteroPref: { dataDir: "/zotero" },
    noteFeature: {
      renderAnnotation: () => "",
      renderAnnotationCitation: () => null,
    },
    noteIndex: { getNotesByItemKey: () => [] },
    attachmentImport: { prepare: () => Promise.resolve(null) },
    itemLookup: { search: () => [] },
    settings: { update: settingsUpdate },
  };

  return {
    deps: deps as unknown as ConstructorParameters<typeof AnnotationView>[1],
    app,
    pdfSession,
    localStorage,
    settingsUpdate,
    reads,
    openNote(path: string) {
      activeFile = { path };
      emit("active-leaf-change");
    },
    /** The Zotero reader reports an attachment, the way the companion does. */
    pushReaderTarget(target: ReaderTarget) {
      readerTarget = target;
      readerClosed = false;
      emit("reader/target", target);
    },
    /** `reader/inactive` reached the Local Server. */
    closeZoteroReader() {
      readerClosed = true;
      emit("reader/closed", true);
    },
    setLiveUpdates(next: boolean) {
      available = next;
      emit("available", next);
    },
    /** The repository announces that one Attachment's list was superseded. */
    announceChange(attachmentKey: string) {
      emit("annotations-changed", attachmentKey);
    },
  };
}

async function open(harness: ReturnType<typeof createDeps>) {
  const view = new AnnotationView({} as WorkspaceLeaf, harness.deps);
  await (view as unknown as { onOpen(): Promise<void> }).onOpen();
  await view.read;
  return view;
}

describe("the Follow Mode changes only on a gesture", () => {
  it("keeps Zotero Reader when Live updates goes off under it", async () => {
    const harness = createDeps();
    const view = await open(harness);
    view.gestures!.onSetFollowMode("zotero-reader");
    harness.pushReaderTarget({ itemID: 1, attachmentID: 11, selected: [] });
    await view.read;
    expect(view.snapshot.selectedAttachmentKey).toBe(PDF_ATTACHMENT);

    harness.setLiveUpdates(false);
    await view.read;

    expect(view.snapshot.followMode).toBe("zotero-reader");
    expect(view.snapshot.liveUpdatesOn).toBe(false);
    // The source cannot answer at all without Live updates, so the view offers
    // to turn it on rather than showing an attachment no reader is on.
    expect(view.snapshot.attachments).toBeNull();
  });

  it("keeps Zotero Reader on restore while Live updates is off", async () => {
    const harness = createDeps();
    harness.setLiveUpdates(false);
    const view = await open(harness);

    await view.setState({ followMode: "reader" }, { history: false });

    expect(view.snapshot.followMode).toBe("zotero-reader");
  });

  it("keeps Pinned when the pinned Item has gone from the database", async () => {
    const harness = createDeps();
    const view = await open(harness);

    await view.setState(
      { followMode: "linked", linkedIndexedKey: "GN4E2345" },
      { history: false },
    );
    await view.read;

    expect(view.snapshot.followMode).toBe("pinned");
    expect(view.snapshot.pinnedItemKey).toBe("GN4E2345");
    // The pin stands and nothing resolved behind it, which is the state the
    // empty line "the pinned item is not in the database" names.
    expect(view.snapshot.attachments).toStrictEqual([]);
  });

  it("keeps the last Attachment on screen when the Zotero reader closes", async () => {
    const harness = createDeps();
    const view = await open(harness);
    view.gestures!.onSetFollowMode("zotero-reader");
    harness.pushReaderTarget({ itemID: 1, attachmentID: 11, selected: [42] });
    await view.read;
    expect(view.snapshot.selectedAttachmentKey).toBe(PDF_ATTACHMENT);

    harness.closeZoteroReader();

    expect(view.snapshot.zoteroReaderClosed).toBe(true);
    expect(view.snapshot.followMode).toBe("zotero-reader");
    expect(view.snapshot.selectedAttachmentKey).toBe(PDF_ATTACHMENT);
  });
});

describe("what the view follows in each mode", () => {
  it("reads a Literature Note's Item from the active tab", async () => {
    const harness = createDeps();
    const view = await open(harness);
    harness.openNote(NOTE);
    await view.read;

    expect(view.snapshot.itemKey).toBe(PAPER);
    expect(view.snapshot.attachmentLock).toBeNull();
    expect(view.snapshot.annotations).toStrictEqual([annot]);
    expect(view.snapshot.annotationSource).toEqual({ kind: "zotero-db" });
  });

  it("locks the Attachment an open Obsidian PDF holds", async () => {
    const harness = createDeps();
    const view = await open(harness);
    harness.pdfSession.setTarget({
      attachmentKey: PDF_ATTACHMENT,
      itemKey: PAPER,
    });
    harness.openNote(PDF_LEAF);
    await view.read;

    expect(view.snapshot.attachmentLock).toBe("obsidian-pdf");
    expect(view.snapshot.selectedAttachmentKey).toBe(PDF_ATTACHMENT);
    expect(view.snapshot.pinnable).toBe(PAPER);
  });

  it("mirrors the open PDF's selection by Indexed Key", async () => {
    const harness = createDeps();
    const view = await open(harness);
    harness.pdfSession.setTarget({
      attachmentKey: PDF_ATTACHMENT,
      itemKey: PAPER,
    });
    harness.openNote(PDF_LEAF);

    harness.pdfSession.reportSelection([annot.key]);

    expect(view.snapshot.selectedAnnotationKeys).toStrictEqual([annot.key]);
  });

  it("names the Zotero reader's attachment in Indexed Keys", async () => {
    const harness = createDeps();
    const view = await open(harness);
    view.gestures!.onSetFollowMode("zotero-reader");
    harness.pushReaderTarget({ itemID: 1, attachmentID: 11, selected: [42] });
    await view.read;

    expect(view.snapshot.attachmentLock).toBe("zotero-reader");
    expect(view.snapshot.selectedAttachmentKey).toBe(PDF_ATTACHMENT);
    expect(view.snapshot.selectedAnnotationKeys).toStrictEqual([annot.key]);
  });
});

describe("the list comes from the repository", () => {
  it("re-reads when the repository says the list was superseded", async () => {
    const harness = createDeps();
    const view = await open(harness);
    harness.openNote(NOTE);
    await view.read;
    const before = harness.reads.length;

    harness.announceChange(PDF_ATTACHMENT);
    await view.read;

    expect(harness.reads.slice(before)).toStrictEqual([PDF_ATTACHMENT]);
    expect(view.snapshot.annotations).toStrictEqual([annot]);
  });

  it("ignores a change announced for another Attachment", async () => {
    const harness = createDeps();
    const view = await open(harness);
    harness.openNote(NOTE);
    await view.read;
    const before = harness.reads.length;

    harness.announceChange("SOMEELSE");
    await view.read;

    expect(harness.reads.slice(before)).toStrictEqual([]);
  });

  it("remembers the Attachment per Item, in vault-scoped storage", async () => {
    const harness = createDeps();
    const view = await open(harness);
    harness.pdfSession.setTarget({
      attachmentKey: OTHER_ATTACHMENT,
      itemKey: PAPER,
    });
    harness.openNote(PDF_LEAF);
    await view.read;
    // Pinning from the PDF leaf releases its lock and writes the choice.
    view.gestures!.onPinCurrentItem();
    await view.read;

    expect([...harness.localStorage]).toStrictEqual([
      [`zotlit-annot-atch-${PAPER}`, OTHER_ATTACHMENT],
    ]);
  });
});

describe("a standalone Attachment, which has no Item to pin", () => {
  it("lists it and blocks the pin", async () => {
    const harness = createDeps();
    const view = await open(harness);
    harness.pdfSession.setTarget({
      attachmentKey: STANDALONE,
      itemKey: null,
    });
    harness.openNote(PDF_LEAF);
    await view.read;

    expect(view.snapshot.itemKey).toBeNull();
    expect(view.snapshot.selectedAttachmentKey).toBe(STANDALONE);
    expect(view.snapshot.pinnable).toBeNull();
    expect(view.snapshot.attachments).toHaveLength(1);
  });

  it("refuses a pin gesture rather than inventing an Item", async () => {
    const harness = createDeps();
    const view = await open(harness);
    harness.pdfSession.setTarget({
      attachmentKey: STANDALONE,
      itemKey: null,
    });
    harness.openNote(PDF_LEAF);
    await view.read;

    expect(view.snapshot.pinnable).toBeNull();
    view.gestures!.onPinCurrentItem();

    expect(view.snapshot.followMode).toBe("active-tab");
  });
});

describe("pin and unpin", () => {
  it("releases the PDF's lock and starts the picker on that Attachment", async () => {
    const harness = createDeps();
    const view = await open(harness);
    harness.pdfSession.setTarget({
      attachmentKey: OTHER_ATTACHMENT,
      itemKey: PAPER,
    });
    harness.openNote(PDF_LEAF);
    await view.read;
    expect(view.snapshot.attachmentLock).toBe("obsidian-pdf");

    view.gestures!.onPinCurrentItem();
    await view.read;

    expect(view.snapshot.followMode).toBe("pinned");
    expect(view.snapshot.pinnedItemKey).toBe(PAPER);
    expect(view.snapshot.attachmentLock).toBeNull();
    expect(view.snapshot.selectedAttachmentKey).toBe(OTHER_ATTACHMENT);
  });

  it("returns to the mode the pin interrupted", async () => {
    const harness = createDeps();
    const view = await open(harness);
    view.gestures!.onSetFollowMode("zotero-reader");
    harness.pushReaderTarget({ itemID: 1, attachmentID: 11, selected: [] });
    await view.read;
    view.gestures!.onPinCurrentItem();
    expect(view.snapshot.followMode).toBe("pinned");

    view.gestures!.onUnpin();

    expect(view.snapshot.followMode).toBe("zotero-reader");
    expect(view.snapshot.pinnedItemKey).toBeNull();
  });

  it("clears the pin when another mode is chosen outright", async () => {
    const harness = createDeps();
    const view = await open(harness);
    harness.openNote(NOTE);
    await view.read;
    view.gestures!.onPinCurrentItem();

    view.gestures!.onSetFollowMode("zotero-reader");

    expect(view.snapshot.pinnedItemKey).toBeNull();
    expect(view.snapshot.previousMode).toBe("active-tab");
  });

  it("writes the mode and the pin into the view's own state", async () => {
    const harness = createDeps();
    const view = await open(harness);
    harness.openNote(NOTE);
    await view.read;
    view.gestures!.onPinCurrentItem();

    expect(view.getState()).toEqual({
      followMode: "pinned",
      previousMode: "active-tab",
      pinnedItemKey: PAPER,
    });
    expect(harness.app.workspace.requestSaveLayout).toHaveBeenCalled();
  });
});

describe("turning Live updates on from the empty state", () => {
  it("opens the listener and Live Update together", async () => {
    const harness = createDeps();
    const view = await open(harness);

    // The action the Zotero Reader empty state offers.
    view.gestures!.onEnableLiveUpdates();

    expect(harness.settingsUpdate).toHaveBeenCalledWith({
      "server.enabled": true,
      "server.live-update": true,
    });
  });
});
