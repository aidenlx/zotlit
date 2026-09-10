import type { App, ItemView, WorkspaceLeaf } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import {
  publishWorkbenchSelection,
  subscribeWorkbenchSelection,
} from "./selection";
import type { WorkbenchSelectionEvent } from "./selection";

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
