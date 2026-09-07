import "./style.css";
import { MarkdownView, Platform, TFile } from "obsidian";
import type { App, Plugin, WorkspaceLeaf } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";
import type { ProfileService } from "@/services/profile/service";

import { PROFILE_EDITOR_VIEW_TYPE, ProfileEditorView } from "./view";
import type { ProfileEditorDeps } from "./view";

type RegistrationDeps = ProfileEditorDeps & {
  profile: Pick<ProfileService, "profiles" | "defaultDocumentPath">;
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
    (leaf) => new ProfileEditorView(leaf, deps),
  );
  plugin.addCommand({
    id: "open-profile-editor",
    name: m.profile_editor_open(),
    checkCallback(checking) {
      const file = plugin.app.workspace.getActiveFile();
      if (!isProfile(file)) return false;
      if (!checking) void openProfileEditor(plugin.app, file);
      return true;
    },
  });
  plugin.registerEvent(
    plugin.app.workspace.on("file-menu", (menu, file) => {
      if (!(file instanceof TFile) || !isProfile(file)) return;
      menu.addItem((item) =>
        item
          .setSection("zotlit")
          .setTitle(m.profile_editor_open())
          .setIcon("file-pen-line")
          .onClick(() => void openProfileEditor(plugin.app, file)),
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

/** Every Profile document entry point preserves the selected Literature Note's Item. */
export async function openProfileEditor(
  app: App,
  file: TFile,
  options: { leaf?: WorkspaceLeaf; itemIndexedKey?: string } = {},
): Promise<void> {
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
    state: { file: file.path, ...(itemIndexedKey ? { itemIndexedKey } : {}) },
    active: true,
  });
  await app.workspace.revealLeaf(leaf);
}
