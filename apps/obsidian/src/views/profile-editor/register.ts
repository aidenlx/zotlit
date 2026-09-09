import "./style.css";
import { MarkdownView, Platform, TFile } from "obsidian";
import type { App, Plugin, WorkspaceLeaf } from "obsidian";

import { WorkbenchDocumentController } from "@zotlit/workbench/document";

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import type { CustomizeAction } from "@/services/local-bridge/customize";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";
import type { ProfileService } from "@/services/profile/service";
import { openProfileWorkbench } from "@/views/note-preview/register";

import { runProfileEditorAction } from "./actions";
import { PROFILE_EDITOR_VIEW_TYPE, ProfileEditorView } from "./view";
import type { ProfileEditorDeps } from "./view";

type RegistrationDeps = ProfileEditorDeps & {
  webWorkbenchEnabled: boolean;
  customize: CustomizeAction;
  profile: Pick<
    ProfileService,
    | "profiles"
    | "defaultDocumentPath"
    | "getSource"
    | "profileOf"
    | "materializeDefault"
    | "restoreDefault"
  >;
};
export function registerProfileEditor(
  plugin: Plugin,
  deps: RegistrationDeps,
): void {
  if (!Platform.isDesktopApp) return;
  const isProfile = (file: TFile | null): file is TFile =>
    file !== null &&
    file.extension === "md" &&
    (file.path === deps.profile.defaultDocumentPath ||
      deps.profile.profiles.some((profile) => profile.path === file.path) ||
      file.basename.startsWith("zotlit-profile."));
  plugin.registerView(
    PROFILE_EDITOR_VIEW_TYPE,
    (leaf) =>
      new ProfileEditorView(leaf, {
        ...deps,
        pluginVersion: plugin.manifest.version,
      }),
  );
  const targetOf = (file: TFile | null) => {
    if (isProfile(file)) return file;
    if (
      !file ||
      !itemKeyFromFrontmatter(plugin.app.metadataCache.getFileCache(file))
    )
      return null;
    const resolved = deps.profile.profileOf(file);
    if (!resolved.ok) return null;
    if (resolved.profile.selector === "default") return deps.profile;
    const profile = deps.profile.profiles.find(
      (entry) => entry.id === resolved.profile.selector,
    );
    return profile ? plugin.app.vault.getFileByPath(profile.path) : null;
  };
  const customizeTarget = (
    target: TFile | RegistrationDeps["profile"],
    options: { itemIndexedKey?: string; destination?: "web" | "native" } = {},
  ) => {
    const profileId =
      target instanceof TFile
        ? target.path === deps.profile.defaultDocumentPath
          ? "default"
          : deps.profile.profiles.find(
              (profile) => profile.path === target.path,
            )?.id
        : "default";
    if (!profileId) return openNativeProfile(plugin.app, target, options);
    return deps.customize({
      profileId,
      ...(options.destination ? { destination: options.destination } : {}),
      ...(options.itemIndexedKey
        ? { item: { key: options.itemIndexedKey, title: null } }
        : {}),
    });
  };
  plugin.addCommand({
    id: "customize-profile",
    name: m.profile_editor_customize(),
    checkCallback(checking) {
      const target = plugin.app.workspace.getActiveFile();
      if (!isProfile(target)) return false;
      if (!checking)
        void runProfileEditorAction("customize", () => customizeTarget(target));
      return true;
    },
  });
  if (deps.webWorkbenchEnabled)
    plugin.addCommand({
      id: "open-profile-web-workbench",
      name: m.profile_editor_web_open(),
      checkCallback(checking) {
        const target = targetOf(plugin.app.workspace.getActiveFile());
        if (!target) return false;
        if (!checking)
          void runProfileEditorAction("open-web", () =>
            customizeTarget(target, { destination: "web" }),
          );
        return true;
      },
    });
  plugin.addCommand({
    id: "open-profile-editor",
    name: m.profile_editor_open(),
    checkCallback(checking) {
      const target = targetOf(plugin.app.workspace.getActiveFile());
      if (!target) return false;
      if (!checking)
        void runProfileEditorAction("customize", () =>
          openNativeProfile(plugin.app, target),
        );
      return true;
    },
  });
  plugin.registerEvent(
    plugin.app.workspace.on("file-menu", (menu, file) => {
      if (!(file instanceof TFile)) return;
      const target = targetOf(file);
      if (!target) return;
      const itemIndexedKey = itemKeyFromFrontmatter(
        plugin.app.metadataCache.getFileCache(file),
      );
      const options = itemIndexedKey ? { itemIndexedKey } : {};
      if (isProfile(file))
        menu.addItem((item) =>
          item
            .setSection("zotlit")
            .setTitle(m.profile_editor_customize())
            .setIcon("pencil")
            .onClick(
              () =>
                void runProfileEditorAction("customize", () =>
                  customizeTarget(target, options),
                ),
            ),
        );
      if (deps.webWorkbenchEnabled)
        menu.addItem((item) =>
          item
            .setSection("zotlit")
            .setTitle(m.profile_editor_web_open())
            .setIcon("external-link")
            .onClick(
              () =>
                void runProfileEditorAction("open-web", () =>
                  customizeTarget(target, {
                    ...options,
                    destination: "web",
                  }),
                ),
            ),
        );
      menu.addItem((item) =>
        item
          .setSection("zotlit")
          .setTitle(m.profile_editor_open())
          .setIcon("file-pen-line")
          .onClick(
            () =>
              void runProfileEditorAction("customize", () =>
                openNativeProfile(plugin.app, target, options),
              ),
          ),
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
            view instanceof MarkdownView && isProfile(view.file),
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
          view.addAction("file-pen-line", m.profile_editor_open(), () => {
            if (view.file)
              void runProfileEditorAction("open-editor", () =>
                openProfileEditor(plugin.app, view.file!, {
                  leaf: view.leaf,
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

/** Open a Profile file or the built-in Default draft in the native editor. */
export async function openNativeProfile(
  app: App,
  target: TFile | Pick<ProfileService, "defaultDocumentPath" | "getSource">,
  options: {
    itemIndexedKey?: string;
    explainUnsupported?: boolean;
    customize?: boolean;
  } = {},
): Promise<void> {
  const file =
    target instanceof TFile
      ? target
      : app.vault.getFileByPath(target.defaultDocumentPath);
  const source = file
    ? await app.vault.cachedRead(file)
    : await (target as Pick<ProfileService, "getSource">).getSource("default");
  if (file) {
    await openProfileEditor(app, file, options);
    return;
  }
  if (options.explainUnsupported !== false && requiresNative(source))
    new BaseNotice(m.profile_editor_native_required());
  const active = app.workspace.getActiveFile();
  const itemIndexedKey =
    options.itemIndexedKey ??
    (active
      ? itemKeyFromFrontmatter(app.metadataCache.getFileCache(active))
      : null);
  const leaf =
    app.workspace
      .getLeavesOfType(PROFILE_EDITOR_VIEW_TYPE)
      .find(
        (entry) =>
          entry.view instanceof ProfileEditorView && entry.view.isDefaultDraft,
      ) ?? app.workspace.getLeaf("tab");
  await leaf.setViewState({
    type: PROFILE_EDITOR_VIEW_TYPE,
    state: {
      defaultDraft: true,
      file: null,
      ...(itemIndexedKey ? { itemIndexedKey } : {}),
    },
    active: true,
  });
  await app.workspace.revealLeaf(leaf);
  leaf.getContainer().focus();
  if (options.customize && leaf.view instanceof ProfileEditorView)
    await leaf.view.customizeDefault();
}

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

/** Every Profile document entry point preserves the selected Literature Note's Item. */
export async function openProfileEditor(
  app: App,
  file: TFile,
  options: {
    leaf?: WorkspaceLeaf;
    itemIndexedKey?: string;
    tab?: "match";
    explainUnsupported?: boolean;
    customize?: boolean;
  } = {},
): Promise<void> {
  if (
    options.explainUnsupported !== false &&
    requiresNative(await app.vault.cachedRead(file))
  )
    new BaseNotice(m.profile_editor_native_required());
  const active = app.workspace.getActiveFile();
  const itemIndexedKey =
    options.itemIndexedKey ??
    (active
      ? itemKeyFromFrontmatter(app.metadataCache.getFileCache(active))
      : null);
  const leaf =
    options.leaf ??
    app.workspace
      .getLeavesOfType(PROFILE_EDITOR_VIEW_TYPE)
      .find(
        (entry) =>
          entry.view instanceof ProfileEditorView &&
          entry.view.file?.path === file.path,
      ) ??
    app.workspace.getLeaf("tab");
  await leaf.setViewState({
    type: PROFILE_EDITOR_VIEW_TYPE,
    state: {
      file: file.path,
      ...(itemIndexedKey ? { itemIndexedKey } : {}),
      ...(options.tab ? { tab: options.tab, advanced: false } : {}),
    },
    active: true,
  });
  await app.workspace.revealLeaf(leaf);
  leaf.getContainer().focus();
  if (options.customize && leaf.view instanceof ProfileEditorView)
    await openProfileWorkbench(app, leaf.view);
}
