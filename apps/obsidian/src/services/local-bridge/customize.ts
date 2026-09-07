// The Customize flow every entry action shares: which template and paper a
// launch carries, the launch sheet that approves it, the Local Server it turns
// on when it has to, and the browser tab it finally opens.
//
// The sheet itself is a port (`confirmLaunch`), so the decision this module
// makes is testable apart from the modal that renders it.

import type { App, TFile } from "obsidian";

import { DOCS_SITE_URL } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import { DEFAULT_PROFILE } from "@/lib/profile-stamp";
import type { ProfileSelector } from "@/lib/profile-stamp";
import type { LocalServerService } from "@/services/local-server/service";
import { itemKeyFromFrontmatter } from "@/services/note-index/service";
import type { ProfileService } from "@/services/profile/service";
import type { SettingsService } from "@/services/settings/service";
import type { TemplateService } from "@/services/template/service";

import type { DeviceStorage } from "./installation";
import type { LocalBridgeService } from "./service";
import type { SelectedItemIdentity } from "./sessions";
import { unsupportedProfileSourceReason } from "./unsupported";

const logger = getLogger("local-bridge");

/**
 * Per-device, never synced: the researcher who ticked "Do not ask again" on
 * one computer still meets the sheet on the next one.
 *
 * @see `apps/obsidian/policies/local-storage.md`
 */
const LAUNCH_SHEET_KEY = "zotlit-workbench-launch-approved";

/** How long a launch waits for the listener it just turned on. */
const SERVER_START_TIMEOUT_MS = 10_000;

/** `true` once "Do not ask again" was ticked on this device. */
export function launchSheetSkipped(store: DeviceStorage): boolean {
  return store.loadLocalStorage(LAUNCH_SHEET_KEY) === "1";
}

/** Tick or clear the per-device skip; clearing brings the sheet back. */
export function setLaunchSheetSkipped(
  store: DeviceStorage,
  skipped: boolean,
): void {
  store.saveLocalStorage(LAUNCH_SHEET_KEY, skipped ? "1" : null);
}

/**
 * Whether the web Template Workbench is offered at all: the toggle under the
 * Local server. Every entry that leads to {@link CustomizeAction} reads it, so
 * off means no door rather than a door that fails.
 */
export function workbenchEnabled(
  settings: Pick<SettingsService, "current">,
): boolean {
  return settings.current?.["server.workbench"] ?? false;
}

/** What an entry action asks Customize to open. */
export interface CustomizeRequest {
  readonly profileId: ProfileSelector;
  /**
   * The paper to show. Leave it out and the flow takes the active Literature
   * Note's paper, or a Sample Item when no Literature Note is active.
   */
  readonly item?: SelectedItemIdentity | null;
}

/** What the launch sheet names, so the shell renders what the flow decided. */
export interface LaunchSheetDetails {
  /** The website's host, as the plugin will open it. */
  readonly website: string;
  readonly vault: string;
  /** The paper's name, or `null` for a Sample Item. */
  readonly item: string | null;
  readonly template: string;
  /** The sheet leads with turning the Local Server on. */
  readonly turnServerOn: boolean;
}

/** What the researcher answered on the launch sheet. */
export interface LaunchConsent {
  readonly doNotAskAgain: boolean;
}

/** The sheet as the flow uses it: `null` means Cancel, and nothing happens. */
export type ConfirmLaunch = (
  details: LaunchSheetDetails,
) => Promise<LaunchConsent | null>;

export interface CustomizeDeps {
  app: App;
  settings: Pick<SettingsService, "current" | "update">;
  profile: Pick<
    ProfileService,
    "ready" | "profiles" | "defaultDocumentPath" | "getSource"
  >;
  template: Pick<TemplateService, "ready" | "exportLiteratureNotePackSource">;
  localServer: Pick<LocalServerService, "effectivePort" | "on">;
  bridge: Pick<LocalBridgeService, "launchUrl">;
  /** This build's version, which a Profile's `minAppVersion` is read against. */
  pluginVersion: string;
  confirmLaunch: ConfirmLaunch;
  openExternal: (url: string) => void;
}

/** Open the web Template Workbench on one template, or say why it stays shut. */
export type CustomizeAction = (request: CustomizeRequest) => Promise<void>;

