// @vitest-environment happy-dom
import type { WorkspaceLeaf } from "obsidian";
import { act } from "preact/test-utils";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { SAMPLE_ANNOTATIONS } from "@zotlit/workbench/render";
import { WorkbenchHostProvider } from "@zotlit/workbench/ui";

import * as m from "@/lib/i18n/generated/messages";
import { loadTemplateData } from "@/services/template-workbench/data";
import type {
  TemplateDataDeps,
  TemplateDataLoadResult,
} from "@/services/template-workbench/data";
import { chooseWorkbenchAnnotation } from "@/views/profile-editor/selection";
import type { ProfileAuthoringContext } from "@/views/profile-editor/view";

import { ExplorerActionsContext } from "./actions";
import { Explorer } from "./Explorer";
import {
  annotationIndexedKey,
  ExplorerStoreProvider,
  NativeExplorerSession,
} from "./store";

vi.mock("@/services/template-workbench/data", () => ({
  loadTemplateData: vi.fn(),
}));
vi.mock("zustand", () => import("@/views/__fixtures__/zustand"));
const deps = {} as TemplateDataDeps;
const leaf = {} as WorkspaceLeaf;
function context(
  patch: Partial<ProfileAuthoringContext> = {},
): ProfileAuthoringContext {
  return {
    leaf,
    path: "profiles/paper.md",
    item: { id: "PAPER234", title: "Paper" },
    root: "note",
    tab: "note",
    advanced: false,
    annotationId: null,
    ...patch,
  };
}
describe("independent native Explorer", () => {
  it("keeps filter, collapse, and closed sections local across editor display changes", async () => {
    vi.mocked(loadTemplateData).mockResolvedValue({
      kind: "data",
      data: { title: "Paper", tags: ["methods"] },
    });
    using first = new NativeExplorerSession(deps);
    using second = new NativeExplorerSession(deps);
    first.setContext(context());
    second.setContext(context());
    await Promise.all([first.ready, second.ready]);
    first.state.getState().toggleNode("tags");
    first.state.getState().setFilter("methods");
    first.state.getState().toggleNode("tags");
    first.state.getState().setCollapsedSections(new Set(["record"]));
    first.setContext(
      context({
        advanced: true,
        tab: "properties",
        annotationId: SAMPLE_ANNOTATIONS[0]!.id,
      }),
    );
    expect(first.state.getState().navigation.filterCollapsed.has("tags")).toBe(
      true,
    );
    expect(first.state.getState().navigation.filterQuery).toBe("methods");
    expect(second.state.getState().navigation.filterQuery).toBe("");
    expect(first.state.getState().collapsedSections.has("record")).toBe(true);
    expect(second.state.getState().collapsedSections.size).toBe(0);
    first.state.getState().setFilter("");
    expect(first.state.getState().navigation.expanded.has("tags")).toBe(true);
  });
  it("restores note expansion after annotation exploration and resets for a new Item", async () => {
    vi.mocked(loadTemplateData).mockResolvedValue({
      kind: "data",
      data: { text: "Evidence" },
    });
    using session = new NativeExplorerSession(deps);
    session.setContext(context());
    await session.ready;
    session.state.getState().toggleNode("annotations");
    const item = session.state.getState().item;
    session.setTarget(item, "annotation", "ANNT2345");
    await session.ready;
    expect(session.state.getState().navigation.expanded.size).toBe(0);
    session.setContext(context({ advanced: true }));
    expect(session.state.getState().root).toBe("annotation");
    session.setTarget(item, "note");
    await session.ready;
    expect(
      session.state.getState().navigation.expanded.has("annotations"),
    ).toBe(true);
    session.setContext(context({ item: { id: "PAPER235", title: "Other" } }));
    await session.ready;
    expect(session.state.getState().navigation.expanded.size).toBe(0);
  });
  it("rejects late results after a new Item and after disposal", async () => {
    let resolveOld!: (result: TemplateDataLoadResult) => void;
    vi.mocked(loadTemplateData).mockImplementation(async (_deps, key) =>
      key === "PAPER234"
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : { kind: "data", data: { title: "Current" } },
    );
    const session = new NativeExplorerSession(deps);
    session.setContext(context());
    const old = session.ready;
    session.setContext(context({ item: { id: "PAPER235", title: "Other" } }));
    await session.ready;
    resolveOld({ kind: "data", data: { title: "Obsolete" } });
    await old;
    expect(session.state.getState().data?.title).toBe("Current");
    session.setContext(context());
    const pending = session.ready;
    session[Symbol.dispose]();
    resolveOld({ kind: "data", data: { title: "Closed" } });
    await pending;
    expect(session.state.getState().data).toBeNull();
    expect(session.state.getState().context).toBeNull();
  });
  it("distinguishes no Item, load failure, valid empty data, and a retry", async () => {
    using session = new NativeExplorerSession(deps);
    expect(session.state.getState().status).toBe("no-item");
    vi.mocked(loadTemplateData).mockRejectedValueOnce(
      new Error("Disconnected"),
    );
    session.setContext(context());
    expect(session.state.getState().status).toBe("loading");
    await session.ready;
    expect(session.state.getState().status).toBe("error");
    expect(session.state.getState().error).toBe("Disconnected");
    vi.mocked(loadTemplateData).mockResolvedValueOnce({
      kind: "data",
      data: {},
    });
    session.refresh();
    await session.ready;
    expect(session.state.getState().status).toBe("empty");
    expect(session.state.getState().data).toEqual({});
  });
  it("restores an annotation anchor within its Item's group Library", async () => {
    vi.mocked(loadTemplateData).mockResolvedValue({
      kind: "data",
      data: { text: "Group annotation" },
    });
    using session = new NativeExplorerSession(deps);
    session.setTarget(
      { id: "PAPER234g42", title: "Group paper" },
      "annotation",
      "ANNT2345",
    );
    await session.ready;
    expect(loadTemplateData).toHaveBeenLastCalledWith(
      deps,
      "ANNT2345g42",
      "annotation",
    );
    expect(session.state.getState().status).toBe("ready");
  });
  it("loads sample annotations with their own inert parent data", async () => {
    vi.mocked(loadTemplateData).mockResolvedValue({
      kind: "data",
      data: { title: "Native paper", noteLink: () => "[[Paper]]" },
    });
    using session = new NativeExplorerSession(deps);
    session.setContext(
      context({ root: "annotation", annotationId: SAMPLE_ANNOTATIONS[0]!.id }),
    );
    await session.ready;
    expect(loadTemplateData).toHaveBeenLastCalledWith(deps, "PAPER234", "note");
    expect(session.state.getState().data?.text).toBe(
      SAMPLE_ANNOTATIONS[0]!.root.text,
    );
    const parent = session.state.getState().data?.parentItem as {
      title: string;
      noteLink: () => string | null;
    };
    expect(parent.title).toBe("Designing reproducible research interfaces");
    expect(parent.noteLink()).toBeNull();
  });
  it("offers explicit Item selection without launching a picker on mount", async () => {
    using session = new NativeExplorerSession(deps);
    const choose = vi.fn();
    using cleanup = new DisposableStack();
    const container = cleanup.adopt(document.createElement("div"), (element) =>
      element.remove(),
    );
    document.body.append(container);
    const root = cleanup.adopt(createRoot(container), (root) => {
      void act(() => root.unmount());
    });
    await act(async () =>
      root.render(
        createElement(
          WorkbenchHostProvider,
          {
            host: {
              getLocale: () => "en",
              persistence: { read: () => null, write: () => {} },
            } as never,
          },
          createElement(
            ExplorerStoreProvider,
            { value: session.state },
            createElement(
              ExplorerActionsContext,
              { value: { onChooseItem: choose } as never },
              createElement(Explorer, {
                explorer: { copy: async () => {} },
                lookup: { search: async () => [] },
                onSearchItem: choose,
                onSelectItem: (item) => session.setTarget(item, "note"),
                onSelectAnnotation: (id) =>
                  session.setTarget(null, "annotation", id),
                onChooseAnnotation: choose,
              }),
            ),
          ),
        ),
      ),
    );
    expect(container.textContent).toContain(m.workbench_search_zotero());
    expect(container.textContent).not.toContain(
      m.workbench_fields_no_annotations(),
    );
    expect(choose).not.toHaveBeenCalled();
    await act(async () =>
      (container.querySelector("button") as HTMLButtonElement).click(),
    );
    expect(choose).toHaveBeenCalledOnce();
  });
});

