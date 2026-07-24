import { logger as appLogger } from "@/lib/logger";

import { type Send } from "./send";
import { currentSelection, notifyEnabled } from "./shared";

const logger = appLogger.getChild(["notify", "active-reader"]);

/** @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/reader.js#L2005-L2007 */
const READER_WINDOW_URL = "chrome://zotero/content/reader.xhtml";
/** @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/plugins.js#L93-L124 */
const MAIN_WINDOW_URL = "chrome://zotero/content/zoteroPane.xhtml";

/**
 * `reader` is a back-reference `ReaderWindow._window` sets on itself once
 * loaded, not a DOM property.
 *
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/reader.js#L2017
 */
type ReaderWindow = Window & { reader?: _ZoteroTypes.ReaderInstance };

/**
 * Push the active reader to the Obsidian listener without monkey-patching.
 * Two independent paths feed the same flush, since a reader can be focused
 * either as a main-window tab or as its own top-level window:
 *
 * - Tab path: the `tab` notifier's `select` event tells us the selected tab
 *   changed in a main window; the active reader is `getByTabID` on the
 *   selected tab id carried in the event payload.
 * - Window path: a reader opened `openInWindow` (`ReaderWindow`) never
 *   touches `Zotero_Tabs` and fires no notifier event when focused, so its
 *   OS-level focus is instead observed via the DOM `activate` event, the
 *   idiom Zotero's own Scaffold window uses to notice it came to the
 *   foreground. `activate` is attached to every reader window *and* every
 *   main window, since switching focus back to a main window whose selected
 *   tab is a reader also needs a flush (no tab/select notifier fires,
 *   because the selected tab didn't change). New windows are picked up via
 *   a `Services.wm` mediator listener, the same idiom Zotero's plugin
 *   loader uses to track main-window open/close.
 *
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/scaffold/scaffold.js#L197
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/plugins.js#L93-L124
 */
