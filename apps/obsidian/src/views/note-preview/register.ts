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
import { EXPLORER_VIEW_TYPE } from "@/views/template-data-explorer/view";
import { runTemplateWorkbenchAction } from "@/views/template-workbench/actions";
import {
  TEMPLATE_WORKBENCH_VIEW_TYPE,
  TemplateWorkbenchView,
} from "@/views/template-workbench/view";

import type { PreviewViewDeps } from "./view";
import { NotePreviewView, NOTE_PREVIEW_VIEW_TYPE } from "./view";

const logger = getLogger(["views", "workbench-association"]);
const openings = new WeakMap<TemplateWorkbenchView, Promise<void>>();

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
  deps: PreviewViewDeps,
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
        void runTemplateWorkbenchAction("open-workbench", () =>
          openWorkbenchLayout(app, editor),
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
        void runTemplateWorkbenchAction("open-preview", () =>
          openNotePreview(app, editor),
        );
      return true;
    },
  });
}

const workspaceOpenings = new WeakMap<App, Promise<void>>();

type ProfileSource = { file: string | null; defaultProfile: boolean };

/** Resolve restored leaves before deciding whether this Profile already has a workbench. */
export async function findWorkbenchLayout(
  app: App,
  source: ProfileSource,
  requesting?: TemplateWorkbenchView,
): Promise<TemplateWorkbenchView | null> {
  if (
    requesting?.leaf.group &&
    requesting.leaf.getContainer() !== app.workspace.rootSplit &&
    [EXPLORER_VIEW_TYPE, NOTE_PREVIEW_VIEW_TYPE].some((type) =>
      app.workspace
        .getLeavesOfType(type)
        .some(
          (leaf) =>
            leaf.group === requesting.leaf.group &&
            leaf.getContainer() === requesting.leaf.getContainer(),
        ),
    )
  )
    return requesting;
  for (const leaf of app.workspace.getLeavesOfType(
    TEMPLATE_WORKBENCH_VIEW_TYPE,
  )) {
    if (leaf.getContainer() === app.workspace.rootSplit) continue;
    if (!(leaf.view instanceof TemplateWorkbenchView)) {
      const state = leaf.view.getState();
      if (
        state.file !== source.file &&
        !(source.defaultProfile && (state.defaultDraft || state.file))
      )
        continue;
      await leaf.loadIfDeferred();
    }
    const candidate = leaf.view;
    if (!(candidate instanceof TemplateWorkbenchView)) continue;
    if (
      candidate !== requesting &&
      !(source.defaultProfile && candidate.isDefaultProfile) &&
      !(source.file && candidate.file?.path === source.file)
    )
      continue;
    if (hasWorkbenchPanes(app, candidate)) return candidate;
  }
  return null;
}

/** Reveal the Profile's workbench, or move this editor into a dedicated window. */
export function openWorkbenchLayout(
  app: App,
  editor: TemplateWorkbenchView,
): Promise<void> {
  const pending = openings.get(editor);
  if (pending) return pending;
  const opening = (workspaceOpenings.get(app) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const { workspace } = app;
      const existing = await findWorkbenchLayout(
        app,
        {
          file: editor.file?.path ?? null,
          defaultProfile: editor.isDefaultProfile,
        },
        editor,
      );
      if (existing && existing !== editor) {
        if (editor.file && !existing.file && existing.isDefaultProfile) {
          await existing.leaf.setViewState({
            type: TEMPLATE_WORKBENCH_VIEW_TYPE,
            state: {
              ...existing.getState(),
              file: editor.file.path,
              defaultDraft: false,
            },
          });
        }
        await revealWorkbench(app, existing);
        return;
      }
      const container = editor.leaf.getContainer();
      const otherEditor = workspace
        .getLeavesOfType(TEMPLATE_WORKBENCH_VIEW_TYPE)
        .some(
          (leaf) => leaf !== editor.leaf && leaf.getContainer() === container,
        );
      const unrelatedCompanion = [
        EXPLORER_VIEW_TYPE,
        NOTE_PREVIEW_VIEW_TYPE,
      ].some((type) =>
        workspace
          .getLeavesOfType(type)
          .some(
            (leaf) =>
              leaf.getContainer() === container &&
              (!editor.leaf.group || leaf.group !== editor.leaf.group),
          ),
      );
      if (
        container === workspace.rootSplit ||
        (otherEditor && existing !== editor) ||
        unrelatedCompanion
      ) {
        workspace.moveLeafToPopout(editor.leaf, {
          size: { width: 1440, height: 900 },
        });
        editor.onResize();
      }
      await openCompanion(app, editor, EXPLORER_VIEW_TYPE);
      await openCompanion(app, editor, NOTE_PREVIEW_VIEW_TYPE);
      await revealWorkbench(app, editor);
    })
    .finally(() => {
      openings.delete(editor);
      if (workspaceOpenings.get(app) === opening) workspaceOpenings.delete(app);
    });
  openings.set(editor, opening);
  workspaceOpenings.set(app, opening);
  return opening;
}

async function revealWorkbench(
  app: App,
  editor: TemplateWorkbenchView,
): Promise<void> {
  await app.workspace.revealLeaf(editor.leaf);
  app.workspace.setActiveLeaf(editor.leaf, { focus: true });
  editor.leaf.getContainer().focus();
}

function hasWorkbenchPanes(app: App, editor: TemplateWorkbenchView): boolean {
  const container = editor.leaf.getContainer();
  return [EXPLORER_VIEW_TYPE, NOTE_PREVIEW_VIEW_TYPE].some((type) =>
    app.workspace.getLeavesOfType(type).some((leaf) => {
      if (leaf.getContainer() !== container) return false;
      if (editor.leaf.group && leaf.group === editor.leaf.group) return true;
      const state = leaf.view.getState();
      const source = state.source as
        | { path?: string; builtin?: boolean }
        | undefined;
      return (
        (!!editor.file &&
          (state.sourceFile === editor.file.path ||
            source?.path === editor.file.path)) ||
        (editor.isDefaultProfile && source?.builtin === true)
      );
    }),
  );
}

/** Reopen the result beside its editor without opening the other workbench pane. */
export async function openNotePreview(
  app: App,
  editor: TemplateWorkbenchView,
): Promise<void> {
  const leaf = await openCompanion(app, editor, NOTE_PREVIEW_VIEW_TYPE);
  await app.workspace.revealLeaf(leaf);
  leaf.getContainer().focus();
}

/** Reopen the fields in the same window as the authoring session. */
export async function openProfileExplorer(
  app: App,
  editor: TemplateWorkbenchView,
): Promise<void> {
  const leaf = await openCompanion(app, editor, EXPLORER_VIEW_TYPE);
  await app.workspace.revealLeaf(leaf);
  leaf.getContainer().focus();
}

async function openCompanion(
  app: App,
  editor: TemplateWorkbenchView,
  type: typeof EXPLORER_VIEW_TYPE | typeof NOTE_PREVIEW_VIEW_TYPE,
): Promise<WorkspaceLeaf> {
  const { workspace } = app;
  const existing = workspace
    .getLeavesOfType(type)
    .find((leaf) => !!editor.leaf.group && leaf.group === editor.leaf.group);
  if (existing) return existing;
  const leaf = workspace.createLeafBySplit(
    editor.leaf,
    "vertical",
    type === EXPLORER_VIEW_TYPE,
  );
  leaf.setGroupMember(editor.leaf);
  await leaf.setViewState({ type, active: false });
  return leaf;
}
