// Zotero item-list "Obsidian Note" column, backed by an in-memory key set fetched from the Obsidian plugin.

import * as v from "valibot";

import {
  noteStatusResponseSchema,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  SOURCE_ID_HEADER,
} from "@zotlit/protocol";

import { formatValue, registerMenu } from "@/lib/l10n";
import { logger as appLogger } from "@/lib/logger";
import { notifyUrl } from "@/notify/shared";
import { sourceId } from "@/notify/source";

import obsidianLogo from "./obsidian-logo.svg?inline";

const logger = appLogger.getChild(["note-status"]);

const COLUMN_DATA_KEY = "obsidian-note";
const MENU_ID = "zotlit-tools-menu";

/** Minimum interval between background refresh attempts; `manual` bypasses it. */
const BACKGROUND_REFRESH_MIN_MS = 5000;

export interface NoteStatus extends Disposable {
  /** Attach the focus-refresh listener to a (new) main window. */
  attachWindow(win: Window): void;
}

type ItemTreeColumnOptions = _ZoteroTypes.ItemTreeManager.ItemTreeColumnOptions;

/**
 * Fetch outcome distinguishing an explicit protocol-version mismatch (426)
 * from any other failure (network error, non-ok status, or a body that
 * fails schema validation — which also covers the 204 source-id-mismatch
 * discard).
 */
type FetchOutcome =
  | { ok: true; keys: string[] }
  | { ok: false; reason: "protocol-mismatch" | "failed"; error?: unknown };

