import { type Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import * as toast from "@/lib/toast";

import { DatabaseError, type DatabaseService } from "./service";

/**
 * Register the manual `zotlit:refresh-zotero-data` command — the escape hatch for
 * silent watcher staleness (system sleep, network-mounted data dirs, etc) —
 * and the UI subscriber that renders the service's read-fallback notice.
 *
 * `db.ready` never rejects, so the await around it doesn't need a try/catch.
 */
export function addDatabaseActions(
  plugin: Pick<Plugin, "addCommand" | "register">,
  services: { db: DatabaseService },
): void {
  plugin.register(
    services.db.on("read-fallback", (notice) => {
      if (notice === "reflink-unsupported") {
        new BaseNotice(m.notice_db_reflink_unsupported());
      }
    }),
  );

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
        if (err instanceof DatabaseError) return;
        throw err;
      }
    },
  });
}
