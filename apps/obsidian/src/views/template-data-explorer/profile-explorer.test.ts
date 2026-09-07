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
  createWorkbenchStore,
  WorkbenchEditorProvider,
  WorkbenchHostProvider,
} from "@zotlit/workbench/ui";
import type { WorkbenchInsertTarget } from "@zotlit/workbench/ui";

import { createProfileEditorHost } from "@/views/profile-editor/host";
import type { ProfileEditorView } from "@/views/profile-editor/view";

import { ProfileExplorer } from "./profile-explorer";

vi.mock("zustand", () => import("@/views/__fixtures__/zustand"));
let root: Root | null = null;
afterEach(() => {
  void act(() => root?.unmount());
  root = null;
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

function setup() {
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
      render: () => ({ terminate() {} }),
      matchData: {
        tags: async () => [],
        collections: async () => [],
        libraries: async () => [],
      },
      insertTarget: () => target,
    },
  );
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  void act(() => {
    root!.render(
      createElement(
        WorkbenchHostProvider,
        { host },
        createElement(
          WorkbenchEditorProvider,
          { store, controller },
          createElement(ProfileExplorer, { editor, isEtaEnabled: () => true }),
        ),
      ),
    );
  });
  return { store, state, container, insertField };
}

describe("Profile Explorer binding", () => {
  it("shows new snapshot data while preview remains On demand", () => {
    const { store, state, container } = setup();
    expect(container.textContent).toContain(
      "Why Most Published Research Findings Are False",
    );
    void act(() => {
      store.getState().setItem({ id: "CNPF226A", title: "Second paper" });
      state.setState({ snapshot: SAMPLE_ITEMS[1]! });
    });
    expect(store.getState().preview.live).toBe(false);
    expect(container.textContent).toContain(
      "Designing reproducible research interfaces",
    );
    expect(container.textContent).not.toContain(
      "Why Most Published Research Findings Are False",
    );
  });

  it("follows the Annotation root and sends Eta insertion to the remembered slice", () => {
    const { store, state, container, insertField } = setup();
    void act(() => {
      container
        .querySelector<HTMLElement>('[aria-label="Insert field"]')!
        .click();
    });
    expect(insertField).toHaveBeenCalledWith("<%= zt.title %>");
    void act(() => {
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
    expect(container.textContent).toContain("Chosen annotation text");
  });
});
