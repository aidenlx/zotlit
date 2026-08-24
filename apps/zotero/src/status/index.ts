// Per-window Database Status control in the library sidenav.

import { getLogger } from "@logtape/logtape";

import { requireMessage } from "@/lib/l10n";
import type { WalCheckpoint } from "@/notify/freshness";
import { prefs } from "@/prefs";
import type { FluentMessageId } from "@/types/fluent";

import databaseIcon from "./database.svg?inline";
import {
  databaseIconState,
  databaseStatusMenuModel,
  manualOutcomeMessages,
} from "./model";
import type { DatabaseIconState } from "./model";

const logger = getLogger(["zotlit", "zotero", "database-status"]);

const CONTROL_ID = "zotlit-database-status";
const SIDENAV_ID = "zotero-view-item-sidenav";
const GUIDE_URL = "https://zotlit.aidenlx.site/docs/how-to/fix-stale-data";
const DEBUG_LOGS_URL =
  "https://zotlit.aidenlx.site/docs/how-to/collect-debug-logs";

/**
 * How each state appears. The tooltip carries the state too, so the tint is
 * never the only channel. Zotero defines both accent tokens per color scheme,
 * so neither needs light/dark handling here; an empty `stroke` drops the
 * inline declaration and lets Zotero's own `--fill-secondary` show through
 * (its `.btn[custom]` rule sets `fill` and `stroke` from that one token).
 */
const ICON_APPEARANCE = {
  neutral: { stroke: "", tooltip: "zotlit-database-status" },
  off: {
    stroke: "var(--accent-gold)",
    tooltip: "zotlit-database-status-icon-off",
  },
  failed: {
    stroke: "var(--accent-red)",
    tooltip: "zotlit-database-status-icon-failed",
  },
} as const satisfies Record<
  DatabaseIconState,
  { stroke: string; tooltip: FluentMessageId }
>;

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

function paintIcon(button: Element, state: DatabaseIconState): void {
  const { stroke, tooltip } = ICON_APPEARANCE[state];
  (button as HTMLElement).style.setProperty("stroke", stroke);
  button.setAttribute("data-l10n-id", tooltip);
}

function paintControl(checkpoint: WalCheckpoint, window: Window): void {
  const document = window.document;
  const wrapper = document.getElementById(CONTROL_ID);
  const button = wrapper?.firstElementChild;
  if (!wrapper || !button) return;
  // Visibility follows the Checkpoint itself, not the notify switch: the
  // Checkpoint serves every companion user — the default install has no live
  // updates and leans on it hardest. Only the expected no-WAL state hides
  // the control (nothing to report or write); a failed probe is an error the
  // model paints red, so it must stay visible.
  const status = checkpoint.status();
  const hidden = !status.active && status.reason === "not-wal";
  wrapper.toggleAttribute("hidden", hidden);
  const state = databaseIconState(status);
  paintIcon(button, state);
  void document.l10n?.translateFragment(wrapper);
  logger.trace("painted database status control", {
    state,
    hidden,
    href: window.location.href,
  });
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
  button.setAttribute(
    "style",
    `--custom-sidenav-icon-light: url("${databaseIcon}"); --custom-sidenav-icon-dark: url("${databaseIcon}");`,
  );
  const popup = document.createXULElement("menupopup");
  button.append(popup);
  wrapper.append(button);
  sidenav.insertBefore(wrapper, popupset);
  paintControl(checkpoint, window);

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

  function repaintAll(): void {
    for (const window of Zotero.getMainWindows()) {
      paintControl(checkpoint, window);
    }
  }

  using stack = new DisposableStack();
  stack.defer(() => {
    for (const window of Zotero.getMainWindows()) detachWindow(window);
  });
  for (const window of Zotero.getMainWindows()) attachWindow(window);
  // Checkpoint runs move the state; the automatic-writes pref moves the tint.
  stack.defer(checkpoint.onChange(repaintAll));
  stack.defer(prefs.onChange("extensions.zotlit.wal-checkpoint", repaintAll));
  const disposable = stack.move();
  logger.info("database status registered");
  return {
    attachWindow,
    detachWindow,
    [Symbol.dispose]() {
      disposable[Symbol.dispose]();
      logger.info("database status torn down");
    },
  };
}
