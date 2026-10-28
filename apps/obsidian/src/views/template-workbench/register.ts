import "./style.css";
import { MarkdownView, Platform, TFile } from "obsidian";
import type { App, Plugin, WorkspaceLeaf } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { MENU_SECTION } from "@/lib/menu-section";
import type { FileMenuSegment } from "@/services/file-menu";
import type {
  CustomizeAction,
  DefaultProfileTarget,
  NativeProfileTarget,
} from "@/services/local-bridge/customize";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";
import {
  profileStateAtom,
  fileProfileValueAtom,
} from "@/services/profile/atoms";
import { templateFolderAtom } from "@/services/settings/atoms";

import { startTemplateWorkbenchAction } from "./actions";
import type { WorkbenchActionDeps } from "./actions";
import { templateDocumentKind } from "./document-kind";
import {
  customizeProfile,
  openNativeProfile,
  openTemplateWorkbench,
} from "./open";
import { TEMPLATE_WORKBENCH_VIEW_TYPE, TemplateWorkbenchView } from "./view";
import type { TemplateWorkbenchDeps } from "./view";

type RegistrationDeps = TemplateWorkbenchDeps &
  WorkbenchActionDeps & {
    webWorkbenchEnabled: boolean;
    customize: CustomizeAction;
    /** The Default Profile, which a note on the Default Profile opens. */
    defaultProfile: DefaultProfileTarget;
  };
/**
 * What the Workbench's commands, header action, and file-menu entries ask of a
 * file: which kind of Template Document it is, which Profile a note opens, and
 * the Customize launch for that Profile.
 */
function workbenchTargets(app: App, deps: RegistrationDeps) {
  const state = () => deps.registry.get(profileStateAtom);
  /** A plain document — the Citation Template or a Shared Partial — which the
   *  view opens on its own tab without any Profile flow. */
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
  const targetOf = (file: TFile | null) => {
    if (isProfile(file)) return file;
    if (!file || !itemKeyFromFrontmatter(app.metadataCache.getFileCache(file)))
      return null;
    const resolved = deps.registry.get(
      fileProfileValueAtom((file as TFile).path),
    );
    if (!resolved?.ok) return null;
    if (resolved.profile.selector === "default") return deps.defaultProfile;
    const profile = (state()?.profiles ?? []).find(
      (entry) => entry.id === resolved.profile.selector,
    );
    return profile ? app.vault.getFileByPath(profile.path) : null;
  };
  const customizeTarget = (
    target: NativeProfileTarget,
    options: { itemIndexedKey?: string; destination?: "web" | "native" } = {},
  ) => {
    const profileId =
      target instanceof TFile
        ? target.path === state()?.defaultDocumentPath
          ? "default"
          : (state()?.profiles ?? []).find(
              (profile) => profile.path === target.path,
            )?.id
        : "default";
    if (!profileId)
      return openNativeProfile(target, {
        ...options,
        customize: true,
      });
    return customizeProfile(deps.customize, {
      profileId,
      ...(options.destination ? { destination: options.destination } : {}),
      ...(options.itemIndexedKey
        ? { item: { key: options.itemIndexedKey, title: null } }
        : {}),
    });
  };
  return { isPlainDocument, isProfile, targetOf, customizeTarget };
}

