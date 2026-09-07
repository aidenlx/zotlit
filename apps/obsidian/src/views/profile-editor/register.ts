import "./style.css";
import { MarkdownView, Notice, Platform, TFile } from "obsidian";
import type { App, Plugin, WorkspaceLeaf } from "obsidian";

import { WorkbenchDocumentController } from "@zotlit/workbench/document";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";
import type { ProfileService } from "@/services/profile/service";

import { profileCustomization } from "./preferences";
import { PROFILE_EDITOR_VIEW_TYPE, ProfileEditorView } from "./view";
import type { ProfileEditorDeps } from "./view";

const logger = getLogger(["views", "profile-editor"]);

type RegistrationDeps = ProfileEditorDeps & {
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
  plugin.addCommand({
    id: "customize-profile",
    name: m.profile_editor_customize(),
    checkCallback(checking) {
      const target = targetOf(plugin.app.workspace.getActiveFile());
      if (!target) return false;
      if (!checking) void customizeProfile(plugin.app, target);
      return true;
    },
  });
  plugin.addCommand({
    id: "open-profile-web-workbench",
    name: m.profile_editor_web_open(),
    checkCallback(checking) {
      const target = targetOf(plugin.app.workspace.getActiveFile());
      if (!target) return false;
      if (!checking) void openWebProfile(plugin.app, target);
      return true;
    },
  });
  plugin.addCommand({
    id: "open-profile-editor",
    name: m.profile_editor_open(),
    checkCallback(checking) {
      const target = targetOf(plugin.app.workspace.getActiveFile());
      if (!target) return false;
      if (!checking) void customizeProfile(plugin.app, target);
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
      menu.addItem((item) =>
        item
          .setSection("zotlit")
          .setTitle(m.profile_editor_customize())
          .setIcon("pencil")
          .onClick(() => void customizeProfile(plugin.app, target, options)),
      );
      menu.addItem((item) =>
        item
          .setSection("zotlit")
          .setTitle(m.profile_editor_web_open())
          .setIcon("external-link")
          .onClick(() => void openWebProfile(plugin.app, target, options)),
      );
      menu.addItem((item) =>
        item
          .setSection("zotlit")
          .setTitle(m.profile_editor_open())
          .setIcon("file-pen-line")
          .onClick(() => void customizeProfile(plugin.app, target, options)),
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
              void openProfileEditor(plugin.app, view.file, {
                leaf: view.leaf,
              });
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

/** The saved preference becomes the launch-sheet input when #998 connects web editing. */
export async function customizeProfile(
  app: App,
  target: TFile | Pick<ProfileService, "defaultDocumentPath" | "getSource">,
  options: { itemIndexedKey?: string } = {},
): Promise<void> {
  logger.debug(
    "Opening Customize in Profile Editor with saved preference {preference}",
    { preference: profileCustomization(app) },
  );
  const file =
    target instanceof TFile
      ? target
      : app.vault.getFileByPath(target.defaultDocumentPath);
  const source = file
    ? await app.vault.cachedRead(file)
    : await (target as Pick<ProfileService, "getSource">).getSource("default");
  if (file) return openProfileEditor(app, file, options);
  if (requiresNative(source)) new Notice(m.profile_editor_native_required());
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
}

function requiresNative(source: string): boolean {
  const manifest = new WorkbenchDocumentController(source, {
    runtime: "native",
  }).document?.manifest;
  return (
    manifest?.language === "eta" ||
    !!manifest?.partials?.some((partial) => partial.language === "eta") ||
    !!manifest?.frontmatter?.some((field) => "js" in field)
  );
}

async function openWebProfile(
  app: App,
  target: TFile | Pick<ProfileService, "defaultDocumentPath" | "getSource">,
  options: { itemIndexedKey?: string } = {},
): Promise<void> {
  const source =
    target instanceof TFile
      ? await app.vault.cachedRead(target)
      : await target.getSource("default");
  if (requiresNative(source)) await customizeProfile(app, target, options);
  else new Notice(m.profile_editor_web_unavailable());
}

/** Every Profile document entry point preserves the selected Literature Note's Item. */
export async function openProfileEditor(
  app: App,
  file: TFile,
  options: {
    leaf?: WorkspaceLeaf;
    itemIndexedKey?: string;
    tab?: "match";
  } = {},
): Promise<void> {
  if (requiresNative(await app.vault.cachedRead(file)))
    new Notice(m.profile_editor_native_required());
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
}