async function fetchNoteStatus(base: string): Promise<FetchOutcome> {
  try {
    const response = await fetch(new URL("/literature-notes", base), {
      headers: {
        [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
        [SOURCE_ID_HEADER]: sourceId(),
      },
    });
    if (response.status === 426)
      return { ok: false, reason: "protocol-mismatch" };
    // The listener discards a source-id mismatch with a success-shaped bodyless
    // 204 — never treat it as fresh (empty) status.
    if (response.status === 204) return { ok: false, reason: "failed" };
    if (!response.ok) return { ok: false, reason: "failed" };
    const body = v.parse(noteStatusResponseSchema, await response.json());
    return { ok: true, keys: body.keys };
  } catch (error) {
    return { ok: false, reason: "failed", error };
  }
}

/** Settle the manual-refresh progress window into its success/failure copy. */
async function settleManualRefresh(
  progress: Zotero.ProgressWindow,
  outcome: FetchOutcome,
): Promise<void> {
  const [titleId, messageId] = outcome.ok
    ? ([
        "zotlit-note-status-refreshed-title",
        "zotlit-note-status-refreshed-message",
      ] as const)
    : outcome.reason === "protocol-mismatch"
      ? ([
          "zotlit-protocol-incompatible-title",
          "zotlit-protocol-incompatible-message",
        ] as const)
      : ([
          "zotlit-note-status-refresh-failed-title",
          "zotlit-note-status-refresh-failed-message",
        ] as const);
  const [title, message] = await Promise.all([
    formatValue(titleId),
    formatValue(messageId, outcome.ok ? { count: outcome.keys.length } : {}),
  ]);
  progress.changeHeadline(title ?? "");
  progress.addDescription(message ?? "");
  progress.startCloseTimer(8000);
}

/**
 * Obsidian brand purple, light/dark scheme pair.
 *
 * @see https://obsidian.md/brand
 */
const OBSIDIAN_PURPLE = "#9974F8";
const OBSIDIAN_PURPLE_DARK = "#A88BFA";

function cellDot(doc: Document): HTMLSpanElement {
  const dot = doc.createElement("span");
  dot.style.display = "inline-block";
  dot.style.width = "6px";
  dot.style.height = "6px";
  dot.style.borderRadius = "50%";
  // Scheme resolved per render via matchMedia, the same pattern Zotero uses
  // for theme-dependent icon colors; rows re-render on theme change.
  dot.style.background = doc.defaultView?.matchMedia(
    "(prefers-color-scheme: dark)",
  )?.matches
    ? OBSIDIAN_PURPLE_DARK
    : OBSIDIAN_PURPLE;
  return dot;
}

// oxlint-disable-next-line max-params -- signature dictated by ItemTreeManager.registerColumn's renderCell contract
function renderCell(
  _index: number,
  data: string,
  column: ItemTreeColumnOptions & { className: string },
  _isFirstColumn: boolean,
  doc: Document,
): HTMLElement {
  const cell = doc.createElement("span");
  cell.className = `cell ${column.className}`;
  cell.style.display = "flex";
  cell.style.alignItems = "center";
  cell.style.justifyContent = "center";
  if (data) cell.append(cellDot(doc));
  return cell;
}

export async function registerNoteStatus(
  pluginID: string,
): Promise<NoteStatus> {
  logger.info("registering note status", { pluginID });
  const notedKeys = new Set<string>();
  let lastAttempt = 0;
  let inFlight = false;

  /** Fetch, apply to the cache on success, and report the outcome. */
  async function fetchAndApply(): Promise<FetchOutcome> {
    const base = notifyUrl();
    if (!base) {
      logger.debug("no notify URL configured");
      return { ok: false, reason: "failed" };
    }
    lastAttempt = Date.now();
    const outcome = await fetchNoteStatus(base);
    if (outcome.ok) {
      notedKeys.clear();
      for (const key of outcome.keys) notedKeys.add(key);
      Zotero.ItemTreeManager.refreshColumns();
      logger.info("refreshed note status", { count: outcome.keys.length });
    }
    return outcome;
  }

  async function backgroundRefresh(): Promise<void> {
    if (inFlight) return;
    if (Date.now() - lastAttempt < BACKGROUND_REFRESH_MIN_MS) return;
    inFlight = true;
    try {
      const outcome = await fetchAndApply();
      if (!outcome.ok) {
        logger.debug("background note-status refresh failed", {
          reason: outcome.reason,
          error: outcome.error,
        });
      }
    } finally {
      inFlight = false;
    }
  }

  // Skips the throttle and the in-flight skip: an explicit request always
  // fetches and always settles the progress window (a concurrent background
  // fetch is harmless — both writers replace the whole set).
  async function manualRefresh(): Promise<void> {
    const progress = new Zotero.ProgressWindow({
      window: Zotero.getMainWindow(),
    });
    progress.changeHeadline(
      (await formatValue("zotlit-note-status-refreshing-title")) ?? "",
    );
    progress.show();
    await settleManualRefresh(progress, await fetchAndApply());
  }

  // The label is pre-formatted because `Zotero.getString`'s sync Fluent
  // lookup only covers core FTL files, not plugin ones (same approach
  // Better BibTeX uses). The header shows the logo via `iconPath` (like the
  // built-in attachment column); the label still names the column in the
  // column picker.
  const registeredDataKey = Zotero.ItemTreeManager.registerColumn({
    dataKey: COLUMN_DATA_KEY,
    label:
      (await formatValue("zotlit-column-obsidian-note")) ?? "Obsidian Note",
    iconPath: obsidianLogo,
    fixedWidth: true,
    width: "32",
    pluginID,
    dataProvider: (item) => {
      const library = Zotero.Libraries.get(item.libraryID);
      return notedKeys.has(
        library && library.isGroup
          ? `${item.key}g${library.libraryTypeID}`
          : item.key,
      )
        ? "1"
        : "";
    },
    renderCell,
    zoteroPersist: ["width", "hidden", "sortDirection"],
  });
  if (registeredDataKey === false) {
    logger.error("ItemTreeManager.registerColumn returned false", {
      dataKey: COLUMN_DATA_KEY,
      pluginID,
    });
    throw new Error(
      "ItemTreeManager.registerColumn failed for obsidian-note column",
    );
  }

  const menuID = registerMenu({
    menuID: MENU_ID,
    pluginID,
    target: "main/menubar/tools",
    menus: [
      {
        menuType: "menuitem",
        l10nID: "zotlit-menu-tools-refresh-note-status",
        onCommand: () => {
          void manualRefresh();
        },
      },
    ],
  });
  if (menuID === false) {
    logger.error("MenuManager.registerMenu returned false", {
      menuID: MENU_ID,
      pluginID,
    });
    throw new Error("MenuManager.registerMenu failed for zotlit-tools-menu");
  }

  const removers = new Map<Window, () => void>();
  function attachWindow(win: Window): void {
    if (removers.has(win)) return;
    const listener = () => {
      void backgroundRefresh();
    };
    win.addEventListener("activate", listener);
    removers.set(win, () => win.removeEventListener("activate", listener));
  }

  for (const win of Zotero.getMainWindows()) attachWindow(win);
  void backgroundRefresh();
  logger.info("note status registered", {
    dataKey: registeredDataKey,
    menuID,
  });

  return {
    attachWindow,
    [Symbol.dispose](): void {
      for (const remove of removers.values()) remove();
      removers.clear();
      Zotero.ItemTreeManager.unregisterColumn(registeredDataKey);
      Zotero.MenuManager.unregisterMenu(menuID);
      logger.info("note status torn down");
    },
  };
}
