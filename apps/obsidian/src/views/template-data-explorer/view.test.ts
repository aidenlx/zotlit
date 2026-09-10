// @vitest-environment happy-dom
import type { ItemView as MockItemView } from "@mock/obsidian";
import type { App, EventRef, WorkspaceLeaf, ViewStateResult } from "obsidian";
import { act } from "preact/test-utils";
import { expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import { pickItem } from "@/services/item-lookup/search-modal";
import { loadTemplateData } from "@/services/template-workbench/data";
import {
  activeTemplateWorkbench,
  subscribeActiveTemplateWorkbench,
} from "@/views/note-preview/register";
import type {
  TemplateAuthoringContext,
  TemplateWorkbenchView,
} from "@/views/template-workbench/view";

import { TemplateDataExplorerView } from "./view";
import type { ExplorerViewDeps } from "./view";

vi.mock("zustand", () => import("@/views/__fixtures__/zustand"));
vi.mock("@/services/template-workbench/data", () => ({
  loadTemplateData: vi.fn(),
}));
vi.mock("@/views/note-preview/register", () => ({
  onCompanionStateRestored: (
    app: App,
    result: import("obsidian").ViewStateResult,
    callback: () => void,
  ) => {
    result.done = () => app.workspace.onLayoutReady(callback);
  },
  subscribeActiveTemplateWorkbench: vi.fn(),
  registerCompanionHistory: vi.fn(() => () => {}),
  activeTemplateWorkbench: vi.fn(),
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
    vault: { on: vi.fn(() => ({})), offref: vi.fn() },
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
  const context: TemplateAuthoringContext = {
    leaf: editorLeaf,
    path: "profiles/paper.md",
    kind: "profile",
    item: { id: "PAPER001", title: "Paper" },
    root: "note",
    tab: "note",
    advanced: false,
    annotationId: null,
    citation: null,
    canInsertField: true,
  };
  const editor = {
    leaf: editorLeaf,
    authoringContext: context,
    getViewData: () => "A note",
    chooseItem: vi.fn(),
  } as unknown as TemplateWorkbenchView;
  let binding: (editor: TemplateWorkbenchView | null) => void = () => {};
  vi.mocked(activeTemplateWorkbench).mockReturnValue(editor);
  const unbind = vi.fn();
  vi.mocked(subscribeActiveTemplateWorkbench).mockImplementation(
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
    vi.mocked(activeTemplateWorkbench).mockReturnValue(null);
    const insertions = trigger.mock.calls.filter(
      ([name]) => name === "zotlit:insert-template-field",
    ).length;
    await act(async () => insert!.click());
    expect(
      trigger.mock.calls.filter(
        ([name]) => name === "zotlit:insert-template-field",
      ),
    ).toHaveLength(insertions);
    vi.mocked(activeTemplateWorkbench).mockReturnValue(editor);
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
    } as unknown as TemplateWorkbenchView;
    view.leaf.pinned = true;
    vi.mocked(activeTemplateWorkbench).mockReturnValue(earlierPeer);
    const heldInsertion = insertion()!;
    await act(async () => binding(earlierPeer));
    expect(view.contentEl.textContent).toContain("Native paper");
    expect(view.getState()).toMatchObject({ itemIndexedKey: "PAPER001" });
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
    expect(view.getState()).toMatchObject({ itemIndexedKey: null });
    expect(view.contentEl.textContent).not.toContain("Native paper");
    expect(view.contentEl.textContent).toContain(m.workbench_search_zotero());
    const launchResult: ViewStateResult = { history: false };
    await act(async () =>
      view.setState(
        { itemIndexedKey: "PAPER002", zotlitLaunch: true },
        launchResult,
      ),
    );
    launchResult.done?.();
    expect(view.getState()).toMatchObject({ itemIndexedKey: "PAPER002" });
    expect(view.getState()).not.toHaveProperty("zotlitLaunch");
    expect(loadTemplateData).toHaveBeenLastCalledWith(
      expect.anything(),
      "PAPER002",
      "note",
    );
    expect(earlierPeer.authoringContext.item).toBeNull();
    expect(pickItem).not.toHaveBeenCalled();
  } finally {
    await act(async () => view.close());
    view.contentEl.remove();
  }
  expect(events.size).toBe(0);
  expect(unbind).toHaveBeenCalledOnce();
  expect(unsubscribeDb).toHaveBeenCalledOnce();
});

it("restores independent Explorer navigation after delayed data and keeps search out of workspace saves", async () => {
  const app = {
    vault: { on: vi.fn(() => ({})), offref: vi.fn() },
    workspace: {
      on: vi.fn(() => ({})),
      offref: vi.fn(),
      getActiveFile: () => null,
      requestSaveLayout: vi.fn(),
    },
    loadLocalStorage: () => null,
  } as unknown as App;
  vi.mocked(activeTemplateWorkbench).mockReturnValue(null);
  vi.mocked(subscribeActiveTemplateWorkbench).mockImplementation(
    (_app, listener) => {
      listener(null);
      return () => {};
    },
  );
  let release!: (value: Awaited<ReturnType<typeof loadTemplateData>>) => void;
  const data = new Promise<Awaited<ReturnType<typeof loadTemplateData>>>(
    (resolve) => {
      release = resolve;
    },
  );
  vi.mocked(loadTemplateData).mockReturnValue(data);
  const view = new ExplorerView(
    { app } as unknown as WorkspaceLeaf,
    {
      app,
      db: { ready: Promise.resolve(), on: () => () => {} },
      templates: { javascriptTemplatesEnabled: true },
    } as unknown as ExplorerViewDeps,
  );
  Object.defineProperty(view, "app", { value: app });
  document.body.append(view.contentEl);
  const typing = document.createElement("input");
  document.body.append(typing);
  typing.focus();
  const descriptor = {
    itemIndexedKey: "PAPER001",
    anchorAnnotationKey: null,
    root: "note",
    collapsedSections: ["record"],
    sourceFile: "profiles/paper.md",
  };
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => {
    view.contentEl.remove();
    typing.remove();
  });
  cleanup.defer(() => act(async () => view.close()));
  await act(async () => view.open());
  await act(async () => view.setState(descriptor, {} as ViewStateResult));
  const saved = view.getEphemeralState() as {
    zotlitDataExplorer: Record<string, unknown>;
  };
  saved.zotlitDataExplorer.navigation = {
    anchorKey: null,
    filterQuery: "answer",
    expanded: ["details"],
    noteRootExpanded: ["authors"],
    preFilterExpanded: ["details"],
    filterCollapsed: [],
  };
  saved.zotlitDataExplorer.presentation = {
    top: 34,
    left: 2,
    field: "details.answer",
  };
  await act(async () => view.setEphemeralState(saved));
  const saves = vi.mocked(app.workspace.requestSaveLayout);
  saves.mockClear();
  await act(async () =>
    release({
      kind: "data",
      data: { title: "A paper", details: { answer: 42 } },
    }),
  );
  const input =
    view.contentEl.querySelector<HTMLInputElement>("input[type=search]")!;
  expect(input.value).toBe("answer");
  expect(view.contentEl.textContent).toContain("42");
  const body = view.contentEl.querySelector<HTMLElement>('[data-part="body"]')!;
  expect(body.scrollTop).toBe(34);
  expect(body.scrollLeft).toBe(2);
  expect(document.activeElement).toBe(typing);
  expect(saves).not.toHaveBeenCalled();
  expect(view.getState()).toEqual(descriptor);
  await act(async () => {
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(
    view.contentEl
      .querySelector('[data-workbench-field="details"]')
      ?.getAttribute("aria-expanded"),
  ).toBe("true");
  expect(view.contentEl.textContent).toContain("42");
  expect(saves).not.toHaveBeenCalled();
  const recreated = new ExplorerView(
    { app } as unknown as WorkspaceLeaf,
    {
      app,
      db: { ready: Promise.resolve(), on: () => () => {} },
      templates: { javascriptTemplatesEnabled: true },
    } as unknown as ExplorerViewDeps,
  );
  Object.defineProperty(recreated, "app", { value: app });
  cleanup.defer(() => act(async () => recreated.close()));
  await act(async () => recreated.open());
  await act(async () =>
    recreated.setState(view.getState(), {} as ViewStateResult),
  );
  expect(recreated.contentEl.textContent).toContain("A paper");
  expect(recreated.getState()).toEqual(descriptor);
  expect(
    recreated.contentEl.querySelector<HTMLInputElement>("input[type=search]")!
      .value,
  ).toBe("");
});

it("applies an explicit Item choice to the requesting pinned Explorer and leaves cancellation and other pins unchanged", async () => {
  const events = new Map<
    EventRef,
    { name: string; callback: (...args: unknown[]) => void }
  >();
  const app = {
    vault: { on: vi.fn(() => ({})), offref: vi.fn() },
    workspace: {
      on(name: string, callback: (...args: unknown[]) => void) {
        const ref = {} as EventRef;
        events.set(ref, { name, callback });
        return ref;
      },
      offref(ref: EventRef) {
        events.delete(ref);
      },
      getActiveFile: () => null,
      requestSaveLayout: vi.fn(),
    },
    loadLocalStorage: () => null,
  } as unknown as App;
  let context: TemplateAuthoringContext = {
    leaf: {} as WorkspaceLeaf,
    path: "profiles/paper.md",
    kind: "profile",
    item: { id: "PAPER001", title: "First paper" },
    root: "note",
    tab: "note",
    advanced: false,
    annotationId: null,
    citation: null,
    canInsertField: true,
  };
  let accepted = true;
  const editor = {
    get authoringContext() {
      return context;
    },
    chooseItem: vi.fn(async () => {
      if (!accepted) return false;
      context = { ...context, item: { id: "PAPER002", title: "Second paper" } };
      for (const event of events.values())
        if (event.name === "zotlit:authoring-context") event.callback(context);
      return true;
    }),
  } as unknown as TemplateWorkbenchView;
  Object.defineProperty(editor, "leaf", { value: context.leaf });
  vi.mocked(activeTemplateWorkbench).mockReturnValue(editor);
  vi.mocked(subscribeActiveTemplateWorkbench).mockImplementation(
    (_app, listener) => {
      listener(editor);
      return () => {};
    },
  );
  vi.mocked(loadTemplateData).mockImplementation(async (_deps, key) => ({
    kind: "data",
    data: { title: key === "PAPER001" ? "First paper" : "Second paper" },
  }));
  await using cleanup = new AsyncDisposableStack();
  const views = [0, 1].map(() => {
    const view = new ExplorerView(
      { app, pinned: true } as unknown as WorkspaceLeaf,
      {
        app,
        db: { ready: Promise.resolve(), on: () => () => {} },
        templates: { javascriptTemplatesEnabled: true },
      } as unknown as ExplorerViewDeps,
    );
    Object.defineProperty(view, "app", { value: app });
    cleanup.defer(() => act(async () => view.close()));
    return view;
  });
  const [requesting, held] = views as [ExplorerView, ExplorerView];
  await act(async () => {
    for (const view of views) {
      await view.open();
      await view.setState({}, { history: false });
    }
  });
  const choose = (requesting as unknown as MockItemView).actions.find(
    (button) => button.getAttribute("aria-label") === m.workbench_choose_item(),
  )!;
  await act(async () => choose.click());
  expect(requesting.getState()).toMatchObject({ itemIndexedKey: "PAPER002" });
  await vi.waitFor(() =>
    expect(requesting.contentEl.textContent).toContain("Second paper"),
  );
  expect(requesting.getState()).toMatchObject({ itemIndexedKey: "PAPER002" });
  expect(held.contentEl.textContent).toContain("First paper");
  expect(held.getState()).toMatchObject({ itemIndexedKey: "PAPER001" });
  accepted = false;
  context = {
    ...context,
    item: { id: "PAPER003", title: "Unrelated paper" },
  };
  await act(async () => choose.click());
  expect(requesting.getState()).toMatchObject({ itemIndexedKey: "PAPER002" });
});

it("keeps pinned Explorer navigation and insertion when its Profile is renamed", async () => {
  const events = new Map<
    EventRef,
    { name: string; callback: (...args: unknown[]) => void }
  >();
  const on = (name: string, callback: (...args: unknown[]) => void) => {
    const ref = {} as EventRef;
    events.set(ref, { name, callback });
    return ref;
  };
  const offref = (ref: EventRef) => {
    events.delete(ref);
  };
  const trigger = vi.fn((name: string, ...args: unknown[]) => {
    for (const event of events.values())
      if (event.name === name) event.callback(...args);
  });
  const app = {
    vault: { on, offref },
    workspace: {
      on,
      offref,
      trigger,
      requestSaveLayout: vi.fn(),
      getActiveFile: () => null,
    },
    loadLocalStorage: () => null,
  } as unknown as App;
  const editorLeaf = { app } as unknown as WorkspaceLeaf;
  const context: TemplateAuthoringContext = {
    leaf: editorLeaf,
    path: "profiles/paper.md",
    kind: "profile",
    item: { id: "PAPER001", title: "Paper" },
    root: "note",
    tab: "note",
    annotationId: null,
    citation: null,
    advanced: false,
    canInsertField: true,
  };
  const editor = {
    leaf: editorLeaf,
    authoringContext: context,
    chooseItem: vi.fn(),
  } as unknown as TemplateWorkbenchView;
  vi.mocked(activeTemplateWorkbench).mockReturnValue(editor);
  vi.mocked(subscribeActiveTemplateWorkbench).mockImplementation(
    (_app, listener) => {
      listener(editor);
      return () => {};
    },
  );
  vi.mocked(loadTemplateData).mockResolvedValue({
    kind: "data",
    data: { title: "Native paper" },
  });
  const view = new ExplorerView(
    { app, pinned: true } as unknown as WorkspaceLeaf,
    {
      app,
      db: { ready: Promise.resolve(), on: () => () => {} },
      templates: { javascriptTemplatesEnabled: true },
    } as unknown as ExplorerViewDeps,
  );
  Object.defineProperty(view, "app", { value: app });
  document.body.append(view.contentEl);
  try {
    await act(async () => view.open());
    const input =
      view.contentEl.querySelector<HTMLInputElement>('input[type="search"]') ??
      view.contentEl.querySelector<HTMLInputElement>("input")!;
    await act(async () => {
      input.value = "Native";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const before = view.getState();
    const ephemeral = view.getEphemeralState();
    const loads = vi.mocked(loadTemplateData).mock.calls.length;
    Object.assign(editor, {
      authoringContext: {
        ...context,
        path: "profiles/renamed.md",
        item: { id: "OTHER001", title: "Other" },
      },
    });
    await act(async () => {
      trigger("zotlit:authoring-context", editor.authoringContext);
      trigger("rename", { path: "profiles/renamed.md" }, "profiles/paper.md");
    });
    expect(view.getState()).toEqual({
      ...before,
      sourceFile: "profiles/renamed.md",
    });
    expect(view.getEphemeralState()).toEqual(ephemeral);
    expect(vi.mocked(loadTemplateData).mock.calls.length).toBe(loads);
    expect(view.contentEl.textContent).toContain("Native paper");
    const insert = [
      ...view.contentEl.querySelectorAll<HTMLElement>('[role="button"]'),
    ].find(
      (button) =>
        button.getAttribute("aria-label") === m.workbench_fields_put_in_note(),
    );
    expect(insert).toBeDefined();
    await act(async () => insert!.click());
    expect(trigger).toHaveBeenCalledWith(
      "zotlit:insert-template-field",
      expect.objectContaining({
        leaf: editorLeaf,
        node: expect.objectContaining({ path: ["title"] }),
      }),
    );
  } finally {
    await act(async () => view.close());
    view.contentEl.remove();
  }
  expect(events.size).toBe(0);
});
