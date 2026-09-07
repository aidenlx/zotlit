// The Customize flow every entry action shares: which template and paper a
// launch carries, the launch sheet that approves it, the Local Server it turns
// on when it has to, and the browser tab it finally opens.
//
// The sheet itself is a port (`confirmLaunch`), so the decision this module
// makes is testable apart from the modal that renders it.

import type { App } from "obsidian";

import { DOCS_SITE_URL } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import { DEFAULT_PROFILE, isProfileId } from "@/lib/profile-stamp";
import type { ProfileSelector } from "@/lib/profile-stamp";
import type { LocalServerService } from "@/services/local-server/service";
import { itemKeyFromFrontmatter } from "@/services/note-index/service";
import type { ProfileService } from "@/services/profile/service";
import type { SettingsService } from "@/services/settings/service";

import type { DeviceStorage } from "./installation";
import type { LocalBridgeService } from "./service";
import type { SelectedItemIdentity } from "./sessions";
import { unsupportedProfileReason } from "./unsupported";

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

/** What an entry action asks Customize to open. */
export interface CustomizeRequest {
  readonly profileId: string;
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
  localServer: Pick<LocalServerService, "effectivePort" | "on">;
  bridge: Pick<LocalBridgeService, "launchUrl">;
  confirmLaunch: ConfirmLaunch;
  openExternal: (url: string) => void;
}

/** Open the web Template Workbench on one template, or say why it stays shut. */
export type CustomizeAction = (request: CustomizeRequest) => Promise<void>;

export function createCustomize(deps: CustomizeDeps): CustomizeAction {
  return async (request) => {
    await deps.profile.ready;
    const documentPath = profileDocumentPath(deps, request.profileId);
    const reason = unsupportedProfileReason(
      await deps.profile.getSource(profileSelector(request.profileId)),
    );
    if (reason !== null) {
      logger.debug("Customize kept the Profile in Obsidian", { reason });
      await openInObsidian(deps.app, documentPath);
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
        await whenListening(deps.localServer);
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

/** The listener's port once it binds, or `null` once the wait runs out. */
function whenListening(
  localServer: Pick<LocalServerService, "effectivePort" | "on">,
): Promise<number | null> {
  if (localServer.effectivePort !== null)
    return Promise.resolve(localServer.effectivePort);
  const { promise, resolve } = Promise.withResolvers<number | null>();
  const timer = window.setTimeout(() => {
    unsubscribe();
    resolve(null);
  }, SERVER_START_TIMEOUT_MS);
  const unsubscribe = localServer.on("listening", (port) => {
    if (port === null) return;
    window.clearTimeout(timer);
    unsubscribe();
    resolve(port);
  });
  return promise;
}

/** The paper the active Literature Note is about, or `null` for a Sample Item. */
function activeNoteItem(app: App): SelectedItemIdentity | null {
  const file = app.workspace.getActiveFile();
  if (!file) return null;
  const key = itemKeyFromFrontmatter(app.metadataCache.getFileCache(file));
  return key === null ? null : { key, title: file.basename };
}

function profileSelector(profileId: string): ProfileSelector {
  return isProfileId(profileId) ? profileId : DEFAULT_PROFILE;
}

function templateName(deps: CustomizeDeps, profileId: string): string {
  if (profileId === DEFAULT_PROFILE) return m.settings_profile_default_name();
  return (
    deps.profile.profiles.find(({ id }) => id === profileId)?.label ?? profileId
  );
}

function profileDocumentPath(
  deps: CustomizeDeps,
  profileId: string,
): string | null {
  if (profileId === DEFAULT_PROFILE) return deps.profile.defaultDocumentPath;
  return deps.profile.profiles.find(({ id }) => id === profileId)?.path ?? null;
}

async function openInObsidian(app: App, path: string | null): Promise<void> {
  const file = path === null ? null : app.vault.getFileByPath(path);
  if (file) await app.workspace.getLeaf(true).openFile(file);
}
