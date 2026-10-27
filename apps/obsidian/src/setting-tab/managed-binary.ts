// Install and uninstall controls for one device-wide Managed Binary.

import { Effect } from "effect";
import type { Setting, SettingDefinition } from "obsidian";

import { reportOutcome, withProgress } from "@/lib/notifier";
import type {
  ManagedBinaryApi,
  ManagedBinaryFailure,
  ManagedBinaryStatus,
} from "@/services/managed-binary/service";

import type { SettingsKey } from "./context";
import type { SettingTabEnv, SettingTabShape } from "./effect-tab";

/** The binary's service as the row reads it: its tag, or a fake in a test. */
export type ManagedBinaryTag = Effect.Effect<
  Pick<
    ManagedBinaryApi<Disposable | AsyncDisposable>,
    "getStatus" | "install" | "uninstall"
  >,
  never,
  SettingTabEnv
>;

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
  tab: SettingTabShape,
  binary: ManagedBinaryTag,
  copy: ManagedBinaryCopy,
): SettingDefinition<SettingsKey> {
  const status = tab.sync(Effect.flatMap(binary, (api) => api.getStatus));
  return {
    id: copy.id,
    name: copy.name,
    desc: `${copy.desc} ${statusSentence(status, copy)}`,
    render: (setting) => renderActions(setting, status, { tab, binary, copy }),
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
  {
    tab,
    binary,
    copy,
  }: {
    tab: SettingTabShape;
    binary: ManagedBinaryTag;
    copy: ManagedBinaryCopy;
  },
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
          void tab.run(
            reportOutcome(
              Effect.flatMap(binary, (api) => api.uninstall),
              {
                success: () => copy.notices.removed,
                error: () => copy.notices.removeFailed,
              },
            ),
          );
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
        // The progress notice reports a failure, so the run drops it.
        void tab.run(installBinary(binary, copy).pipe(Effect.ignore));
      }),
  );
}

/**
 * Install `binary` behind a progress notice in `copy`'s words. It fails with
 * the install's own error, which the notice names.
 */
export const installBinary = <R>(
  binary: Effect.Effect<
    Pick<ManagedBinaryApi<Disposable | AsyncDisposable>, "install">,
    never,
    R
  >,
  copy: ManagedBinaryCopy,
) =>
  withProgress(
    Effect.flatMap(binary, (api) => api.install),
    {
      loading: copy.notices.downloading,
      success: copy.notices.installed,
      error: copy.notices.installFailed,
    },
  );

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
