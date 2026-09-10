import "./style.css";
import { MarkdownView, Platform, TFile } from "obsidian";
import type { App, Plugin, WorkspaceLeaf } from "obsidian";

import { WorkbenchDocumentController } from "@zotlit/workbench/document";

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import type { CustomizeAction } from "@/services/local-bridge/customize";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";
import type { ProfileService } from "@/services/profile/service";
import {
  findWorkbenchLayout,
  openWorkbenchLayout,
} from "@/views/note-preview/register";

import { runTemplateWorkbenchAction } from "./actions";
import { templateDocumentKind } from "./document-kind";
import { TEMPLATE_WORKBENCH_VIEW_TYPE, TemplateWorkbenchView } from "./view";
import type { TemplateWorkbenchDeps } from "./view";

type RegistrationDeps = TemplateWorkbenchDeps & {
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
export function registerTemplateWorkbenchView(
  plugin: Plugin,
  deps: RegistrationDeps,
): void {
  if (!Platform.isDesktopApp) return;
  /** A plain document — the Citation Template or a Shared Partial — which the
   *  view opens on its own tab without any Profile flow. */
  const isPlainDocument = (file: TFile | null): file is TFile =>
    file !== null && templateDocumentKind(file) !== "profile";
  const isProfile = (file: TFile | null): file is TFile =>
    file !== null &&
    file.extension === "md" &&
    (file.path === deps.profile.defaultDocumentPath ||
      deps.profile.profiles.some((profile) => profile.path === file.path) ||
      file.basename.startsWith("zotlit-profile."));
  plugin.registerView(
    TEMPLATE_WORKBENCH_VIEW_TYPE,
    (leaf) =>
      new TemplateWorkbenchView(leaf, {
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
    if (!profileId)
      return openNativeProfile(plugin.app, target, {
        ...options,
        customize: true,
      });
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
    name: m.template_workbench_customize(),
    checkCallback(checking) {
      const target = plugin.app.workspace.getActiveFile();
      if (!isProfile(target)) return false;
      if (!checking)
        void runTemplateWorkbenchAction("customize", () =>
          customizeTarget(target),
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
          void runTemplateWorkbenchAction("open-web", () =>
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
      // A plain document opens without any Profile flow, on the route the
      // file menu and the Markdown header action already take.
      if (isPlainDocument(active)) {
        if (!checking)
          void runTemplateWorkbenchAction("open-editor", () =>
            openTemplateWorkbench(plugin.app, active, {
              explainUnsupported: false,
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
        void runTemplateWorkbenchAction("customize", () =>
          customizeTarget(target, {
            ...(itemIndexedKey ? { itemIndexedKey } : {}),
            destination: "native",
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
    plugin.app.workspace.on("zotlit:open-template-workbench", (document) => {
      const file = document ? plugin.app.vault.getFileByPath(document) : null;
      void runTemplateWorkbenchAction("open-workbench", () =>
        file
          ? openTemplateWorkbench(plugin.app, file, {
              explainUnsupported: false,
            })
          : openNativeProfile(plugin.app, deps.profile, {
              explainUnsupported: false,
            }),
      );
    }),
  );
  plugin.registerEvent(
    plugin.app.workspace.on("file-menu", (menu, file) => {
      if (!(file instanceof TFile)) return;
      if (isPlainDocument(file)) {
        menu.addItem((item) =>
          item
            .setSection("zotlit")
            .setTitle(m.template_workbench_open())
            .setIcon("file-pen-line")
            .onClick(
              () =>
                void runTemplateWorkbenchAction("open-editor", () =>
                  openTemplateWorkbench(plugin.app, file, {
                    explainUnsupported: false,
                  }),
                ),
            ),
        );
        return;
      }
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
            .setTitle(m.template_workbench_customize())
            .setIcon("pencil")
            .onClick(
              () =>
                void runTemplateWorkbenchAction("customize", () =>
                  customizeTarget(target, options),
                ),
            ),
        );
      if (deps.webWorkbenchEnabled)
        menu.addItem((item) =>
          item
            .setSection("zotlit")
            .setTitle(m.template_workbench_web_open())
            .setIcon("external-link")
            .onClick(
              () =>
                void runTemplateWorkbenchAction("open-web", () =>
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
          .setTitle(m.template_workbench_open())
          .setIcon("file-pen-line")
          .onClick(
            () =>
              void runTemplateWorkbenchAction("customize", () =>
                customizeTarget(target, { ...options, destination: "native" }),
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
            void runTemplateWorkbenchAction("open-editor", () =>
              isPlainDocument(file)
                ? openTemplateWorkbench(plugin.app, file, {
                    explainUnsupported: false,
                  })
                : customizeTarget(file, { destination: "native" }),
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
    await openTemplateWorkbench(app, file, {
      ...options,
      ...(target instanceof TFile ? {} : { defaultProfile: true }),
    });
    return;
  }
  if (options.explainUnsupported !== false && requiresNative(source))
    new BaseNotice(m.template_workbench_native_required());
  const { itemIndexedKey } = options;
  const workbench = options.customize
    ? await findWorkbenchLayout(app, { file: null, defaultProfile: true })
    : null;
  if (workbench?.file) {
    await openTemplateWorkbench(app, workbench.file, {
      ...options,
      leaf: workbench.leaf,
      defaultProfile: true,
    });
    return;
  }
  const leaf =
    workbench?.leaf ??
    app.workspace
      .getLeavesOfType(TEMPLATE_WORKBENCH_VIEW_TYPE)
      .find(
        (entry) =>
          entry.view instanceof TemplateWorkbenchView &&
          entry.view.isDefaultDraft,
      ) ??
    app.workspace.getLeaf("tab");
  await leaf.setViewState({
    type: TEMPLATE_WORKBENCH_VIEW_TYPE,
    state: {
      defaultDraft: true,
      file: null,
      ...(itemIndexedKey ? { itemIndexedKey } : {}),
    },
    active: true,
  });
  await app.workspace.revealLeaf(leaf);
  leaf.getContainer().focus();
  if (options.customize && leaf.view instanceof TemplateWorkbenchView)
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

/** Open a Profile document with an explicitly supplied launch Item. */
export async function openTemplateWorkbench(
  app: App,
  file: TFile,
  options: {
    leaf?: WorkspaceLeaf;
    itemIndexedKey?: string;
    tab?: "match";
    explainUnsupported?: boolean;
    customize?: boolean;
    defaultProfile?: boolean;
  } = {},
): Promise<void> {
  if (
    options.explainUnsupported !== false &&
    requiresNative(await app.vault.cachedRead(file))
  )
    new BaseNotice(m.template_workbench_native_required());
  const { itemIndexedKey } = options;
  const workbench = options.customize
    ? await findWorkbenchLayout(app, {
        file: file.path,
        defaultProfile: options.defaultProfile ?? false,
      })
    : null;
  const leaf =
    workbench?.leaf ??
    options.leaf ??
    app.workspace
      .getLeavesOfType(TEMPLATE_WORKBENCH_VIEW_TYPE)
      .find(
        (entry) =>
          entry.view instanceof TemplateWorkbenchView &&
          entry.view.file?.path === file.path,
      ) ??
    app.workspace.getLeaf("tab");
  await leaf.setViewState({
    type: TEMPLATE_WORKBENCH_VIEW_TYPE,
    state: {
      file: file.path,
      ...(workbench && !workbench.file ? { defaultDraft: false } : {}),
      ...(itemIndexedKey ? { itemIndexedKey } : {}),
      ...(options.tab ? { tab: options.tab, advanced: false } : {}),
    },
    active: true,
  });
  await app.workspace.revealLeaf(leaf);
  leaf.getContainer().focus();
  if (options.customize && leaf.view instanceof TemplateWorkbenchView)
    await openWorkbenchLayout(app, leaf.view);
}
