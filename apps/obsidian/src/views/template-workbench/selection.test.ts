// @vitest-environment happy-dom

import type { App, EventRef, ItemView, WorkspaceLeaf } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";

import {
  publishWorkbenchSelection,
  subscribeWorkbenchSelection,
} from "./selection";
import type { WorkbenchSelectionEvent } from "./selection";

function workspace() {
  const listeners = new Set<(event: WorkbenchSelectionEvent) => void>();
  const refs = new Map<EventRef, (event: WorkbenchSelectionEvent) => unknown>();
  const on = vi.fn();
  const app = stubService<App>("App", {
    workspace: stubService<App["workspace"]>("Workspace", {
      on,
      offref: vi.fn((ref: EventRef) => {
        const listener = refs.get(ref);
        if (listener) listeners.delete(listener);
        refs.delete(ref);
      }),
    }),
  });
  on.mockImplementation(
    (
      _name: string,
      listener: (event: WorkbenchSelectionEvent) => unknown,
    ): EventRef => {
      listeners.add(listener);
      const ref = stubService<EventRef>("EventRef", {});
      refs.set(ref, listener);
      return ref;
    },
  );
  const trigger = (_name: string, event: WorkbenchSelectionEvent) => {
    for (const listener of listeners) listener(event);
  };
  app.workspace.trigger = trigger;
  return (group: string | null = null, pinned = false) => {
    const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
      updateHeader: vi.fn(),
      group,
      pinned,
    });
    const view = stubService<ItemView>("ItemView", { app, leaf });
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
