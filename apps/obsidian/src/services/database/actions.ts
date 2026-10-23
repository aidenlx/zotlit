import type { Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import * as toast from "@/lib/toast";
import type { PlainZoteroReads } from "@/services/zotero-reads/plain";
import { DbUnavailable } from "@/services/zotero-reads/rpc";

/**
 * Register the manual `zotlit:refresh-zotero-data` command — the escape hatch for
 * silent watcher staleness (system sleep, network-mounted data dirs, etc).
 *
 * A failed refresh rejects with {@link DbUnavailable}, also when the previous
 * database state keeps serving; the toast reports it.
 */
export function addDatabaseActions(
  plugin: Pick<Plugin, "addCommand">,
  services: { db: Pick<PlainZoteroReads, "refresh"> },
): void {
  plugin.addCommand({
    id: "refresh-zotero-data",
    name: m.command_refresh_db_name(),
    callback: async () => {
      try {
        await toast.promise(services.db.refresh(), {
          loading: m.notice_db_refreshing(),
          success: m.notice_db_refreshed(),
          error: m.notice_db_refresh_failed(),
          swallowError: false,
        });
      } catch (err) {
        if (err instanceof DbUnavailable) return;
        throw err;
      }
    },
  });
}
