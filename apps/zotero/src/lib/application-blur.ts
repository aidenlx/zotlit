// Application Blur detection across every top-level Zotero window.

import { getLogger } from "@logtape/logtape";

const logger = getLogger(["zotlit", "zotero", "application-blur"]);

/**
 * The callback can run more than once for one application switch. Consumers
 * must treat it as a payload-free, idempotent signal.
 */
export function registerApplicationBlur(callback: () => void): Disposable {
  using stack = new DisposableStack();
  const pendingChecks = new Map<number, Window>();
  const windowTeardowns = new Map<Window, () => void>();
  let windowMediatorListener: nsIWindowMediatorListener | undefined;

  stack.defer(() => {
    if (windowMediatorListener) {
      Services.wm.removeListener(windowMediatorListener);
    }
    for (const [timeout, win] of pendingChecks) win.clearTimeout(timeout);
    for (const teardown of windowTeardowns.values()) teardown();
    logger.debug("unregistered application blur detector");
  });

  const attach = (win: Window) => {
    if (windowTeardowns.has(win)) return;
    const onDeactivate = () => {
      logger.trace("scheduled deferred application blur check");
      // The synchronous focus value is stale during Window Deactivate. A
      // native modal can stall this window-owned tick until it closes, which
      // makes the signal late while preserving the focus result.
      const timeout = win.setTimeout(() => {
        pendingChecks.delete(timeout);
        if (Services.focus.activeWindow !== null) return;
        logger.debug("application blur detected");
        callback();
      }, 0);
      pendingChecks.set(timeout, win);
    };
    windowTeardowns.set(win, () =>
      win.removeEventListener("deactivate", onDeactivate),
    );
    win.addEventListener("deactivate", onDeactivate);
  };

  for (const win of Services.wm.getEnumerator(null)) {
    attach(win as Window);
  }

  // Accepted detection gaps need no extra coordination: a modal opened from a
  // reader, a blur inside the roughly 200 ms modal-open race, or a setup with
  // three or more main windows can miss this accelerator. The pending
  // Checkpoint then follows its ordinary 500 ms trailing debounce.
  windowMediatorListener = {
    onOpenWindow(xulWindow) {
      attach(xulWindow.docShell.domWindow as Window);
    },
    onCloseWindow(xulWindow) {
      const win = xulWindow.docShell.domWindow as Window;
      // The DOM listener dies with its window. Drop the teardown because
      // touching the closed Gecko window during plugin disposal is unsafe.
      windowTeardowns.delete(win);
      for (const [timeout, pendingWindow] of pendingChecks) {
        if (pendingWindow === win) pendingChecks.delete(timeout);
      }
    },
  };
  Services.wm.addListener(windowMediatorListener);

  logger.debug("registered application blur detector");
  return stack.move();
}
