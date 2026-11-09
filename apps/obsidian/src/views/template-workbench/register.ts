import "./style.css";
import { MarkdownView, Platform, TFile } from "obsidian";
import type { App, Plugin, WorkspaceLeaf } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { MENU_SECTION } from "@/lib/menu-section";
import { profileRecoveryNotice } from "@/lib/profile-recovery";
import { unknownProfileDiagnostic } from "@/lib/profile-stamp";
import type { FileMenuSegment } from "@/services/file-menu";
import type {
  DefaultProfileTarget,
  NativeProfileTarget,
} from "@/services/local-bridge/customize";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";
import {
  profileStateAtom,
  fileProfileValueAtom,
} from "@/services/profile/atoms";
import { templateFolderAtom } from "@/services/settings/atoms";

import { explainNoOpen, startTemplateWorkbenchAction } from "./actions";
import type { WorkbenchActionDeps, WorkbenchOpen } from "./actions";
import { templateDocumentKind } from "./document-kind";
import { noteEmbedPlaceholders } from "./embed-placeholder";
import { customizeProfile, openTemplateWorkbench } from "./open";
import type { WorkbenchOpenOptions } from "./open";
import { TEMPLATE_WORKBENCH_VIEW_TYPE, TemplateWorkbenchView } from "./view";
import type { TemplateWorkbenchDeps } from "./view";

type RegistrationDeps = TemplateWorkbenchDeps &
  WorkbenchActionDeps & {
    webWorkbenchEnabled: boolean;
    /** The Default Profile, which a note on the Default Profile opens. */
    defaultProfile: DefaultProfileTarget;
  };

/**
 * What the Workbench's commands, header action, and file-menu entries ask of a
 * file: which kind of Template Document it is, which Profile a note opens, the
 * one open "Open template workbench" runs for it, and the web Workbench launch.
 */
function workbenchTargets(app: App, deps: RegistrationDeps) {
  const state = () => deps.registry.get(profileStateAtom);
  /** A plain document — the Citation Template or a Shared Partial — which the
   *  view opens without any Profile flow. */
  const isPlainDocument = (file: TFile | null): file is TFile =>
    file !== null &&
    templateDocumentKind(file, deps.registry.get(templateFolderAtom)) !==
      "profile";
  const isProfile = (file: TFile | null): file is TFile =>
    file !== null &&
    file.extension === "md" &&
    (file.path === state()?.defaultDocumentPath ||
      (state()?.profiles ?? []).some((profile) => profile.path === file.path) ||
      file.basename.startsWith("zotlit-profile."));
  /** The Profile a Literature Note carries, or the stamp the vault holds no Profile for. */
  const noteProfile = (file: TFile | null) => {
    if (!file || !itemKeyFromFrontmatter(app.metadataCache.getFileCache(file)))
      return null;
    const resolved = deps.registry.get(fileProfileValueAtom(file.path));
    if (!resolved) return null;
    if (!resolved.ok)
      return {
        kind: "unknown" as const,
        diagnostic: unknownProfileDiagnostic(resolved.stamped.stamp, {
          path: file.path,
        }),
      };
    if (resolved.profile.selector === "default")
      return { kind: "open" as const, target: deps.defaultProfile };
    const profile = (state()?.profiles ?? []).find(
      (entry) => entry.id === resolved.profile.selector,
    );
    const target = profile ? app.vault.getFileByPath(profile.path) : null;
    return target ? { kind: "open" as const, target } : null;
  };
  const targetOf = (file: TFile | null): NativeProfileTarget | null => {
    if (isProfile(file)) return file;
    const note = noteProfile(file);
    return note?.kind === "open" ? note.target : null;
  };
  /**
   * "Open template workbench" for `file`: a Template Document opens itself,
   * starting from `leaf` when that is the document's own Markdown leaf; a
   * Literature Note opens its Profile with the note's Item, and the note as
   * the one to update. A note on the built-in Default writes its document
   * first, so the reader edits at once. `null` when `file` is neither.
   */
  const workbenchOpen = (
    file: TFile | null,
    leaf?: WorkspaceLeaf,
  ): WorkbenchOpen | null => {
    if (isPlainDocument(file) || isProfile(file)) {
      const options: WorkbenchOpenOptions = {
        ...(isPlainDocument(file) ? { explainUnsupported: false } : {}),
        ...(leaf ? { from: { leaf, place: "replace" } } : {}),
      };
      return openTemplateWorkbench(file, options);
    }
    const note = noteProfile(file);
    if (!note || !file) return null;
    if (note.kind === "unknown")
      return explainNoOpen(profileRecoveryNotice(app, note.diagnostic));
    const itemIndexedKey = itemKeyFromFrontmatter(
      app.metadataCache.getFileCache(file),
    );
    return openTemplateWorkbench(note.target, {
      ...(itemIndexedKey ? { itemIndexedKey } : {}),
      originatingNote: file,
      customize: true,
    });
  };
  /** The web Workbench launch for `target`, through the Customize flow. */
  const webTarget = (
    target: NativeProfileTarget,
    options: { itemIndexedKey?: string } = {},
  ) => {
    const profileId =
      target instanceof TFile
        ? target.path === state()?.defaultDocumentPath
          ? "default"
          : (state()?.profiles ?? []).find(
              (profile) => profile.path === target.path,
            )?.id
        : "default";
    if (!profileId) return openTemplateWorkbench(target, options);
    return customizeProfile({
      profileId,
      destination: "web",
      ...(options.itemIndexedKey
        ? { item: { key: options.itemIndexedKey, title: null } }
        : {}),
    });
  };
  return { isPlainDocument, isProfile, targetOf, workbenchOpen, webTarget };
}

