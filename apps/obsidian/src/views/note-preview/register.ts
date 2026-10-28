// Explicit workbench opening and native group/follow association for companion views.
import type {
  App,
  Plugin,
  WorkspaceLeaf,
  ItemView,
  ViewStateResult,
} from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { startTemplateWorkbenchAction } from "@/views/template-workbench/actions";
import type { WorkbenchActionDeps } from "@/views/template-workbench/actions";
import {
  TEMPLATE_WORKBENCH_VIEW_TYPE,
  TemplateWorkbenchView,
} from "@/views/template-workbench/view";

import { openNotePreview, openWorkbenchLayout } from "./layout";
import type { PreviewViewDeps } from "./view";
import { NotePreviewView, NOTE_PREVIEW_VIEW_TYPE } from "./view";

const logger = getLogger(["views", "workbench-association"]);

/**
 * Native history gates ItemViews on navigation, while Outline needs these panes
 * to remain non-navigating. Only the synchronous native recorder sees the proxy;
 * its history owner and history-change listeners keep the real leaf and view.
 */
export function registerCompanionHistory(view: ItemView): () => void {
  const leaf = view.leaf;
  const descriptor = Object.getOwnPropertyDescriptor(leaf, "recordHistory");
  // oxlint-disable-next-line typescript/unbound-method -- The native recorder receives an explicit proxy receiver below.
  const original = leaf.recordHistory;
  let owner: ItemView | null = view;
  const record = function (this: WorkspaceLeaf, state: unknown): void {
    const current = owner;
    if (!current || this.view !== current) return original.call(this, state);
    const historyView = new Proxy(current, {
      get(target, key) {
        return key === "navigation" ? true : Reflect.get(target, key, target);
      },
    });
    const receiver = new Proxy(this, {
      get(target, key) {
        return key === "view" ? historyView : Reflect.get(target, key, target);
      },
    });
    original.call(receiver, state);
  };
  leaf.recordHistory = record;
  return () => {
    owner = null;
    if (leaf.recordHistory !== record) return;
    if (descriptor) Object.defineProperty(leaf, "recordHistory", descriptor);
    else Reflect.deleteProperty(leaf, "recordHistory");
  };
}

/** Native completion follows group assignment; layout readiness also gates startup restores. */
export function onCompanionStateRestored(
  app: App,
  result: ViewStateResult,
  callback: () => void,
): void {
  const done = result.done;
  result.done = () => {
    done?.();
    app.workspace.onLayoutReady(callback);
  };
}

/** Native group order wins; unlinked panes follow Outline's app-wide file context. */
export function activeTemplateWorkbench(
  app: App,
  leaf: WorkspaceLeaf | null = app.workspace.activeLeaf,
  retained: TemplateWorkbenchView | null = null,
): TemplateWorkbenchView | null {
  if (leaf?.view instanceof TemplateWorkbenchView) return leaf.view;
  if (leaf?.group) {
    const editor = app.workspace
      .getGroupLeaves(leaf.group)
      .find((peer) => peer.view instanceof TemplateWorkbenchView)?.view;
    return editor instanceof TemplateWorkbenchView ? editor : null;
  }
  if (leaf?.pinned && leaf.view.getViewType() !== TEMPLATE_WORKBENCH_VIEW_TYPE)
    return retained &&
      app.workspace
        .getLeavesOfType(TEMPLATE_WORKBENCH_VIEW_TYPE)
        .some((peer) => peer.view === retained)
      ? retained
      : null;
  const view = app.workspace.getActiveFileView();
  return view instanceof TemplateWorkbenchView ? view : null;
}

/** Each caller owns its native subscriptions, including peer layout changes. */
export function subscribeActiveTemplateWorkbench(
  app: App,
  listener: (editor: TemplateWorkbenchView | null) => void,
  leaf?: WorkspaceLeaf,
): () => void {
  using cleanup = new DisposableStack();
  let editor: TemplateWorkbenchView | null = null;
  let ready = false;
  let initialized = false;
  let pinned = leaf?.pinned;
  let disposed = false;
  cleanup.defer(() => {
    disposed = true;
  });
  const refresh = () => {
    if (disposed || !ready) return;
    const next = activeTemplateWorkbench(app, leaf, editor);
    const unpinned = pinned && !leaf?.pinned;
    pinned = leaf?.pinned;
    if (initialized && next === editor && !unpinned) return;
    initialized = true;
    logger.debug("Workbench editor binding changed", {
      leaf: leaf?.id ?? null,
      previousLeaf: editor?.leaf.id ?? null,
      nextLeaf: next?.leaf.id ?? null,
      mode: leaf?.group ? "group" : leaf?.pinned ? "pinned" : "follow",
      group: leaf?.group ?? null,
      pinned: leaf?.pinned ?? false,
    });
    editor = next;
    listener(editor);
  };
  for (const ref of [
    app.workspace.on("active-leaf-change", refresh),
    app.workspace.on("file-open", refresh),
    app.workspace.on("layout-change", refresh),
  ]) {
    cleanup.defer(() => app.workspace.offref(ref));
  }
  if (leaf) {
    for (const ref of [
      leaf.on("group-change", refresh),
      leaf.on("pinned-change", refresh),
    ]) {
      cleanup.defer(() => leaf.offref(ref));
    }
  }
  app.workspace.onLayoutReady(() => {
    ready = true;
    refresh();
  });
  const subscriptions = cleanup.move();
  return () => subscriptions.dispose();
}
export function registerNotePreview(
  plugin: Plugin,
  deps: PreviewViewDeps & WorkbenchActionDeps,
): void {
  const { app } = plugin;
  plugin.registerView(
    NOTE_PREVIEW_VIEW_TYPE,
    (leaf) => new NotePreviewView(leaf, plugin.manifest.id, deps),
  );
  plugin.addCommand({
    id: "open-template-workbench",
    name: m.template_workbench_open_layout(),
    checkCallback(checking) {
      const editor = activeTemplateWorkbench(app);
      if (!editor) return false;
      if (!checking)
        startTemplateWorkbenchAction(
          deps,
          "open-workbench",
          openWorkbenchLayout(editor),
        );
      return true;
    },
  });
  plugin.addCommand({
    id: "open-note-preview",
    name: m.profile_preview_open(),
    checkCallback(checking) {
      const editor = activeTemplateWorkbench(app);
      if (!editor) return false;
      if (!checking)
        startTemplateWorkbenchAction(
          deps,
          "open-preview",
          openNotePreview(editor),
        );
      return true;
    },
  });
}
