import type { Plugin } from "obsidian";

import { DOCS_SITE_URL } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import * as toast from "@/lib/toast";

import { DatabaseError } from "./service";
import type { DatabaseService } from "./service";

interface StaleReadNoticeCopy {
  title: string;
  explanation: string;
  fixAction: string;
  dismissAction: string;
  guideUrl: string;
  duration: 0;
}

export function staleReadNotice(): StaleReadNoticeCopy {
  return {
    title: m.notice_db_stale_read_title(),
    explanation: m.notice_db_stale_read_explanation(),
    fixAction: m.notice_db_stale_read_fix_action(),
    dismissAction: m.notice_db_stale_read_dismiss_action(),
    guideUrl: `${DOCS_SITE_URL}/docs/how-to/fix-stale-data`,
    duration: 0,
  };
}

export function showStaleReadNotice(copy: StaleReadNoticeCopy): BaseNotice {
  const notice = new BaseNotice(
    BaseNotice.render((renderer) => {
      renderer.setTitle(copy.title);
      renderer.addText(copy.explanation);
      renderer.addAction((button) => {
        button.setButtonText(copy.dismissAction).onClick(() => notice.hide());
      });
      renderer.addAction((button) => {
        button
          .setButtonText(copy.fixAction)
          .setCta()
          .onClick(() => {
            notice.hide();
            window.open(copy.guideUrl);
          });
      });
    }),
    copy.duration,
  );
  return notice;
}

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
  let staleNotice: BaseNotice | null = null;
  plugin.register(() => staleNotice?.hide());
  plugin.register(
    services.db.on("read-fallback", (notice) => {
      if (notice === "reflink-unsupported") {
        new BaseNotice(m.notice_db_reflink_unsupported());
      } else if (notice === "wal-not-replayed") {
        staleNotice ??= showStaleReadNotice(staleReadNotice());
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
