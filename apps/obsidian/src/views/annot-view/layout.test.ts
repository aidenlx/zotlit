// @vitest-environment happy-dom
// The Annotations Layout is the part a host mounts to show Annotation Cards:
// the host gives it the Attachments to show, a Scope for the card keys and
// the Obsidian app, and the layout keeps each Attachment's own Editing
// Capability and Annotation Source (apps/obsidian ADR 0069).
import { history } from "@codemirror/commands";
import { resetMockPlatform, setMockPlatform } from "@mock/obsidian";
import { Keymap, Scope } from "obsidian";
import type { App, Editor, EventRef, MarkdownFileInfo, TFile } from "obsidian";
import { act } from "preact/test-utils";
import type { DragEvent as ReactDragEvent } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { EditingCapability } from "@/services/annotation-repository/capability";
import type {
  AnnotationList,
  AnnotationRecord,
  AnnotationRepositoryEvents,
} from "@/services/annotation-repository/service";
import { IDLE } from "@/services/annotation-repository/write";
import type { NoteFeature } from "@/services/note-feature";

import { stateEditor } from "./__fixtures__/editor";
import { editorApp } from "./__fixtures__/editor-app";
import { AnnotationsLayout } from "./layout";
import type { AnnotationsLayoutDeps } from "./layout";

vi.mock("zustand", () => import("../__fixtures__/zustand"));

function record(
  key: string,
  parentKey: string,
  text: string,
): AnnotationRecord {
  return {
    key,
    parentKey,
    type: "highlight",
    color: "#ffd400",
    comment: null,
    text,
    pageLabel: "1",
    sortIndex: "00000|000000|00000",
    tags: [],
    version: 1,
    lock: null,
    position: { kind: "pdf-rects", pageIndex: 0, rects: [[0, 0, 10, 10]] },
  };
}

const ALPHA = record("AAAA1111", "PDFAAAAA", "alpha");
const BETA = record("BBBB2222", "PDFBBBBB", "beta");

const LISTS: Record<string, AnnotationList> = {
  PDFAAAAA: {
    source: { kind: "zotero-local-api", serverID: "SERVER00000A" },
    annotations: [ALPHA],
  },
  PDFBBBBB: {
    source: {
      kind: "zotero-db",
      database: { userID: 1, localUserKey: "LOCALKEY", serverID: null },
      libraryID: 1,
      libraryRevision: 7,
    },
    annotations: [BETA],
  },
};

const CAPABILITIES: Record<string, EditingCapability> = {
  PDFAAAAA: { kind: "writable" },
  PDFBBBBB: { kind: "authorization-required" },
};

type Listener = (...args: never[]) => void;

/** A repository that answers two Attachments, each with its own source and capability. */
function repository() {
  const listeners = new Map<string, Set<Listener>>();
  const lists = { ...LISTS };
  const capabilities = { ...CAPABILITIES };
  return {
    lists,
    capabilities,
    emit<E extends keyof AnnotationRepositoryEvents>(
      event: E,
      ...args: Parameters<AnnotationRepositoryEvents[E]>
    ) {
      for (const cb of listeners.get(event) ?? [])
        (cb as (...a: unknown[]) => void)(...args);
    },
    api: {
      read: vi.fn((key: string) => Promise.resolve(lists[key] ?? null)),
      peek: (key: string) => (lists[key] ? { value: lists[key] } : null),
      refresh: vi.fn(() => Promise.resolve()),
      capability: { kind: "writable" } as EditingCapability,
      capabilityFor: (key: string) => capabilities[key]!,
      textDraftFor: () => null,
      tagDraftFor: () => null,
      annotationState: () => ({
        mutation: IDLE,
        textDrafts: {},
        tagDraft: null,
        hidden: false,
        gone: false,
      }),
      on: (event: string, cb: Listener) => {
        const set = listeners.get(event) ?? new Set();
        set.add(cb);
        listeners.set(event, set);
        return () => set.delete(cb);
      },
    },
  };
}

let cleanup: DisposableStack;

beforeEach(() => {
  cleanup = new DisposableStack();
  setMockPlatform({ isMacOS: true });
  cleanup.defer(resetMockPlatform);
  vi.spyOn(Keymap, "isModifier").mockImplementation(
    (event, modifier) => modifier === "Mod" && event.metaKey,
  );
});

