import { Notice, type Plugin } from "obsidian";

import * as m from "@/paraglide/messages";
import { DatabaseError, type DatabaseService } from "./service";

/**
 * Register the manual `zotlit:refresh-db` command — the escape hatch for
 * silent watcher staleness (system sleep, network-mounted data dirs, etc).
 *
 * `db.ready` never rejects, so the await around it doesn't need a try/catch.
 */
export function addDatabaseActions(
  plugin: Pick<Plugin, "addCommand">,
  services: { db: DatabaseService },
): void {
  plugin.addCommand({
    id: "zotlit:refresh-db",
    name: m.command_refresh_db_name(),
    callback: async () => {
      await services.db.ready;
      try {
        await services.db.refresh();
        new Notice(m.notice_db_refreshed());
      } catch (err) {
        if (err instanceof DatabaseError) {
          new Notice(m.notice_db_refresh_failed());
          return;
        }
        throw err;
      }
    },
  });
}
