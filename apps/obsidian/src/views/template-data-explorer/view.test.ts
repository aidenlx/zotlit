// @vitest-environment happy-dom
import type { App, EventRef, WorkspaceLeaf } from "obsidian";
import { act } from "preact/test-utils";
import { expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import { loadTemplateData } from "@/services/template-workbench/data";
import {
  activeProfileEditor,
  subscribeActiveProfileEditor,
} from "@/views/note-preview/register";
import type {
  ProfileAuthoringContext,
  ProfileEditorView,
} from "@/views/profile-editor/view";

import { TemplateDataExplorerView } from "./view";
import type { ExplorerViewDeps } from "./view";

vi.mock("zustand", () => import("@/views/__fixtures__/zustand"));
vi.mock("@/services/template-workbench/data", () => ({
  loadTemplateData: vi.fn(),
}));
vi.mock("@/views/note-preview/register", () => ({
  subscribeActiveProfileEditor: vi.fn(),
  activeProfileEditor: vi.fn(),
}));
vi.mock("@/services/item-lookup/search-modal", () => ({
  pickItem: vi.fn(async () => null),
}));
class ExplorerView extends TemplateDataExplorerView {
  open() {
    return this.onOpen();
  }
  close() {
    return this.onClose();
  }
}
it("binds copied context to its editor, addresses field requests, and releases workspace listeners", async () => {
  const events = new Map<
    EventRef,
    { name: string; callback: (...args: unknown[]) => void }
  >();
  const trigger = vi.fn((name: string, ...args: unknown[]) => {
    for (const event of events.values())
      if (event.name === name) event.callback(...args);
  });
  const app = {
    workspace: {
      on(name: string, callback: (...args: unknown[]) => void) {
        const ref = {} as EventRef;
        events.set(ref, { name, callback });
        return ref;
      },
      offref(ref: EventRef) {
        events.delete(ref);
      },
      trigger,
      getActiveFile: () => null,
      requestSaveLayout: vi.fn(),
    },
    loadLocalStorage: () => null,
  } as unknown as App;
  const editorLeaf = { app } as unknown as WorkspaceLeaf;
  const context: ProfileAuthoringContext = {
    leaf: editorLeaf,
    path: "profiles/paper.md",
    item: { id: "PAPER001", title: "Paper" },
    root: "note",
    tab: "note",
    advanced: false,
    annotationId: null,
    canInsertField: true,
  };
  const editor = {
    leaf: editorLeaf,
    authoringContext: context,
    getViewData: () => "A note",
    chooseItem: vi.fn(),
  } as unknown as ProfileEditorView;
  let binding: (editor: ProfileEditorView | null) => void = () => {};
  vi.mocked(activeProfileEditor).mockReturnValue(editor);
  const unbind = vi.fn();
  vi.mocked(subscribeActiveProfileEditor).mockImplementation(
    (_app, listener) => {
      binding = listener;
      listener(editor);
      return unbind;
    },
  );
  vi.mocked(loadTemplateData).mockResolvedValue({
    kind: "data",
    data: { title: "Native paper" },
  });
  const unsubscribeDb = vi.fn();
  const view = new ExplorerView(
    { app } as unknown as WorkspaceLeaf,
    {
      app,
      db: { ready: Promise.resolve(), on: () => unsubscribeDb },
      templates: { javascriptTemplatesEnabled: true },
    } as unknown as ExplorerViewDeps,
  );
  Object.defineProperty(view, "app", { value: app });
  document.body.append(view.contentEl);
  try {
    await act(async () => view.open());
    expect(view.contentEl.textContent).toContain("Native paper");
    const insertion = () =>
      [...view.contentEl.querySelectorAll<HTMLElement>('[role="button"]')].find(
        (button) =>
          button.getAttribute("aria-label") ===
          m.workbench_fields_put_in_note(),
      );
    const insert = insertion();
    expect(insert).toBeDefined();
    await act(async () => insert!.click());
    expect(trigger).toHaveBeenCalledWith(
      "zotlit:insert-template-field",
      expect.objectContaining({
        leaf: editorLeaf,
        node: expect.objectContaining({ path: ["title"] }),
      }),
    );
    vi.mocked(activeProfileEditor).mockReturnValue(null);
    const insertions = trigger.mock.calls.filter(
      ([name]) => name === "zotlit:insert-template-field",
    ).length;
    await act(async () => insert!.click());
    expect(
      trigger.mock.calls.filter(
        ([name]) => name === "zotlit:insert-template-field",
      ),
    ).toHaveLength(insertions);
    vi.mocked(activeProfileEditor).mockReturnValue(editor);
    const before = vi.mocked(loadTemplateData).mock.calls.length;
    view.leaf.pinned = true;
    await act(async () =>
      trigger("zotlit:authoring-context", {
        ...context,
        item: { id: "OTHER001", title: "Other" },
      }),
    );
    expect(vi.mocked(loadTemplateData).mock.calls.length).toBe(before);
    view.leaf.pinned = false;
    await act(async () =>
      trigger("zotlit:authoring-context", {
        ...context,
        leaf: {},
        item: { id: "OTHER001", title: "Other" },
      }),
    );
    expect(vi.mocked(loadTemplateData).mock.calls.length).toBe(before);
    await act(async () =>
      trigger("zotlit:authoring-context", {
        ...context,
        canInsertField: false,
      }),
    );
    expect(insertion()).toBeUndefined();
    await act(async () => trigger("zotlit:authoring-context", context));
    expect(insertion()).toBeDefined();
    await act(async () => binding(null));
    expect(view.contentEl.textContent).toContain("Native paper");
    expect(insertion()).toBeUndefined();
    await act(async () => binding(editor));
    expect(insertion()).toBeDefined();
    const earlierLeaf = { app } as unknown as WorkspaceLeaf;
    const earlierPeer = {
      leaf: earlierLeaf,
      authoringContext: {
        ...context,
        leaf: earlierLeaf,
        path: "profiles/books.md",
        item: null,
      },
      getViewData: () => "Books output.",
      chooseItem: vi.fn(),
    } as unknown as ProfileEditorView;
    view.leaf.pinned = true;
    vi.mocked(activeProfileEditor).mockReturnValue(earlierPeer);
    const heldInsertion = insertion()!;
    await act(async () => binding(earlierPeer));
    expect(view.contentEl.textContent).toContain("Native paper");
    expect(view.getState()).toEqual({ itemIndexedKey: "PAPER001" });
    expect(insertion()).toBeUndefined();
    const beforeMismatch = trigger.mock.calls.filter(
      ([name]) => name === "zotlit:insert-template-field",
    ).length;
    await act(async () => heldInsertion.click());
    expect(
      trigger.mock.calls.filter(
        ([name]) => name === "zotlit:insert-template-field",
      ),
    ).toHaveLength(beforeMismatch);
    view.leaf.pinned = false;
    await act(async () => binding(earlierPeer));
    expect(view.getState()).toEqual({});
    expect(view.contentEl.textContent).not.toContain("Native paper");
    expect(view.contentEl.textContent).toContain(
      m.template_data_explorer_choose_item(),
    );
  } finally {
    await act(async () => view.close());
    view.contentEl.remove();
  }
  expect(events.size).toBe(0);
  expect(unbind).toHaveBeenCalledOnce();
  expect(unsubscribeDb).toHaveBeenCalledOnce();
});