export function createCustomize(deps: CustomizeDeps): CustomizeAction {
  return async (request) => {
    await deps.profile.ready;
    const source = await deps.profile.getSource(request.profileId);
    const reason = unsupportedProfileSourceReason(
      await withDependencies(deps, source),
      deps.pluginVersion,
    );
    if (reason !== null) {
      logger.debug("Customize kept the Profile in Obsidian", { reason });
      await openInObsidian(
        deps.app,
        profileDocumentPath(deps, request.profileId),
      );
      new BaseNotice(m.notice_workbench_unsupported_profile());
      return;
    }

    const item =
      request.item === undefined ? activeNoteItem(deps.app) : request.item;
    const turnServerOn = deps.settings.current?.["server.enabled"] !== true;
    if (turnServerOn || !launchSheetSkipped(deps.app)) {
      const consent = await deps.confirmLaunch({
        website: new URL(DOCS_SITE_URL).host,
        vault: deps.app.vault.getName(),
        item: item?.title ?? item?.key ?? null,
        template: templateName(deps, request.profileId),
        turnServerOn,
      });
      if (consent === null) return;
      if (turnServerOn) {
        deps.settings.update({ "server.enabled": true });
        if (!(await whenListening(deps.localServer))) {
          logger.warn("Customize gave up waiting for the local server");
          new BaseNotice(m.notice_workbench_server_failed());
          return;
        }
      }
      if (consent.doNotAskAgain) setLaunchSheetSkipped(deps.app, true);
    }

    const url = deps.bridge.launchUrl({ profileId: request.profileId, item });
    if (url === null) {
      new BaseNotice(m.notice_workbench_unavailable());
      return;
    }
    deps.openExternal(url);
  };
}

/**
 * The Profile document with the partials it calls bundled in, so the check
 * sees a folder partial written in Eta the way the page would. A document that
 * cannot be bundled is checked as written.
 */
async function withDependencies(
  deps: Pick<CustomizeDeps, "template">,
  source: string,
): Promise<string> {
  await deps.template.ready;
  try {
    return await deps.template.exportLiteratureNotePackSource(source, {
      onMissingPartial: () => {},
    });
  } catch {
    return source;
  }
}

/** `true` once the listener binds, `false` once the wait runs out. */
function whenListening(
  localServer: Pick<LocalServerService, "effectivePort" | "on">,
): Promise<boolean> {
  if (localServer.effectivePort !== null) return Promise.resolve(true);
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const timer = window.setTimeout(() => {
    unsubscribe();
    resolve(false);
  }, SERVER_START_TIMEOUT_MS);
  const unsubscribe = localServer.on("listening", (port) => {
    if (port === null) return;
    window.clearTimeout(timer);
    unsubscribe();
    resolve(true);
  });
  return promise;
}

/** The paper the active Literature Note is about, or `null` for a Sample Item. */
function activeNoteItem(app: App): SelectedItemIdentity | null {
  const file = app.workspace.getActiveFile();
  return file ? noteItem(app, file) : null;
}

/** The paper a Literature Note is about, or `null` for any other note. */
export function noteItem(app: App, file: TFile): SelectedItemIdentity | null {
  const key = itemKeyFromFrontmatter(app.metadataCache.getFileCache(file));
  return key === null ? null : { key, title: file.basename };
}

function templateName(deps: CustomizeDeps, profileId: ProfileSelector): string {
  if (profileId === DEFAULT_PROFILE) return m.settings_profile_default_name();
  return profileEntry(deps, profileId)?.label ?? profileId;
}

function profileDocumentPath(
  deps: CustomizeDeps,
  profileId: ProfileSelector,
): string | null {
  if (profileId === DEFAULT_PROFILE) return deps.profile.defaultDocumentPath;
  return profileEntry(deps, profileId)?.path ?? null;
}

function profileEntry(deps: CustomizeDeps, profileId: ProfileSelector) {
  return deps.profile.profiles.find(({ id }) => id === profileId);
}

async function openInObsidian(app: App, path: string | null): Promise<void> {
  const file = path === null ? null : app.vault.getFileByPath(path);
  if (file) await app.workspace.getLeaf(true).openFile(file);
}
