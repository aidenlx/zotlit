// The one open of a Template Workbench View, as Effects over the Workspace
// and Vault tags: every entry point that shows a Template Document in the
// Workbench calls `openTemplateWorkbench`, which lands in a Workbench window.
// A leaf stays an edge: its view state is set through the leaf itself.
import { Effect, Semaphore } from "effect";
import { TFile } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";

import { WorkbenchDocumentController } from "@zotlit/workbench/document";

import { Vault } from "@/lib/obsidian-vault";
import { Workspace } from "@/lib/obsidian-workspace";
import type { ArrivingProblem } from "@/lib/workbench-recovery";
import { Customize } from "@/services/local-bridge/customize";
import type {
  CustomizeRequest,
  NativeProfileTarget,
} from "@/services/local-bridge/customize";
import { Profile } from "@/services/profile/service";

import type { WorkbenchOpened } from "./actions";
import {
  findWorkbenchLayout,
  openWorkbenchLayout,
  setLeafState,
  WORKBENCH_WINDOW,
} from "./layout";
import { TEMPLATE_WORKBENCH_VIEW_TYPE, TemplateWorkbenchView } from "./view";

/** An open that asks the reader to know nothing. */
const OPENED: WorkbenchOpened = {
  nativeRequired: false,
  unavailableNote: null,
};

export function requiresNative(source: string): boolean {
  const manifest = new WorkbenchDocumentController(source, {
    runtime: "native",
  }).document?.manifest;
  return (
    manifest?.language === "eta" ||
    !!manifest?.partials?.some((partial) => partial.language === "eta") ||
    !!manifest?.frontmatter?.some((field) => "js" in field)
  );
}

/** Customize on the reader's chosen surface, through the Local Bridge launch. */
export const customizeProfile = Effect.fn("TemplateWorkbench.customizeProfile")(
  function* (request: CustomizeRequest) {
    yield* (yield* Customize).open(request);
  },
);

/**
 * The leaf the reader starts an open from. When it already stands in a
 * Workbench window, the document opens in that window: in the leaf itself,
 * or in a new tab or split beside it.
 */
export interface WorkbenchOpenFrom {
  readonly leaf: WorkspaceLeaf;
  readonly place: "replace" | "tab" | "split";
}

/** What an open of the Template Workbench carries. */
export interface WorkbenchOpenOptions {
  readonly itemIndexedKey?: string;
  readonly originatingNote?: TFile;
  readonly tab?: "match" | "name";
  readonly explainUnsupported?: boolean;
  /** For the built-in Default: write its document before editing starts. */
  readonly customize?: boolean;
  readonly from?: WorkbenchOpenFrom;
  /** The failure that brought the reader here, explained on arrival. */
  readonly problem?: ArrivingProblem;
}

/** Reveal `leaf`, focus it, and answer the view it holds when it is a Workbench. */
const revealWorkbench = Effect.fn("TemplateWorkbench.revealWorkbench")(
  function* (leaf: WorkspaceLeaf) {
    yield* (yield* Workspace).revealLeaf(leaf);
    leaf.getContainer().focus();
    return leaf.view instanceof TemplateWorkbenchView ? leaf.view : null;
  },
);

/**
 * Where a document opens: the Workbench window that holds it, else beside the
 * leaf the open starts from when that leaf stands in a Workbench window, else
 * a Workbench leaf of the document in the main window (the layout then moves
 * it into a window of its own), else a new window.
 */
const workbenchLeaf = Effect.fn("TemplateWorkbench.workbenchLeaf")(function* (
  window: TemplateWorkbenchView | null,
  from: WorkbenchOpenFrom | undefined,
  holds: (view: TemplateWorkbenchView) => boolean,
) {
  if (window) return window.leaf;
  const workspace = yield* Workspace;
  if (from && from.leaf.getContainer() !== (yield* workspace.rootSplit)) {
    if (from.place === "replace") return from.leaf;
    return from.place === "split"
      ? yield* workspace.createLeafBySplit(from.leaf)
      : yield* workspace.getLeaf("tab");
  }
  const held = (yield* workspace.leavesOfType(
    TEMPLATE_WORKBENCH_VIEW_TYPE,
  )).find(
    (leaf) => leaf.view instanceof TemplateWorkbenchView && holds(leaf.view),
  );
  return held ?? (yield* workspace.openPopoutLeaf(WORKBENCH_WINDOW));
});

