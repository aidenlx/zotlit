// Shared progress/success/failure toast for Language Pack downloads, used by
// the startup consent notice, the background refresh, and both setting tabs.

import { LanguagePackSchemaVersionError } from "@zotlit/obsidian-i18n";
import type { LanguagePackRestartNotice } from "@zotlit/obsidian-i18n";

import type { LanguagePackLifecycle } from "@/lib/i18n";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import * as toast from "@/lib/toast";

const logger = getLogger("i18n");

/** The restart notice matters more than a transient toast, so it lingers. */
const RESTART_NOTICE_DURATION = 10_000;

/**
 * Surfaces an in-flight Language Pack download as a loading toast that resolves
 * into the restart notice or a failure notice.
 *
 * @param download the pending download — a startup refresh or an `install()` call.
 */
export async function toastLanguagePackDownload(
  download: Promise<LanguagePackRestartNotice>,
): Promise<void> {
  try {
    await toast.promise(download, {
      loading: m.notice_language_pack_downloading(),
      success: () => m.notice_language_pack_restart(),
      // A pack from a newer lineage than this build reads is a plugin-version
      // problem, not a transport one, so it names the fix instead of the error.
      error: (message, error) =>
        error instanceof LanguagePackSchemaVersionError && error.updateNeeded
          ? m.notice_language_pack_update_needed()
          : m.notice_language_pack_download_failed({ message }),
      successDuration: RESTART_NOTICE_DURATION,
      swallowError: false,
    });
  } catch (error) {
    logger.debug("Language Pack download toast reported a failure", { error });
  }
}

/** The shared trigger for every "Install" button and the startup notice. */
export function installLanguagePack(lifecycle: LanguagePackLifecycle): void {
  void toastLanguagePackDownload(lifecycle.install());
}
