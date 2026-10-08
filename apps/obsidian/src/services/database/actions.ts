import type { Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import * as toast from "@/lib/toast";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";

/**
 * Register the manual `zotlit:refresh-zotero-data` command — the escape hatch for
 * silent watcher staleness (system sleep, network-mounted data dirs, etc).
 *
 * `db.ready` never rejects, so the await around it doesn't need a try/catch.
 * A failed refresh rejects with {@link DbUnavailable}, also when the previous
 * database state keeps serving; the toast reports it.
 */
export function addDatabaseActions(
  plugin: Pick<Plugin, "addCommand">,
  services: { db: ZoteroReadsService },
): void {
  plugin.addCommand({
    id: "refresh-zotero-data",
    name: m.command_refresh_db_name(),
    callback: async () => {
      await services.db.ready;
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