it("switches annotation data locally through the annotation chooser", async () => {
  const first = {
    key: "ANNT2345",
    type: "highlight",
    text: "First evidence",
    tags: [],
  };
  const second = {
    key: "ANNT2346",
    type: "note",
    comment: "Check the method",
    tags: [],
  };
  vi.mocked(loadTemplateData).mockImplementation(async (_deps, key, root) => ({
    kind: "data",
    data:
      root === "note"
        ? { title: "Group paper", annotations: [first, second] }
        : key === "ANNT2346g42"
          ? second
          : first,
  }));
  using session = new NativeExplorerSession(deps);
  using other = new NativeExplorerSession(deps);
  const authoring = context({
    item: { id: "PAPER234g42", title: "Group paper" },
    root: "annotation",
    tab: "annotation",
    annotationId: "ANNT2345",
  });
  session.setContext(authoring);
  other.setContext(authoring);
  await Promise.all([session.ready, other.ready]);
  const suggester = vi.fn(async (_request: unknown) => "ANNT2346g42");
  await using cleanup = new AsyncDisposableStack();
  const container = cleanup.adopt(document.createElement("div"), (element) =>
    element.remove(),
  );
  document.body.append(container);
  const root = cleanup.adopt(createRoot(container), (root) =>
    act(() => root.unmount()),
  );
  await act(async () =>
    root.render(
      createElement(
        WorkbenchHostProvider,
        {
          host: {
            messages: m,
            getLocale: () => "en",
            tooltip: (text: string) => ({ title: text }),
            persistence: { read: () => null, write: () => {} },
            suggester,
          } as never,
        },
        createElement(
          ExplorerStoreProvider,
          { value: session.state },
          createElement(Explorer, {
            explorer: { copy: async () => {} },
            lookup: { search: async () => [] },
            onSelectItem: (item) => session.setTarget(item, "note"),
            onSearchItem: () => {},
            onChooseAnnotation: async () => {
              const state = session.state.getState();
              const id = await chooseWorkbenchAnnotation(
                { suggester } as never,
                state.annotations ?? [],
                annotationIndexedKey(state.item!.id, state.annotationId) ??
                  state.annotationId,
              );
              if (id) session.setTarget(state.item, "annotation", id);
            },
            onSelectAnnotation: (id) =>
              session.setTarget(
                session.state.getState().item,
                "annotation",
                id,
              ),
          }),
        ),
      ),
    ),
  );
  const choose = container.querySelector<HTMLButtonElement>(
    `[aria-label="${m.workbench_choose_annotation()}"]`,
  )!;
  expect(choose).not.toBeNull();
  await act(async () => {
    choose.click();
  });
  await act(async () => session.ready);
  expect(suggester.mock.calls[0]?.[0]).toMatchObject({
    selected: "ANNT2345g42",
    groups: [{ options: [{ id: "ANNT2345g42" }, { id: "ANNT2346g42" }] }, {}],
  });
  expect(session.state.getState().data?.comment).toBe("Check the method");
  expect(session.state.getState().annotationId).toBe("ANNT2346g42");
  expect(session.state.getState().context).toBe(authoring);
  expect(other.state.getState().annotationId).toBe("ANNT2345");
  suggester.mockResolvedValueOnce(SAMPLE_ANNOTATIONS[1]!.id);
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>(
        `[aria-label="${m.workbench_choose_annotation()}"]`,
      )!
      .click();
  });
  await act(async () => session.ready);
  expect(session.state.getState().data?.text).toBe(
    SAMPLE_ANNOTATIONS[1]!.root.text,
  );
  session.setContext({ ...authoring, advanced: true });
  expect(session.state.getState().annotationId).toBe(SAMPLE_ANNOTATIONS[1]!.id);
  await act(async () => session.setTarget(authoring.item, "note"));
  await act(async () => session.ready);
  expect(
    container.querySelector(
      `[aria-label="${m.workbench_choose_annotation()}"]`,
    ),
  ).toBeNull();
});

it("discards annotation choices loaded for a superseded Item", async () => {
  let finish!: (value: TemplateDataLoadResult) => void;
  vi.mocked(loadTemplateData).mockImplementation(async (_deps, key) =>
    key === "PAPER234"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : {
          kind: "data",
          data: {
            annotations: [{ key: "NEXT2345", text: "Current evidence" }],
          },
        },
  );
  using session = new NativeExplorerSession(deps);
  session.setContext(
    context({ root: "annotation", annotationId: SAMPLE_ANNOTATIONS[0]!.id }),
  );
  const pending = session.ready;
  session.setContext(
    context({
      item: { id: "PAPER235", title: "Next paper" },
      root: "annotation",
      annotationId: SAMPLE_ANNOTATIONS[0]!.id,
    }),
  );
  await session.ready;
  finish({ kind: "data", data: { annotations: [{ key: "OLD23456" }] } });
  await pending;
  expect(session.state.getState().annotations?.map(({ id }) => id)).toEqual([
    "NEXT2345",
  ]);
});