/**
 * One launch at a time in the workspace, so a later launch finds the leaf an
 * earlier one opened and applies its own state after it. Obsidian skips a
 * `setViewState` on a leaf that still applies another, so two launches into
 * one leaf at once would keep the first launch's Item and note.
 */
const launchTurn = Semaphore.makeUnsafe(1);

/** A Template Document's file, inside a launch turn its caller holds. */
const launchFile = Effect.fn("TemplateWorkbench.launchFile")(function* (
  file: TFile,
  options: WorkbenchOpenOptions & { defaultProfile?: boolean },
) {
  const nativeRequired =
    options.explainUnsupported !== false &&
    requiresNative(yield* (yield* Vault).cachedRead(file));
  const { itemIndexedKey } = options;
  const workbench = yield* findWorkbenchLayout({
    file: file.path,
    defaultProfile: options.defaultProfile ?? false,
  });
  const leaf = yield* workbenchLeaf(
    workbench,
    options.from,
    (view) => view.file?.path === file.path,
  );
  yield* setLeafState(leaf, {
    type: TEMPLATE_WORKBENCH_VIEW_TYPE,
    state: {
      file: file.path,
      ...(workbench && !workbench.file ? { defaultDraft: false } : {}),
      ...(itemIndexedKey ? { itemIndexedKey } : {}),
      ...(options.tab ? { tab: options.tab, advanced: false } : {}),
    },
    active: true,
  });
  const view = yield* revealWorkbench(leaf);
  if (!view) return { ...OPENED, nativeRequired };
  if (options.problem) view.explainArrival(options.problem);
  yield* openWorkbenchLayout(view);
  return {
    nativeRequired,
    unavailableNote: yield* view.setOriginatingNote(
      options.originatingNote ?? null,
    ),
  } satisfies WorkbenchOpened;
});

/** {@link openTemplateWorkbench} inside a launch turn its caller holds. */
const launchTemplateWorkbench = Effect.fn(
  "TemplateWorkbench.openTemplateWorkbench",
)(function* (target: NativeProfileTarget, options: WorkbenchOpenOptions = {}) {
  const vault = yield* Vault;
  if (target instanceof TFile) return yield* launchFile(target, options);
  const path = target.defaultDocumentPath;
  const file = path ? yield* vault.getFileByPath(path) : null;
  if (file)
    return yield* launchFile(file, { ...options, defaultProfile: true });
  const source = yield* (yield* Profile).getSource("default");
  const nativeRequired =
    options.explainUnsupported !== false && requiresNative(source);
  const { itemIndexedKey } = options;
  const workbench = yield* findWorkbenchLayout({
    file: null,
    defaultProfile: true,
  });
  if (workbench?.file) {
    const opened = yield* launchFile(workbench.file, {
      ...options,
      defaultProfile: true,
    });
    return {
      ...opened,
      nativeRequired: nativeRequired || opened.nativeRequired,
    };
  }
  const leaf = yield* workbenchLeaf(
    workbench,
    options.from,
    (view) => view.isDefaultDraft,
  );
  yield* setLeafState(leaf, {
    type: TEMPLATE_WORKBENCH_VIEW_TYPE,
    state: {
      defaultDraft: true,
      file: null,
      ...(itemIndexedKey ? { itemIndexedKey } : {}),
    },
    active: true,
  });
  const view = yield* revealWorkbench(leaf);
  if (!view) return { ...OPENED, nativeRequired };
  if (options.problem) view.explainArrival(options.problem);
  if (options.customize) yield* view.customizeDefault();
  else yield* openWorkbenchLayout(view);
  return {
    nativeRequired,
    unavailableNote: yield* view.setOriginatingNote(
      options.originatingNote ?? null,
    ),
  } satisfies WorkbenchOpened;
});

/**
 * Open a Template Document — a Profile file, the Default Profile (its
 * built-in draft while its document is missing), the Citation Template or a
 * Shared Partial — in the Template Workbench. The document shows in a
 * Workbench window, with its Preview: the window that already holds it, or a
 * new one.
 *
 * @returns what the open asks the reader to know, for the caller to show.
 */
export const openTemplateWorkbench: typeof launchTemplateWorkbench = (
  target,
  options,
) => launchTurn.withPermit(launchTemplateWorkbench(target, options));

/** What an open of a Template Document in the Workbench fails with. */
export type NativeOpenError = Effect.Error<
  ReturnType<typeof openTemplateWorkbench>
>;
