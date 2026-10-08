// Install and uninstall controls for one device-wide Managed Binary.

import type { Setting, SettingDefinition } from "obsidian";

import * as toast from "@/lib/toast";
import type {
  ManagedBinaryFailure,
  ManagedBinaryStatus,
} from "@/services/managed-binary/service";

import type { ManagedBinaryActions, SettingsKey } from "./context";

/** The words one binary's row carries, already in the user's language. */
export interface ManagedBinaryCopy {
  id: string;
  name: string;
  /** What the binary is; the status sentence follows it. */
  desc: string;
  status: {
    absent: string;
    installing: string;
    installed: (version: string) => string;
    downloadFailed: (detail: string) => string;
    hashMismatch: string;
    initFailed: (detail: string) => string;
  };
  actions: {
    install: string;
    installing: string;
    retry: string;
    uninstall: string;
  };
  notices: {
    downloading: string;
    installed: string;
    installFailed: string;
    removed: string;
    removeFailed: string;
  };
}

/**
 * The binary row: what the binary is, where it stands, and the one action that
 * moves it. The download is device-wide, so uninstall reaches every vault.
 */
export function managedBinaryDefinition(
  binary: ManagedBinaryActions,
  copy: ManagedBinaryCopy,
): SettingDefinition<SettingsKey> {
  const status = binary.getStatus();
  return {
    id: copy.id,
    name: copy.name,
    desc: `${copy.desc} ${statusSentence(status, copy)}`,
    render: (setting) => renderActions(setting, status, { binary, copy }),
  };
}

/** One sentence per arm, so the row never derives its own combination of flags. */
function statusSentence(
  status: ManagedBinaryStatus,
  copy: ManagedBinaryCopy,
): string {
  switch (status.kind) {
    case "installed":
      return copy.status.installed(status.version);
    case "installing":
      return copy.status.installing;
    case "failed":
      return failureSentence(status.failure, copy);
    default:
      return copy.status.absent;
  }
}

function failureSentence(
  failure: ManagedBinaryFailure,
  copy: ManagedBinaryCopy,
): string {
  switch (failure.code) {
    case "download-failed":
      return copy.status.downloadFailed(failure.detail);
    case "hash-mismatch":
      return copy.status.hashMismatch;
    case "init-failed":
      return copy.status.initFailed(failure.detail);
  }
}

function renderActions(
  setting: Setting,
  status: ManagedBinaryStatus,
  { binary, copy }: { binary: ManagedBinaryActions; copy: ManagedBinaryCopy },
): void {
  if (status.kind === "installed") {
    setting.addButton((btn) =>
      btn
        .setButtonText(copy.actions.uninstall)
        .setWarning()
        .onClick(() => {
          // See the blur comment in resources.ts: the reconciler skips
          // re-rendering the row that holds document.activeElement.
          btn.buttonEl.blur();
          void toast.promise(binary.uninstall(), {
            success: copy.notices.removed,
            error: copy.notices.removeFailed,
          });
        }),
    );
    return;
  }

  setting.addButton((btn) =>
    btn
      .setButtonText(installLabel(status, copy))
      .setCta()
      .setDisabled(status.kind === "installing")
      .onClick(() => {
        btn.buttonEl.blur();
        void toast.promise(binary.install(), {
          loading: copy.notices.downloading,
          success: copy.notices.installed,
          error: copy.notices.installFailed,
        });
      }),
  );
}

function installLabel(
  status: ManagedBinaryStatus,
  copy: ManagedBinaryCopy,
): string {
  switch (status.kind) {
    case "installing":
      return copy.actions.installing;
    case "failed":
      return copy.actions.retry;
    default:
      return copy.actions.install;
  }
}
