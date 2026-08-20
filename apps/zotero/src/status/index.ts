// Per-window Database Status control in the library sidenav.

import { getLogger } from "@logtape/logtape";

import { requireMessage } from "@/lib/l10n";
import type { WalCheckpoint } from "@/notify/wal-checkpoint";

import databaseIcon from "./database.svg?inline";
import { databaseStatusMenuModel, manualOutcomeMessages } from "./model";

const logger = getLogger(["zotlit", "zotero", "database-status"]);

const CONTROL_ID = "zotlit-database-status";
const SIDENAV_ID = "zotero-view-item-sidenav";
const GUIDE_URL = "https://zotlit.aidenlx.site/docs/how-to/fix-stale-data";
const DEBUG_LOGS_URL =
  "https://zotlit.aidenlx.site/docs/how-to/collect-debug-logs";

export interface DatabaseStatus extends Disposable {
  attachWindow(window: Window): void;
  detachWindow(window: Window): void;
}

function menuItem(
  document: Document,
  label: string,
  disabled = false,
): Element {
  const item = document.createXULElement("menuitem");
  item.setAttribute("label", label);
  if (disabled) item.setAttribute("disabled", "true");
  return item;
}

async function showWriteOutcome(
  checkpoint: WalCheckpoint,
  window: Window,
): Promise<void> {
  const progress = new Zotero.ProgressWindow({ window });
  progress.changeHeadline(
    await requireMessage("zotlit-database-write-running-title"),
  );
  progress.show();

  const outcome = await checkpoint.writeNow();
  if (outcome === "unavailable") {
    logger.warning("manual wal checkpoint became unavailable");
  }
  const copy = manualOutcomeMessages(
    outcome === "unavailable" ? "failed" : outcome,
  );
  const failed = outcome === "failed" || outcome === "unavailable";
  const [title, message] = await Promise.all([
    requireMessage(copy.title),
    requireMessage(
      copy.message,
      failed ? { debugLogsUrl: DEBUG_LOGS_URL } : undefined,
    ),
  ]);
  progress.changeHeadline(title);
  progress.addDescription(message);
  progress.startCloseTimer(8000);
}

async function buildMenu(
  popup: Element,
  checkpoint: WalCheckpoint,
  window: Window,
): Promise<void> {
  const document = popup.ownerDocument;
  const model = databaseStatusMenuModel(checkpoint.status(), new Date());
  const [state, timestamp, writeLabel, guideLabel] = await Promise.all([
    requireMessage(model.stateMessage),
    requireMessage(model.timestampMessage, model.timestampArgs),
    requireMessage("zotlit-database-status-write-now"),
    requireMessage("zotlit-database-status-guide"),
  ]);

  const write = menuItem(document, writeLabel, !model.writeEnabled);
  write.addEventListener("command", () => {
    void showWriteOutcome(checkpoint, window);
  });
  const guide = menuItem(document, guideLabel);
  guide.addEventListener("command", () => Zotero.launchURL(GUIDE_URL));

  popup.replaceChildren(
    menuItem(document, state, true),
    menuItem(document, timestamp, true),
    document.createXULElement("menuseparator"),
    write,
    document.createXULElement("menuseparator"),
    guide,
  );
}

function injectControl(checkpoint: WalCheckpoint, window: Window): void {
  const document = window.document;
  if (document.getElementById(CONTROL_ID)) return;
  const sidenav = document.getElementById(SIDENAV_ID);
  const popupset = sidenav?.querySelector(":scope > popupset");
  if (!sidenav || !popupset) {
    logger.warning("library sidenav unavailable for database status", {
      href: window.location.href,
    });
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.id = CONTROL_ID;
  wrapper.className = "pin-wrapper";
  const button = document.createXULElement("toolbarbutton") as Element & {
    open: boolean;
  };
  button.className = "btn";
  button.setAttribute("type", "menu");
  button.setAttribute("data-action", CONTROL_ID);
  button.setAttribute("tabindex", "0");
  button.setAttribute("custom", "true");
  button.setAttribute("data-l10n-id", "zotlit-database-status");
  button.setAttribute(
    "style",
    `--custom-sidenav-icon-light: url("${databaseIcon}"); --custom-sidenav-icon-dark: url("${databaseIcon}");`,
  );
  const popup = document.createXULElement("menupopup");
  button.append(popup);
  wrapper.append(button);
  sidenav.insertBefore(wrapper, popupset);
  void document.l10n?.translateFragment(wrapper);

  button.addEventListener("mousedown", async (event) => {
    const mouseEvent = event as MouseEvent;
    if (mouseEvent.button !== 0) return;
    if (button.open) return;
    event.preventDefault();
    await buildMenu(popup, checkpoint, window);
    button.open = true;
  });
  logger.debug("attached database status control", {
    href: window.location.href,
  });
}

export function registerDatabaseStatus(
  checkpoint: WalCheckpoint,
): DatabaseStatus {
  function attachWindow(window: Window): void {
    injectControl(checkpoint, window);
  }

  function detachWindow(window: Window): void {
    window.document.getElementById(CONTROL_ID)?.remove();
  }

  for (const window of Zotero.getMainWindows()) attachWindow(window);
  logger.info("database status registered");
  return {
    attachWindow,
    detachWindow,
    [Symbol.dispose]() {
      for (const window of Zotero.getMainWindows()) detachWindow(window);
      logger.info("database status torn down");
    },
  };
}
