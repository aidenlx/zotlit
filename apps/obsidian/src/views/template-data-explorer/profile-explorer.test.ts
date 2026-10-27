// @vitest-environment happy-dom
import type { WorkspaceLeaf } from "obsidian";
import { act } from "preact/test-utils";
import { createElement } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SAMPLE_ANNOTATIONS } from "@zotlit/workbench/render";
import { WorkbenchHostProvider } from "@zotlit/workbench/ui";
import type { WorkbenchHost } from "@zotlit/workbench/ui";

import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import * as workbenchM from "@/lib/i18n/generated/workbench-messages";
import { ViewRegistryProvider } from "@/lib/view-atoms";
import type { TemplateDataLoadResult } from "@/services/template-workbench/data";
import { chooseWorkbenchAnnotation } from "@/views/template-workbench/selection";
import type { TemplateAuthoringContext } from "@/views/template-workbench/view";

import { makeExplorerHost, waitFor } from "./__fixtures__";
import type { ExplorerHost, ExplorerReads } from "./__fixtures__";
import { ExplorerActionsContext } from "./actions";
import type { ExplorerActions } from "./actions";
import { Explorer } from "./Explorer";
import {
  annotationIndexedKey,
  ExplorerModelContext,
  setCollapsedSections,
  setFilter,
  toggleNode,
} from "./model";
import type { ExplorerModel } from "./model";