/** Register the Template Workbench view, its commands, and its header actions. */
export function registerTemplateWorkbenchView(
  plugin: Plugin,
  deps: RegistrationDeps,
): void {
  if (!Platform.isDesktopApp) return;
  const { isPlainDocument, isProfile, targetOf, customizeTarget } =
    workbenchTargets(plugin.app, deps);
  plugin.registerView(
    TEMPLATE_WORKBENCH_VIEW_TYPE,
    (leaf) =>
      new TemplateWorkbenchView(leaf, {
        ...deps,
        pluginVersion: plugin.manifest.version,
      }),
  );
  plugin.addCommand({
    id: "customize-profile",
    name: m.template_workbench_open_layout(),
    checkCallback(checking) {
      const target = plugin.app.workspace.getActiveFile();
      if (!isProfile(target)) return false;
      if (!checking)
        startTemplateWorkbenchAction(
          deps,
          "customize",
          customizeTarget(target, { destination: "native" }),
        );
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
          startTemplateWorkbenchAction(
            deps,
            "open-web",
            customizeTarget(target, { destination: "web" }),
          );
        return true;
      },
    });
  plugin.addCommand({
    id: "open-template-workbench-view",
    name: m.template_workbench_open(),
    checkCallback(checking) {
      const active = plugin.app.workspace.getActiveFile();
      const leaf = activeLeafFor(plugin.app, active);
      // A plain document opens without any Profile flow, on the route the
      // file menu and the Markdown header action already take.
      if (isPlainDocument(active)) {
        if (!checking)
          startTemplateWorkbenchAction(
            deps,
            "open-editor",
            openTemplateWorkbench(active, {
              explainUnsupported: false,
              ...(leaf ? { leaf } : {}),
            }),
          );
        return true;
      }
      const target = targetOf(active);
      if (!target) return false;
      if (!checking) {
        const itemIndexedKey =
          active &&
          itemKeyFromFrontmatter(plugin.app.metadataCache.getFileCache(active));
        startTemplateWorkbenchAction(
          deps,
          "open-editor",
          openNativeProfile(target, {
            ...(itemIndexedKey ? { itemIndexedKey } : {}),
            ...(leaf ? { leaf } : {}),
          }),
        );
      }
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
      const options = {
        explainUnsupported: false,
        ...(problem ? { problem } : {}),
      };
      startTemplateWorkbenchAction(
        deps,
        "open-workbench",
        file
          ? openTemplateWorkbench(file, options)
          : openNativeProfile(deps.defaultProfile, options),
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
          view.addAction("file-pen-line", m.template_workbench_open(), () => {
            const file = view.file;
            if (!file) return;
            startTemplateWorkbenchAction(
              deps,
              "open-editor",
              openTemplateWorkbench(file, {
                leaf: view.leaf,
                ...(isPlainDocument(file) ? { explainUnsupported: false } : {}),
              }),
            );
          }),
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
  const { isPlainDocument, isProfile, targetOf, customizeTarget } =
    workbenchTargets(app, deps);
  return (menu, { file, leaf: menuLeaf, itemKey }) => {
    // The Workbench view's own pane menu raises this event too. Inside the
    // view these entries repeat the routes it already offers, so the file
    // menu keeps them for the surfaces that stand outside the Workbench.
    if (menuLeaf?.view instanceof TemplateWorkbenchView) return;
    if (isPlainDocument(file)) {
      const leaf = activeLeafFor(app, file);
      menu.addItem((item) =>
        item
          .setSection(MENU_SECTION.open)
          .setTitle(m.template_workbench_open())
          .setIcon("file-pen-line")
          .onClick(() =>
            startTemplateWorkbenchAction(
              deps,
              "open-editor",
              openTemplateWorkbench(file, {
                explainUnsupported: false,
                ...(leaf ? { leaf } : {}),
              }),
            ),
          ),
      );
      return;
    }
    const target = targetOf(file);
    if (!target) return;
    const options = itemKey ? { itemIndexedKey: itemKey } : {};
    if (isProfile(file))
      menu.addItem((item) =>
        item
          .setSection(MENU_SECTION.open)
          .setTitle(m.template_workbench_open_layout())
          .setIcon("panels-top-left")
          .onClick(() =>
            startTemplateWorkbenchAction(
              deps,
              "customize",
              customizeTarget(target, {
                ...options,
                destination: "native",
              }),
            ),
          ),
      );
    if (deps.webWorkbenchEnabled)
      menu.addItem((item) =>
        item
          .setSection(MENU_SECTION.open)
          .setTitle(m.template_workbench_web_open())
          .setIcon("external-link")
          .onClick(() =>
            startTemplateWorkbenchAction(
              deps,
              "open-web",
              customizeTarget(target, {
                ...options,
                destination: "web",
              }),
            ),
          ),
      );
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.open)
        .setTitle(m.template_workbench_open())
        .setIcon("file-pen-line")
        .onClick(() => {
          const leaf = activeLeafFor(app, file);
          startTemplateWorkbenchAction(
            deps,
            "open-editor",
            openNativeProfile(target, {
              ...options,
              ...(leaf ? { leaf } : {}),
            }),
          );
        }),
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