afterEach(() => {
  cleanup.dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** Mounts the layout, as a host does, over both Attachments. */
async function mountLayout() {
  const repo = repository();
  const workspaceListeners = new Map<string, Set<Listener>>();
  const app = Object.assign(editorApp(), {
    workspace: {
      trigger: () => {},
      on: (event: string, cb: Listener) => {
        const set = workspaceListeners.get(event) ?? new Set();
        set.add(cb);
        workspaceListeners.set(event, set);
        return cb as unknown as EventRef;
      },
      offref: (ref: EventRef) => {
        for (const set of workspaceListeners.values()) set.delete(ref as never);
      },
    },
  }) as unknown as App;
  const prepare = vi.fn<NoteFeature["prepareAnnotationInsert"]>(() =>
    Promise.resolve(null),
  );
  const deps = {
    app,
    annotations: repo.api,
    reads: {},
    zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
    excerptDisplay: { open: vi.fn(), refresh: vi.fn(), revalidate: vi.fn() },
    noteFeature: { prepareAnnotationInsert: prepare },
    libraryTagNames: () => Promise.resolve([]),
    allowEditing: vi.fn(),
    reportBlockedGesture: vi.fn(),
  } as unknown as AnnotationsLayoutDeps;
  const scope = new Scope();
  const layout = new AnnotationsLayout(deps, {
    scope,
    sourcePath: () => "",
  });
  const el = document.createElement("div");
  document.body.append(el);
  layout.load();
  await act(() => layout.render(el));
  cleanup.defer(() => act(() => layout.unload()));
  await act(async () => {
    await layout.show(["PDFAAAAA", "PDFBBBBB"]);
  });
  const emitWorkspace = (event: string, ...args: unknown[]) => {
    for (const cb of workspaceListeners.get(event) ?? [])
      cb(...(args as never[]));
  };
  return { layout, el, scope, repo, prepare, emitWorkspace };
}

function card(el: HTMLElement, key: string): HTMLElement {
  const found = el.querySelector<HTMLElement>(
    `.zt-annot-card[data-zotero-annotation-key="${key}"]`,
  );
  if (!found) throw new Error(`No card for ${key}`);
  return found;
}

async function click(target: Element): Promise<void> {
  await act(() => {
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}

/** One key, as Obsidian hands it to the handlers the Scope holds. */
async function press(
  scope: Scope,
  target: Element,
  [key, modifiers = []]: [key: string, modifiers?: string[]],
): Promise<boolean> {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: modifiers.includes("Mod"),
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "target", { value: target });
  // The mock Scope records what it was given, which the real type hides.
  const { handlers } = scope as unknown as {
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

it("shows the cards of every Attachment it is given, in that order", async () => {
  const { el } = await mountLayout();
  const keys = [...el.querySelectorAll(".zt-annot-card")].map((node) =>
    node.getAttribute("data-zotero-annotation-key"),
  );
  expect(keys).toEqual([ALPHA.key, BETA.key]);
});

it("gives each card the Editing Capability of its own Attachment", async () => {
  const { el } = await mountLayout();
  const commentField = (key: string) =>
    card(el, key).querySelector(".zt-annot-comment-field");

  await click(card(el, ALPHA.key));
  expect(commentField(ALPHA.key)?.hasAttribute("data-blocked")).toBe(false);

  await click(card(el, BETA.key));
  expect(commentField(BETA.key)?.hasAttribute("data-blocked")).toBe(true);
});

it("selects and copies the cards of every Attachment through the host's Scope", async () => {
  const { el, scope, layout } = await mountLayout();
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  const grid = el.querySelector('[role="grid"]')!;

  expect(await press(scope, grid, ["A", ["Mod"]])).toBe(true);
  expect(layout.store.getState().cardSelection.selected).toEqual([
    ALPHA.key,
    BETA.key,
  ]);

  expect(await press(scope, grid, ["C", ["Mod"]])).toBe(true);
  expect(writeText).toHaveBeenCalledWith("alpha\n\nbeta");

  expect(await press(scope, grid, ["Escape"])).toBe(true);
  expect(layout.store.getState().cardSelection.selected).toEqual([]);
});

it("moves the Card Selection across Attachments with the arrow keys on its Scope", async () => {
  const { el, scope, layout } = await mountLayout();
  const grid = el.querySelector('[role="grid"]')!;

  await press(scope, grid, ["ArrowDown"]);
  expect(layout.store.getState().cardSelection.selected).toEqual([ALPHA.key]);
  await press(scope, card(el, ALPHA.key), ["ArrowDown"]);
  expect(layout.store.getState().cardSelection.selected).toEqual([BETA.key]);
});

it("drags each card with the Annotation Source of its own Attachment", async () => {
  const { layout, prepare, emitWorkspace } = await mountLayout();
  const cm = stateEditor({ doc: "one two", extensions: [history()] });
  cleanup.defer(() => cm.destroy());
  const editor = { cm } as Editor;
  const info = {
    file: { path: "Drop.md" } as TFile,
    editor,
  } as MarkdownFileInfo;
  const source = document.createElement("button");
  Object.defineProperty(source, "win", { value: window });
  document.body.append(source);

  for (const annotation of [ALPHA, BETA]) {
    const dataTransfer = new DataTransfer();
    layout.actions!.onDragStart(
      {
        currentTarget: source,
        dataTransfer,
        preventDefault: vi.fn(),
      } as unknown as ReactDragEvent<HTMLElement>,
      annotation,
    );
    emitWorkspace(
      "editor-drop",
      {
        clientX: 0,
        clientY: 0,
        dataTransfer,
        preventDefault: () => {},
      } as unknown as DragEvent,
      editor,
      info,
    );
  }

  await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
  expect(prepare.mock.calls.map(([options]) => options.source)).toEqual([
    LISTS.PDFAAAAA!.source,
    LISTS.PDFBBBBB!.source,
  ]);
});

it("reads again only the Attachment whose list changed, and keeps the others", async () => {
  const { el, repo } = await mountLayout();
  repo.api.read.mockClear();
  const GAMMA = record("CCCC3333", "PDFBBBBB", "gamma");
  repo.lists.PDFBBBBB = { ...LISTS.PDFBBBBB!, annotations: [BETA, GAMMA] };

  await act(async () => {
    repo.emit("annotations-changed", "PDFBBBBB");
    await Promise.resolve();
  });

  expect(repo.api.read.mock.calls).toEqual([["PDFBBBBB"]]);
  const keys = [...el.querySelectorAll(".zt-annot-card")].map((node) =>
    node.getAttribute("data-zotero-annotation-key"),
  );
  expect(keys).toEqual([ALPHA.key, BETA.key, GAMMA.key]);
});

it("follows a capability change for each Attachment it shows", async () => {
  const { el, repo } = await mountLayout();
  repo.capabilities.PDFBBBBB = { kind: "writable" };
  await act(() => repo.emit("capability-changed"));

  await click(card(el, BETA.key));
  expect(
    card(el, BETA.key)
      .querySelector(".zt-annot-comment-field")
      ?.hasAttribute("data-blocked"),
  ).toBe(false);
});