vi.mock("zustand", () => import("@/views/__fixtures__/zustand"));
const read = vi.fn<NonNullable<ExplorerReads["read"]>>();
let host: ExplorerHost;
beforeEach(async () => {
  vi.resetAllMocks();
  host = await makeExplorerHost({ read });
});
afterEach(() => host.close());
const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
  updateHeader: vi.fn(),
});
/** Gives `child` the host's registry and one Explorer model. */
function withModel(model: ExplorerModel, child: ReactNode) {
  return createElement(
    ViewRegistryProvider,
    { registry: host.registry },
    createElement(ExplorerModelContext, { value: model }, child),
  );
}
function context(
  patch: Partial<TemplateAuthoringContext> = {},
): TemplateAuthoringContext {
  return {
    leaf,
    path: "profiles/paper.md",
    kind: "profile",
    item: { id: "PAPER234", title: "Paper" },
    root: "note",
    tab: "note",
    advanced: false,
    annotationId: null,
    citation: null,
    partial: null,
    ...patch,
  };
}
describe("independent native Explorer", () => {
  it("keeps filter, collapse, and closed sections local across editor display changes", async () => {
    read.mockResolvedValue({
      kind: "data",
      data: { title: "Paper", tags: ["methods"] },
    });
    using first = host.openSession();
    using second = host.openSession();
    first.setContext(context());
    second.setContext(context());
    await Promise.all([first.ready(), second.ready()]);
    first.apply(toggleNode("tags"));
    first.apply(setFilter("methods"));
    first.apply(toggleNode("tags"));
    first.apply(setCollapsedSections(new Set(["record"])));
    first.setContext(
      context({
        advanced: true,
        tab: "properties",
        annotationId: SAMPLE_ANNOTATIONS[0]!.id,
      }),
    );
    expect(first.state().navigation.filterCollapsed.has("tags")).toBe(true);
    expect(first.state().navigation.filterQuery).toBe("methods");
    expect(second.state().navigation.filterQuery).toBe("");
    expect(first.state().collapsedSections.has("record")).toBe(true);
    expect(second.state().collapsedSections.size).toBe(0);
    first.apply(setFilter(""));
    expect(first.state().navigation.expanded.has("tags")).toBe(true);
  });
  it("restores note expansion after annotation exploration and resets for a new Item", async () => {
    read.mockResolvedValue({
      kind: "data",
      data: { text: "Evidence" },
    });
    using session = host.openSession();
    session.setContext(context());
    await session.ready();
    session.apply(toggleNode("annotations"));
    const item = session.state().item;
    session.setTarget(item, "annotation", "ANNT2345");
    await session.ready();
    expect(session.state().navigation.expanded.size).toBe(0);
    session.setContext(context({ advanced: true }));
    expect(session.state().root).toBe("annotation");
    session.setTarget(item, "note");
    await session.ready();
    expect(session.state().navigation.expanded.has("annotations")).toBe(true);
    session.setContext(context({ item: { id: "PAPER235", title: "Other" } }));
    await session.ready();
    expect(session.state().navigation.expanded.size).toBe(0);
  });
  it("rejects late results after a new Item and after disposal", async () => {
    let resolveOld!: (result: TemplateDataLoadResult) => void;
    read.mockImplementation(async (key) =>
      key === "PAPER234"
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : { kind: "data", data: { title: "Current" } },
    );
    const session = host.openSession();
    session.setContext(context());
    await waitFor(() => expect(read).toHaveBeenCalledOnce());
    session.setContext(context({ item: { id: "PAPER235", title: "Other" } }));
    await session.ready();
    resolveOld({ kind: "data", data: { title: "Obsolete" } });
    await session.ready();
    expect(session.state().data?.title).toBe("Current");
    session.setContext(context());
    await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    // The new Item interrupted the first read; the close interrupts the last.
    expect(host.cancelled).toEqual(["PAPER234"]);
    session[Symbol.dispose]();
    await waitFor(() =>
      expect(host.cancelled).toEqual(["PAPER234", "PAPER234"]),
    );
  });
  it("distinguishes no Item, load failure, valid empty data, and a retry", async () => {
    using session = host.openSession();
    expect(session.state().status).toBe("no-item");
    read.mockRejectedValueOnce(new Error("Disconnected"));
    session.setContext(context());
    expect(session.state().status).toBe("loading");
    await session.ready();
    expect(session.state().status).toBe("error");
    expect(session.state().error).toBe("Disconnected");
    read.mockResolvedValueOnce({
      kind: "data",
      data: {},
    });
    session.refresh();
    await session.ready();
    expect(session.state().status).toBe("empty");
    expect(session.state().data).toEqual({});
  });
  it("restores an annotation anchor within its Item's group Library", async () => {
    read.mockResolvedValue({
      kind: "data",
      data: { text: "Group annotation" },
    });
    using session = host.openSession();
    session.setTarget(
      { id: "PAPER234g42", title: "Group paper" },
      "annotation",
      "ANNT2345",
    );
    await session.ready();
    expect(read).toHaveBeenLastCalledWith("ANNT2345g42", "annotation");
    expect(session.state().status).toBe("ready");
  });
  it("offers explicit Item selection without launching a picker on mount", async () => {
    using session = host.openSession();
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
            host: stubService<WorkbenchHost>("WorkbenchHost", {
              messages: workbenchM,
              getLocale: () => "en",
              persistence: { read: () => null, write: () => {} },
            }),
          },
          withModel(
            session.model,
            createElement(
              ExplorerActionsContext,
              {
                value: stubService<ExplorerActions>("ExplorerActions", {
                  onChooseItem: choose,
                }),
              },
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
  read.mockImplementation(async (key, root) => ({
    kind: "data",
    data:
      root === "note"
        ? { title: "Group paper", annotations: [first, second] }
        : key === "ANNT2346g42"
          ? second
          : first,
  }));
  using session = host.openSession();
  using other = host.openSession();
  const authoring = context({
    item: { id: "PAPER234g42", title: "Group paper" },
    root: "annotation",
    tab: "annotation",
    annotationId: "ANNT2345",
  });
  session.setContext(authoring);
  other.setContext(authoring);
  await Promise.all([session.ready(), other.ready()]);
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
          host: stubService<WorkbenchHost>("WorkbenchHost", {
            messages: m,
            getLocale: () => "en",
            tooltip: (text: string) => ({ title: text }),
            persistence: { read: () => null, write: () => {} },
            suggester,
          }),
        },
        withModel(
          session.model,
          createElement(Explorer, {
            explorer: { copy: async () => {} },
            lookup: { search: async () => [] },
            onSelectItem: (item) => session.setTarget(item, "note"),
            onSearchItem: () => {},
            onChooseAnnotation: async () => {
              const state = session.state();
              const id = await chooseWorkbenchAnnotation(
                stubService<WorkbenchHost>("WorkbenchHost", { suggester }),
                state.annotations ?? [],
                annotationIndexedKey(state.item!.id, state.annotationId) ??
                  state.annotationId,
              );
              if (id) session.setTarget(state.item, "annotation", id);
            },
            onSelectAnnotation: (id) =>
              session.setTarget(session.state().item, "annotation", id),
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
  await act(async () => session.ready());
  expect(suggester.mock.calls[0]?.[0]).toMatchObject({
    selected: "ANNT2345g42",
    groups: [{ options: [{ id: "ANNT2345g42" }, { id: "ANNT2346g42" }] }, {}],
  });
  expect(session.state().data?.comment).toBe("Check the method");
  expect(session.state().annotationId).toBe("ANNT2346g42");
  expect(session.state().context).toBe(authoring);
  expect(other.state().annotationId).toBe("ANNT2345");
  suggester.mockResolvedValueOnce(SAMPLE_ANNOTATIONS[1]!.id);
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>(
        `[aria-label="${m.workbench_choose_annotation()}"]`,
      )!
      .click();
  });
  await act(async () => session.ready());
  expect(session.state().data?.text).toBe(SAMPLE_ANNOTATIONS[1]!.root.text);
  session.setContext({ ...authoring, advanced: true });
  expect(session.state().annotationId).toBe(SAMPLE_ANNOTATIONS[1]!.id);
  await act(async () => session.setTarget(authoring.item, "note"));
  await act(async () => session.ready());
  expect(
    container.querySelector(
      `[aria-label="${m.workbench_choose_annotation()}"]`,
    ),
  ).toBeNull();
});

it("discards annotation choices loaded for a superseded Item", async () => {
  let finish!: (value: TemplateDataLoadResult) => void;
  read.mockImplementation(async (key) =>
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
  using session = host.openSession();
  session.setContext(
    context({ root: "annotation", annotationId: SAMPLE_ANNOTATIONS[0]!.id }),
  );
  await waitFor(() => expect(read).toHaveBeenCalledOnce());
  session.setContext(
    context({
      item: { id: "PAPER235", title: "Next paper" },
      root: "annotation",
      annotationId: SAMPLE_ANNOTATIONS[0]!.id,
    }),
  );
  await session.ready();
  finish({ kind: "data", data: { annotations: [{ key: "OLD23456" }] } });
  await session.ready();
  expect(session.state().annotations?.map(({ id }) => id)).toEqual([
    "NEXT2345",
  ]);
});
