// @vitest-environment happy-dom
import { SuggestModal } from "obsidian";
import type { App, ItemView, WorkspaceLeaf } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { makeItem } from "@zotlit/item-lookup/fixtures";
import type { WorkbenchSuggesterOption } from "@zotlit/workbench/ui";

import { createTemplateWorkbenchHost } from "./host";
import {
  publishWorkbenchSelection,
  subscribeWorkbenchSelection,
  chooseWorkbenchItem,
} from "./selection";
import type { WorkbenchSelectionEvent } from "./selection";

it("searches Zotero from the first item chooser and selects a matching paper", async () => {
  const item = makeItem({
    key: "ROUGIER1",
    title: "Ten Simple Rules for Better Figures",
  });
  const search = vi.fn(async (query: string) =>
    query ? [{ item, matches: [], library: null }] : [],
  );
  const app = {} as App;
  const deps = {
    app,
    lookup: {
      search,
      openSession: () => ({ search, close() {}, [Symbol.dispose]() {} }),
    },
    settings: { current: {} },
  } as unknown as Parameters<typeof chooseWorkbenchItem>[1];
  using open = vi.spyOn(SuggestModal.prototype, "open");
  using host = createTemplateWorkbenchHost(app, {
    render: async () => {
      throw new Error("unused");
    },
    matchData: {
      tags: async () => [],
      collections: async () => [],
      libraries: async () => [],
    },
    insertTarget: () => null,
  });
  const chosen = chooseWorkbenchItem(host, deps);
  await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
  const modal = open.mock.contexts[0] as SuggestModal<WorkbenchSuggesterOption>;
  try {
    const rows = await modal.getSuggestions("rougier");
    expect(rows).toContainEqual(
      expect.objectContaining({
        id: item.indexedKey,
        label: "Ten Simple Rules for Better Figures",
      }),
    );
    modal.selectSuggestion(
      rows.find((row) => row.id === item.indexedKey)!,
      new KeyboardEvent("keydown", { key: "Enter" }),
    );
    await expect(chosen).resolves.toMatchObject({ id: item.indexedKey });
  } finally {
    modal.close();
  }
});

function workspace() {
  const listeners = new Set<(event: WorkbenchSelectionEvent) => void>();
  const app = {
    workspace: {
      on: (
        _name: string,
        listener: (event: WorkbenchSelectionEvent) => void,
      ) => {
        listeners.add(listener);
        return listener;
      },
      offref: (listener: (event: WorkbenchSelectionEvent) => void) =>
        listeners.delete(listener),
      trigger: (_name: string, event: WorkbenchSelectionEvent) => {
        for (const listener of listeners) listener(event);
      },
    },
  } as unknown as App;
  return (group: string | null = null, pinned = false) => {
    const leaf = { group, pinned } as WorkspaceLeaf;
    const view = { app, leaf } as ItemView;
    const apply = vi.fn();
    return {
      view,
      apply,
      follow: (editor: () => WorkspaceLeaf | null = () => null) =>
        subscribeWorkbenchSelection(view, { editor, apply }),
    };
  };
}

describe("native Workbench selections", () => {
  it("updates linked peers while preserving pinned and independent views", () => {
    const peer = workspace();
    const origin = peer("workbench-a");
    const linked = peer("workbench-a");
    const pinned = peer("workbench-a", true);
    const independent = peer("workbench-b");
    for (const target of [origin, linked, pinned, independent]) target.follow();

    publishWorkbenchSelection(
      origin.view,
      { kind: "item", item: { id: "sample:book", title: "Book example" } },
      null,
    );

    expect(linked.apply).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        kind: "item",
        item: { id: "sample:book", title: "Book example" },
      }),
    );
    expect(origin.apply).not.toHaveBeenCalled();
    expect(pinned.apply).not.toHaveBeenCalled();
    expect(independent.apply).not.toHaveBeenCalled();
  });

  it("shares an annotation with the associated editor and its followers", () => {
    const peer = workspace();
    const editor = peer();
    const origin = peer();
    const follower = peer();
    const independent = peer("other-workbench");
    editor.follow();
    follower.follow(() => editor.view.leaf);
    independent.follow(() => editor.view.leaf);

    publishWorkbenchSelection(
      origin.view,
      { kind: "annotation", annotationId: "sample:underline" },
      editor.view.leaf,
    );

    expect(editor.apply).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        kind: "annotation",
        annotationId: "sample:underline",
      }),
    );
    expect(follower.apply).toHaveBeenCalledOnce();
    expect(independent.apply).not.toHaveBeenCalled();
  });

  it("uses the current association and releases its listener on close", () => {
    const peer = workspace();
    const oldEditor = peer();
    const newEditor = peer();
    const follower = peer();
    let editor = oldEditor.view.leaf;
    const stop = follower.follow(() => editor);
    editor = newEditor.view.leaf;

    const select = (source: ItemView) =>
      publishWorkbenchSelection(
        source,
        { kind: "annotation", annotationId: "sample:highlight" },
        source.leaf,
      );
    select(oldEditor.view);
    expect(follower.apply).not.toHaveBeenCalled();
    select(newEditor.view);
    expect(follower.apply).toHaveBeenCalledOnce();
    stop();
    select(newEditor.view);
    expect(follower.apply).toHaveBeenCalledOnce();
  });
});