/** Register the Template Workbench view, its commands, and its header actions. */
export function registerTemplateWorkbenchView(
  plugin: Plugin,
  deps: RegistrationDeps,
): void {
  if (!Platform.isDesktopApp) return;
  const { isPlainDocument, isProfile, targetOf, workbenchOpen, webTarget } =
    workbenchTargets(plugin.app, deps);
  plugin.registerView(
    TEMPLATE_WORKBENCH_VIEW_TYPE,
    (leaf) =>
      new TemplateWorkbenchView(leaf, {
        ...deps,
        pluginVersion: plugin.manifest.version,
      }),
  );
  // A note embed in the Preview draws a placeholder for the embedded note.
  plugin.registerMarkdownPostProcessor(noteEmbedPlaceholders(plugin.app));
  plugin.addCommand({
    id: "open-template-workbench",
    name: m.template_workbench_open_layout(),
    checkCallback(checking) {
      const { workspace } = plugin.app;
      // The built-in Default draft has no file; its view opens it all the same.
      const editor = workspace.getActiveViewOfType(TemplateWorkbenchView);
      const active = workspace.getActiveFile();
      const open =
        editor && !editor.file && editor.isDefaultDraft
          ? openTemplateWorkbench(deps.defaultProfile)
          : workbenchOpen(active, activeLeafFor(plugin.app, active));
      if (!open) return false;
      if (!checking) startTemplateWorkbenchAction(deps, "open-workbench", open);
      return true;
    },
  });
  if (deps.webWorkbenchEnabled)
    plugin.addCommand({
      id: "open-profile-web-workbench",
      name: m.template_workbench_web_open(),
      checkCallback(checking) {
        const target = targetOf(plugin.app.workspace.getActiveFile());
        if (!target) return false;
        if (!checking)
          startTemplateWorkbenchAction(deps, "open-web", webTarget(target));
        return true;
      },
    });
  // A note operation that refused offers this route back: the Workbench opens
  // on the document whose call refused, so the repair is one click away. The
  // Default Profile stands in when the refusal named no document — a legacy
  // slot render, or a draft compiled from source rather than from a file.
  plugin.registerEvent(
    plugin.app.workspace.on("zotlit:open-template-workbench", (request) => {
      const { document, problem } = request;
      const file = document ? plugin.app.vault.getFileByPath(document) : null;
      startTemplateWorkbenchAction(
        deps,
        "open-workbench",
        openTemplateWorkbench(file ?? deps.defaultProfile, {
          explainUnsupported: false,
          ...(problem ? { problem } : {}),
        }),
      );
    }),
  );
  const actions = new Map<MarkdownView, HTMLElement>();
  function refreshActions() {
    const open = new Set(
      plugin.app.workspace
        .getLeavesOfType("markdown")
        .map((leaf) => leaf.view)
        .filter(
          (view): view is MarkdownView =>
            view instanceof MarkdownView &&
            (isProfile(view.file) || isPlainDocument(view.file)),
        ),
    );
    for (const [view, action] of actions)
      if (!open.has(view)) {
        action.remove();
        actions.delete(view);
      }
    for (const view of open)
      if (!actions.has(view))
        actions.set(
          view,
          view.addAction(
            "file-pen-line",
            m.template_workbench_open_layout(),
            () => {
              const opening = workbenchOpen(view.file, view.leaf);
              if (opening)
                startTemplateWorkbenchAction(deps, "open-workbench", opening);
            },
          ),
        );
  }
  plugin.registerEvent(
    plugin.app.workspace.on("layout-change", refreshActions),
  );
  plugin.registerEvent(plugin.app.workspace.on("file-open", refreshActions));
  plugin.register(() => {
    for (const action of actions.values()) action.remove();
    actions.clear();
  });
  plugin.app.workspace.onLayoutReady(refreshActions);
}

/** The Workbench's entries on Obsidian's file menu; none off the desktop app. */
export function templateWorkbenchFileMenu(
  app: App,
  deps: RegistrationDeps,
): FileMenuSegment {
  if (!Platform.isDesktopApp) return () => {};
  const { isPlainDocument, targetOf, workbenchOpen, webTarget } =
    workbenchTargets(app, deps);
  return (menu, { file, leaf: menuLeaf, itemKey }) => {
    // The Workbench view's own pane menu raises this event too. Inside the
    // view these entries repeat the routes it already offers, so the file
    // menu keeps them for the surfaces that stand outside the Workbench.
    if (menuLeaf?.view instanceof TemplateWorkbenchView) return;
    const open = workbenchOpen(file, activeLeafFor(app, file));
    if (open)
      menu.addItem((item) =>
        item
          .setSection(MENU_SECTION.open)
          .setTitle(m.template_workbench_open_layout())
          .setIcon("file-pen-line")
          .onClick(() =>
            startTemplateWorkbenchAction(deps, "open-workbench", open),
          ),
      );
    const target = isPlainDocument(file) ? null : targetOf(file);
    if (target && deps.webWorkbenchEnabled)
      menu.addItem((item) =>
        item
          .setSection(MENU_SECTION.open)
          .setTitle(m.template_workbench_web_open())
          .setIcon("external-link")
          .onClick(() =>
            startTemplateWorkbenchAction(
              deps,
              "open-web",
              webTarget(target, itemKey ? { itemIndexedKey: itemKey } : {}),
            ),
          ),
      );
  };
}

function activeLeafFor(
  app: App,
  file: TFile | null,
): WorkspaceLeaf | undefined {
  const leaf = app.workspace.activeLeaf;
  return leaf?.view instanceof MarkdownView && leaf.view.file === file
    ? leaf
    : undefined;
}
