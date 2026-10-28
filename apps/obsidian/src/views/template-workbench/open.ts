// The launches that open a Template Workbench View, as Effects over the
// Workspace and Vault tags. A leaf stays an edge: its view state is set
// through the leaf itself.
import { Effect } from "effect";
import { TFile } from "obsidian";
import type { App, ViewState, WorkspaceLeaf } from "obsidian";

import { WorkbenchDocumentController } from "@zotlit/workbench/document";

import { Vault } from "@/lib/obsidian-vault";
import { Workspace } from "@/lib/obsidian-workspace";
import type { ArrivingProblem } from "@/lib/workbench-recovery";
import type {
  CustomizeAction,
  CustomizeRequest,
  NativeProfileTarget,
} from "@/services/local-bridge/customize";
import {
  findWorkbenchLayout,
  openNotePreview,
  openWorkbenchLayout,
} from "@/views/note-preview/register";

import type { WorkbenchOpened } from "./actions";
import { TEMPLATE_WORKBENCH_VIEW_TYPE, TemplateWorkbenchView } from "./view";

/** An open that asks the reader to know nothing. */
const OPENED: WorkbenchOpened = {
  nativeRequired: false,
  unavailableNote: null,
};

/** The size of the window a Customize launch opens the Workbench in. */
const WORKBENCH_WINDOW = { width: 1440, height: 900 } as const;

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

/** Obsidian's `setViewState` on `leaf`: a leaf stays an edge of the tags. */
export const setLeafState = (leaf: WorkspaceLeaf, state: ViewState) =>
  Effect.tryPromise(() => leaf.setViewState(state));

// The Note Preview layout functions take the App and answer Promises; these
// are their Effect forms for the Workbench launches.

/** The Profile's workbench that already has its panes, or `null`. */
const workbenchLayout = (
  app: App,
  source: { file: string | null; defaultProfile: boolean },
) => Effect.tryPromise(() => findWorkbenchLayout(app, source));

/** Reveal the Profile's workbench, or move `editor` into a dedicated window. */
export const openWorkbenchLayoutEffect = (
  editor: TemplateWorkbenchView,
  app: App = editor.app,
) => Effect.tryPromise(() => openWorkbenchLayout(app, editor));

/** Open the Note Preview beside `editor`. */
export const openNotePreviewEffect = (
  editor: TemplateWorkbenchView,
  app: App = editor.app,
) => Effect.tryPromise(() => openNotePreview(app, editor));

/** Customize on the reader's chosen surface, through the Local Bridge launch. */
export const customizeProfile = (
  customize: CustomizeAction,
  request: CustomizeRequest,
) => Effect.tryPromise(() => customize(request));

/** Reveal `leaf`, focus it, and answer the view it holds when it is a Workbench. */
const revealWorkbench = Effect.fn("TemplateWorkbench.revealWorkbench")(
  function* (leaf: WorkspaceLeaf) {
    yield* (yield* Workspace).revealLeaf(leaf);
    leaf.getContainer().focus();
    return leaf.view instanceof TemplateWorkbenchView ? leaf.view : null;
  },
);

/**
 * Open a Profile document with an explicitly supplied launch Item.
 *
 * @returns what the open asks the reader to know, for the caller to show.
 */
export const openTemplateWorkbench = Effect.fn(
  "TemplateWorkbench.openTemplateWorkbench",
)(function* (
  app: App,
  file: TFile,
  options: {
    leaf?: WorkspaceLeaf;
    itemIndexedKey?: string;
    originatingNote?: TFile;
    tab?: "match" | "name";
    explainUnsupported?: boolean;
    customize?: boolean;
    defaultProfile?: boolean;
    /** The failure that brought the reader here, explained on arrival. */
    problem?: ArrivingProblem;
  } = {},
) {
  const workspace = yield* Workspace;
  const nativeRequired =
    options.explainUnsupported !== false &&
    requiresNative(yield* (yield* Vault).cachedRead(file));
  const { itemIndexedKey } = options;
  const workbench = options.customize
    ? yield* workbenchLayout(app, {
        file: file.path,
        defaultProfile: options.defaultProfile ?? false,
      })
    : null;
  const leaf =
    workbench?.leaf ??
    options.leaf ??
    (yield* workspace.leavesOfType(TEMPLATE_WORKBENCH_VIEW_TYPE)).find(
      (entry) =>
        entry.view instanceof TemplateWorkbenchView &&
        entry.view.file?.path === file.path,
    ) ??
    (options.customize
      ? yield* workspace.openPopoutLeaf(WORKBENCH_WINDOW)
      : yield* workspace.getLeaf("tab"));
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
  if (options.customize) yield* openWorkbenchLayoutEffect(view, app);
  return {
    nativeRequired,
    unavailableNote: yield* view.setOriginatingNote(
      options.originatingNote ?? null,
    ),
  } satisfies WorkbenchOpened;
});

/**
 * Open a Profile file or the built-in Default draft in the native editor.
 *
 * @returns what the open asks the reader to know, for the caller to show.
 */
export const openNativeProfile = Effect.fn(
  "TemplateWorkbench.openNativeProfile",
)(function* (
  app: App,
  target: NativeProfileTarget,
  options: {
    leaf?: WorkspaceLeaf;
    itemIndexedKey?: string;
    originatingNote?: TFile;
    explainUnsupported?: boolean;
    customize?: boolean;
    /** The failure that brought the reader here, explained on arrival. */
    problem?: ArrivingProblem;
  } = {},
) {
  const workspace = yield* Workspace;
  const vault = yield* Vault;
  const path =
    target instanceof TFile ? target.path : target.defaultDocumentPath;
  const file =
    target instanceof TFile
      ? target
      : path
        ? yield* vault.getFileByPath(path)
        : null;
  if (!file && target instanceof TFile) return OPENED;
  const source = file
    ? yield* vault.cachedRead(file)
    : yield* Effect.tryPromise(() =>
        (target as Exclude<NativeProfileTarget, TFile>).getSource("default"),
      );
  if (file)
    return yield* openTemplateWorkbench(app, file, {
      ...options,
      ...(target instanceof TFile ? {} : { defaultProfile: true }),
    });
  const nativeRequired =
    options.explainUnsupported !== false && requiresNative(source);
  const { itemIndexedKey } = options;
  const workbench = options.customize
    ? yield* workbenchLayout(app, { file: null, defaultProfile: true })
    : null;
  if (workbench?.file) {
    const opened = yield* openTemplateWorkbench(app, workbench.file, {
      ...options,
      leaf: workbench.leaf,
      defaultProfile: true,
    });
    return {
      ...opened,
      nativeRequired: nativeRequired || opened.nativeRequired,
    };
  }
  const leaf =
    workbench?.leaf ??
    options.leaf ??
    (yield* workspace.leavesOfType(TEMPLATE_WORKBENCH_VIEW_TYPE)).find(
      (entry) =>
        entry.view instanceof TemplateWorkbenchView &&
        entry.view.isDefaultDraft,
    ) ??
    (options.customize
      ? yield* workspace.openPopoutLeaf(WORKBENCH_WINDOW)
      : yield* workspace.getLeaf("tab"));
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
  return {
    nativeRequired,
    unavailableNote: yield* view.setOriginatingNote(
      options.originatingNote ?? null,
    ),
  } satisfies WorkbenchOpened;
});

/** What an open of a Profile in the native editor fails with. */
export type NativeOpenError = Effect.Error<
  ReturnType<typeof openNativeProfile>
>;