export function registerActiveReaderNotify(send: Send): Disposable {
  let lastActiveAttachment: number | null = null;

  const flushReader = (reader: _ZoteroTypes.ReaderInstance | undefined) => {
    if (!notifyEnabled()) return;
    if (!reader) return;
    const attachmentID = reader.itemID;
    if (typeof attachmentID !== "number") return; // reader missing, or its item hasn't loaded yet
    if (attachmentID === lastActiveAttachment) return;
    lastActiveAttachment = attachmentID;
    const attachment = Zotero.Items.get(attachmentID);
    const itemID = attachment?.parentItemID;
    if (typeof itemID !== "number") return; // standalone attachment, no parent
    const selected =
      typeof attachment?.libraryID === "number"
        ? currentSelection(reader, attachment.libraryID)
        : [];
    logger.debug("active reader changed", {
      itemID,
      attachmentID,
      selected: selected.length,
    });
    void send({
      event: "reader/active",
      itemID,
      attachmentID,
      selected,
    });
  };

  const observer: { notify: _ZoteroTypes.Notifier.Notify } = {
    notify(event, type, ids) {
      if (type !== "tab" || event !== "select") return;
      // `ids` is always a single-element array of the newly selected tab id.
      // @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/tabs.js#L937
      const tabID = ids[0];
      if (typeof tabID !== "string") return;
      flushReader(Zotero.Reader.getByTabID(tabID));
    },
  };
  using stack = new DisposableStack();
  // Pushed first so it disposes last, after every other teardown below.
  stack.defer(() => logger.debug("unregistered active-reader notifier"));

  const notifierID = Zotero.Notifier.registerObserver(
    observer,
    ["tab"],
    "zotlit-notify-active-reader",
  );
  stack.defer(() => Zotero.Notifier.unregisterObserver(notifierID));

  // Window (reader or main) -> its own `activate`-listener teardown. One map
  // for both kinds since they're the same shape; the flush behavior is
  // chosen at attach time by `attachReaderWindow`/`attachMainWindow`. A
  // WeakMap so a closed window's entry is collected with the window; dispose
  // runs teardowns by looking up each still-open window (see the final
  // `stack.defer`), so a window closed before dispose is simply absent from
  // the enumeration and its `removeEventListener` never runs against the
  // now-dead Gecko window.
  const windowTeardowns = new WeakMap<Window, () => void>();
  let disposed = false;

  const attachReaderWindow = (win: ReaderWindow) => {
    if (windowTeardowns.has(win)) return;
    const handler = () => flushReader(win.reader);
    win.addEventListener("activate", handler);
    windowTeardowns.set(win, () =>
      win.removeEventListener("activate", handler),
    );
  };

  const attachMainWindow = (win: _ZoteroTypes.MainWindow) => {
    if (windowTeardowns.has(win)) return;
    const handler = () =>
      flushReader(Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID));
    win.addEventListener("activate", handler);
    windowTeardowns.set(win, () =>
      win.removeEventListener("activate", handler),
    );
  };

  // @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/reader.xhtml#L16
  for (const win of Services.wm.getEnumerator("zotero:reader")) {
    attachReaderWindow(win as ReaderWindow);
  }
  for (const win of Zotero.getMainWindows()) {
    attachMainWindow(win);
  }

  const windowMediatorListener: nsIWindowMediatorListener = {
    onOpenWindow(xulWindow) {
      const domWindow = xulWindow.docShell.domWindow as ReaderWindow &
        _ZoteroTypes.MainWindow;
      const onLoad = () => {
        domWindow.removeEventListener("load", onLoad);
        // Dispose may have already run while this window was still loading;
        // don't resurrect bookkeeping the teardown already dropped.
        if (disposed) return;
        if (domWindow.location.href === READER_WINDOW_URL) {
          attachReaderWindow(domWindow);
          // A new reader window opens already focused, and `activate` may
          // have fired before this listener attached (or may not fire again
          // at all) — flush once here so the initial focus isn't missed.
          flushReader(domWindow.reader);
        } else if (domWindow.location.href === MAIN_WINDOW_URL) {
          attachMainWindow(domWindow);
        }
      };
      domWindow.addEventListener("load", onLoad);
    },
    onCloseWindow(xulWindow) {
      const domWindow = xulWindow.docShell.domWindow as ReaderWindow &
        _ZoteroTypes.MainWindow;
      // Drop without running: the window is already gone, so its
      // `removeEventListener` teardown would touch a dead Gecko object.
      windowTeardowns.delete(domWindow);
    },
  };
  Services.wm.addListener(windowMediatorListener);
  stack.defer(() => Services.wm.removeListener(windowMediatorListener));
  // Deferred last so it disposes first: neutralize pending `load` listeners
  // and run each still-open window's teardown, looked up by re-enumerating
  // the live windows (a closed window is already gone from the enumeration,
  // so its dead `removeEventListener` is never touched here).
  stack.defer(() => {
    disposed = true;
    for (const win of Services.wm.getEnumerator("zotero:reader"))
      windowTeardowns.get(win)?.();
    for (const win of Zotero.getMainWindows()) windowTeardowns.get(win)?.();
  });

  // A reader may already be focused at startup, either as a window or a tab.
  // Services.focus reads the same nsFocusManager state the `activate` events
  // derive from; it is null when Zotero is backgrounded, so fall back to
  // window-mediator recency for the initial sync.
  // @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/zoteroPane.js#L1162
  const startupWindow = (Services.focus.activeWindow ??
    Services.wm.getMostRecentWindow(null)) as ReaderWindow | null;
  if (startupWindow?.location.href === READER_WINDOW_URL) {
    flushReader(startupWindow.reader);
  } else {
    const mainWin = Zotero.getMainWindow();
    if (mainWin)
      flushReader(Zotero.Reader.getByTabID(mainWin.Zotero_Tabs.selectedID));
  }

  logger.debug("registered active-reader notifier", { id: notifierID });
  return stack.move();
}
