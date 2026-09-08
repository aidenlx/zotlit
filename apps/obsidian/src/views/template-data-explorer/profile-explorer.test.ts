// @vitest-environment happy-dom
import type { App } from "obsidian";
import { act } from "preact/test-utils";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";

import { WorkbenchDocumentController } from "@zotlit/workbench/document";
import { SAMPLE_ITEMS, SAMPLE_ANNOTATIONS } from "@zotlit/workbench/render";
import {
  createRenderScheduler,
  createWorkbenchStore,
  WorkbenchEditorProvider,
  WorkbenchHostProvider,
} from "@zotlit/workbench/ui";
import type {
  RenderScheduler,
  WorkbenchInsertTarget,
} from "@zotlit/workbench/ui";

import { loadTemplateData } from "@/services/template-workbench/data";
import type {
  TemplateDataDeps,
  TemplateDataLoadResult,
} from "@/services/template-workbench/data";
import { createProfileEditorHost } from "@/views/profile-editor/host";
import type { ProfileEditorView } from "@/views/profile-editor/view";

import { ProfileExplorer } from "./profile-explorer";

vi.mock("@/services/template-workbench/data", () => ({
  loadTemplateData: vi.fn(),
}));
vi.mock("zustand", () => import("@/views/__fixtures__/zustand"));
let root: Root | null = null;
let scheduler: RenderScheduler | null = null;
afterEach(() => {
  void act(() => root?.unmount());
  root = null;
  scheduler?.[Symbol.dispose]();
  scheduler = null;
  document.body.replaceChildren();
});

const SOURCE = `---
id: paper
name: Paper
version: 1.0.0
contract: 2
language: eta
filename: paper
---
A stable note.
--- zotlit:annotation ---
An annotation.
`;

async function setup() {
  vi.mocked(loadTemplateData).mockImplementation(
    async (_deps, indexedKey, root) => ({
      kind: "data",
      data:
        root === "annotation"
          ? { text: "Live annotation", filePath: "/Users/research/Paper.pdf" }
          : {
              title:
                indexedKey === "IANNP5A2"
                  ? "Why Most Published Research Findings Are False"
                  : "Designing reproducible research interfaces",
              noteLink: () => "[[Library/Paper|Paper]]",
            },
    }),
  );
  const store = createWorkbenchStore({
    item: { id: "IANNP5A2", title: "Paper" },
    preview: { mode: "create", live: false },
  });
  const controller = new WorkbenchDocumentController(SOURCE, {
    runtime: "native",
  });
  const state = createStore(() => ({
    snapshot: SAMPLE_ITEMS[0]!,
    current: [],
    example: SAMPLE_ANNOTATIONS[0]!,
  }));
  const insertField = vi
    .fn<(snippet: string) => boolean>()
    .mockReturnValue(true);
  const range = controller.sliceRange("note");
  const target: WorkbenchInsertTarget = {
    slice: "note",
    range: { from: range.from, to: range.from },
  };
  const editor = {
    store,
    controller,
    preview: { state },
    insertTarget: target,
    subscribeInsertion: () => () => {},
    chooseItem: async () => {},
    insertField,
  } as unknown as ProfileEditorView;
  const host = createProfileEditorHost(
    {
      loadLocalStorage: () => null,
      saveLocalStorage: () => {},
    } as unknown as App,
    {
      render: () => Promise.reject(new Error("This test renders nothing.")),
      matchData: {
        tags: async () => [],
        collections: async () => [],
        libraries: async () => [],
      },
      insertTarget: () => target,
    },
  );
  const editorScheduler = createRenderScheduler({
    render: (request) => host.render(request),
    failed: (result) => result,
    controller,
    store,
  });
  scheduler = editorScheduler;
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(
        WorkbenchHostProvider,
        { host },
        createElement(
          WorkbenchEditorProvider,
          { store, controller, scheduler: editorScheduler },
          createElement(ProfileExplorer, {
            editor,
            deps: {} as TemplateDataDeps,
            isEtaEnabled: () => true,
          }),
        ),
      ),
    );
  });
  return { store, state, container, insertField };
}

describe("Profile Explorer binding", () => {
  it("shows new snapshot data while preview remains On demand", async () => {
    const { store, state, container } = await setup();
    expect(container.textContent).toContain(
      "Why Most Published Research Findings Are False",
    );
    await act(async () => {
      store.getState().setItem({ id: "CNPF226A", title: "Second paper" });
      state.setState({ snapshot: SAMPLE_ITEMS[1]! });
    });
    expect(store.getState().preview.live).toBe(false);
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "Designing reproducible research interfaces",
      ),
    );
    expect(container.textContent).not.toContain(
      "Why Most Published Research Findings Are False",
    );
  });

  it("follows the Annotation root and sends Eta insertion to the remembered slice", async () => {
    const { store, state, container, insertField } = await setup();
    await act(async () => {
      container
        .querySelector<HTMLElement>('[aria-label="Insert field"]')!
        .click();
    });
    expect(insertField).toHaveBeenCalledWith("<%= zt.title %>");
    await act(async () => {
      state.setState({
        example: {
          ...SAMPLE_ANNOTATIONS[0]!,
          root: {
            ...SAMPLE_ANNOTATIONS[0]!.root,
            text: "Chosen annotation text",
          },
        },
      });
      store.getState().setRoot("annotation");
    });
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Chosen annotation text"),
    );
  });
  it("keeps vault links and attachment paths from the native inert loader", async () => {
    const { store, state, container } = await setup();
    expect(container.textContent).toContain("[[Library/Paper|Paper]]");
    await act(async () => {
      state.setState({
        example: {
          ...SAMPLE_ANNOTATIONS[0]!,
          id: "live-annotation",
          root: { ...SAMPLE_ANNOTATIONS[0]!.root, indexedKey: "ANNO0001" },
        },
      });
      store.getState().setRoot("annotation");
    });
    expect(loadTemplateData).toHaveBeenLastCalledWith(
      expect.anything(),
      "ANNO0001",
      "annotation",
    );
    await vi.waitFor(() =>
      expect(container.textContent).toContain("/Users/research/Paper.pdf"),
    );
    expect(container.textContent).toContain("Live annotation");
  });
  it("discards native context returned after the paper changes", async () => {
    const { store, state, container } = await setup();
    const old = Promise.withResolvers<TemplateDataLoadResult>();
    vi.mocked(loadTemplateData)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({
        kind: "data",
        data: { title: "Newest local context" },
      });
    await act(async () => {
      store.getState().setItem({ id: "CNPF226A", title: "Second paper" });
      state.setState({ snapshot: SAMPLE_ITEMS[1]! });
    });
    await act(async () => {
      store.getState().setItem({ id: "IANNP5A2", title: "First paper" });
      state.setState({ snapshot: SAMPLE_ITEMS[0]! });
    });
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Newest local context"),
    );
    await act(async () => {
      old.resolve({ kind: "data", data: { title: "Outdated local context" } });
    });
    expect(container.textContent).toContain("Newest local context");
    expect(container.textContent).not.toContain("Outdated local context");
  });
});
