import { type ExtraButtonComponent, SettingGroup } from "obsidian";

import { getLogger } from "@/lib/log";
import { requireDialog } from "@/lib/require";
import * as toast from "@/lib/toast";
import * as m from "@/paraglide/messages";
import type { DatabaseService } from "@/services/database/service";
import { resolveZoteroDataDir } from "@/services/settings/schema";
import {
  RESET_SETTING,
  type SettingsService,
} from "@/services/settings/service";
import type { SectionContext } from "../section";

const logger = getLogger(["setting-tab", "database"]);

const DB_FILENAME = "zotero.sqlite";

export interface DatabaseSectionContext extends SectionContext {
  db: DatabaseService;
}

export function databaseSection(ctx: DatabaseSectionContext): Disposable {
  using stack = new DisposableStack();

  const snapshot = ctx.settings.current;
  if (!snapshot) {
    throw new Error("databaseSection: settings have not loaded yet");
  }

  const group = new SettingGroup(ctx.containerEl).setHeading(
    m.settings_db_heading(),
  );

  const defaultDir = resolveZoteroDataDir(null);

  const desc = document.createDocumentFragment();
  desc.append(m.settings_db_data_dir_desc());
  desc.append(document.createElement("br"));
  const pathCode = document.createElement("code");
  pathCode.textContent = resolveSqlitePath(snapshot["zotero.data-dir"]);
  desc.append(pathCode);
  const statusBr = document.createElement("br");
  const statusSpan = document.createElement("span");
  statusBr.style.display = "none";
  statusSpan.style.display = "none";
  desc.append(statusBr, statusSpan);

  let refreshButton: ExtraButtonComponent | undefined;
  let resetButton: ExtraButtonComponent | undefined;

  group.addSetting((setting) => {
    setting
      .setName(m.settings_db_data_dir_name())
      .setDesc(desc)
      .addExtraButton((button) => {
        resetButton = button;
        button
          .setIcon("rotate-ccw")
          .setTooltip(m.settings_db_reset())
          .onClick(() => {
            ctx.settings.update({ "zotero.data-dir": RESET_SETTING });
          });
      })
      .addExtraButton((button) => {
        button
          .setIcon("folder-open")
          .setTooltip(m.settings_db_data_dir_browse())
          .onClick(() => {
            void browseForDataDir(ctx.settings, defaultDir);
          });
      })
      .addExtraButton((button) => {
        refreshButton = button;
        button
          .setIcon("refresh-cw")
          .setTooltip(m.settings_db_refresh())
          .onClick(() => {
            void toast.promise(ctx.db.refresh(), {
              loading: m.notice_db_refreshing(),
              success: m.notice_db_refreshed(),
              error: m.notice_db_refresh_failed(),
            });
          });
      });
  });

  group.addSetting((setting) => {
    setting
      .setName(m.settings_db_auto_refresh_name())
      .setDesc(m.settings_db_auto_refresh_desc())
      .addToggle((toggle) => {
        toggle.setValue(snapshot["zotero.auto-refresh"]).onChange((checked) => {
          ctx.settings.update({ "zotero.auto-refresh": checked });
        });
      });
  });

  let refreshing = false;
  let lastRefreshFailed = false;
  let lastErrorMessage: string | null = null;

  // Events miss the loading→ready/degraded transition (T14 contract), so we
  // probe the active client on mount to seed the tooltip when already degraded.
  if (ctx.db.state === "degraded") {
    try {
      void ctx.db.client;
    } catch (err) {
      if (err instanceof Error) lastErrorMessage = extractErrorMessage(err);
    }
  }

  const applyStatus = (): void => {
    const state = ctx.db.state;
    let text = "";
    let isError = false;
    if (state === "loading") {
      text = m.settings_db_status_loading();
    } else if (refreshing) {
      text = m.settings_db_status_refreshing();
    } else if (state === "degraded") {
      text = m.settings_db_status_degraded();
      isError = true;
    } else if (lastRefreshFailed) {
      text = m.settings_db_status_refresh_failed();
      isError = true;
    }

    if (text) {
      statusBr.style.display = "";
      statusSpan.style.display = "";
      statusSpan.textContent = text;
      statusSpan.classList.toggle("mod-warning", isError);
      statusSpan.ariaLabel = lastErrorMessage ?? "";
    } else {
      statusBr.style.display = "none";
      statusSpan.style.display = "none";
      statusSpan.textContent = "";
      statusSpan.classList.remove("mod-warning");
      statusSpan.ariaLabel = null;
    }
    refreshButton?.setDisabled(state === "loading" || refreshing);
  };

  const applyPath = (value: string | null): void => {
    pathCode.textContent = resolveSqlitePath(value);
    if (resetButton) {
      resetButton.extraSettingsEl.style.display = value === null ? "none" : "";
    }
  };

  applyStatus();

  stack.defer(
    ctx.settings.subscribe((value) => {
      if (value === null) return;
      applyPath(value["zotero.data-dir"]);
    }),
  );

  stack.defer(
    ctx.db.on("changed", () => {
      lastRefreshFailed = false;
      lastErrorMessage = null;
      applyStatus();
    }),
  );
  stack.defer(
    ctx.db.on("degraded", (err) => {
      lastErrorMessage = extractErrorMessage(err);
      applyStatus();
    }),
  );
  stack.defer(
    ctx.db.on("refresh-failed", (err) => {
      lastRefreshFailed = true;
      lastErrorMessage = extractErrorMessage(err);
      applyStatus();
    }),
  );
  stack.defer(
    ctx.db.on("refreshing", (active) => {
      refreshing = active;
      applyStatus();
    }),
  );

  return stack.move();
}

function resolveSqlitePath(dataDir: string | null): string {
  return `${resolveZoteroDataDir(dataDir)}/${DB_FILENAME}`;
}

function extractErrorMessage(err: Error): string {
  const cause = err.cause;
  if (cause instanceof Error) return cause.message;
  return err.message;
}

async function browseForDataDir(
  settings: SettingsService,
  defaultDir: string,
): Promise<void> {
  const current = settings.current;
  const startPath = current?.["zotero.data-dir"] ?? defaultDir;
  try {
    const result = await requireDialog().showOpenDialog({
      title: m.settings_db_data_dir_dialog_title(),
      defaultPath: startPath,
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return;
    const picked = result.filePaths[0]!;
    settings.update({ "zotero.data-dir": picked });
  } catch (error) {
    logger.error("Failed to open data folder dialog", { error });
  }
}
