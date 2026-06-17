import { debounce } from "@std/async/debounce";

import { logger as appLogger } from "@/lib/logger";

import { type Send } from "./send";
import { NOTIFY_DEBOUNCE_MS, notifyEnabled } from "./shared";

const logger = appLogger.getChild(["notify", "annot-select"]);

interface Hook {
  mo: MutationObserver;
  /** The observed `body`, used to detect iframe recreation. */
  body: HTMLElement;
  libraryID: number;
  /** Signature of the last pushed selection, to diff against the live state. */
  lastSig: string;
}

/**
 * Push the set of annotation items currently selected in each Zotero reader to
 * the Obsidian listener.
 *
 * There is no Zotero API for selection — it never leaves the reader iframe — but
 * `_internalReader._state.selectedAnnotationIDs` holds the authoritative set
 * (annotation **keys**). We don't patch the reducer (`_updateState`) that
 * mutates it: instead a `MutationObserver` on the iframe's `document.body`
 * cheaply signals "something changed" (every selection path toggles the
 * `selected` class on a sidebar row), and the debounced flush *reads* the state,
 * maps keys → item ids, and pushes the full current set whenever it differs from
 * the last push. No DOM parsing — the observer is only a trigger.
 *
 * The observer is on the stable `document.body` (not the `#annotations` node,
 * which React unmounts when the sidebar closes). The one blind spot is a fully
 * *closed* sidebar, where no rows exist to mutate and thus nothing triggers a
 * re-read.
 *
 * @see https://github.com/zotero/reader/blob/9.0.3/src/common/reader.js#L493
 */
export function registerAnnotSelectNotify(send: Send): Disposable {
  const hooks = new Map<_ZoteroTypes.ReaderInstance, Hook>();
  const hooking = new Set<_ZoteroTypes.ReaderInstance>(); // dedupe concurrent hooks

  /** Sorted item ids of the reader's current selection (drops unresolved keys). */
  function currentSelection(
    reader: _ZoteroTypes.ReaderInstance,
    libraryID: number,
  ): number[] {
    const keys = reader._internalReader?._state?.selectedAnnotationIDs ?? [];
    return [...keys]
      .map((key) => Zotero.Items.getIDFromLibraryAndKey(libraryID, key))
      .filter((id): id is number => id !== false)
      .sort((a, b) => a - b);
  }

  const flush = debounce(() => {
    if (!notifyEnabled()) return;
    for (const [reader, hook] of hooks) {
      const selected = currentSelection(reader, hook.libraryID);
      const sig = selected.join(",");
      if (sig === hook.lastSig) continue;
      hook.lastSig = sig;
      const attachmentID = reader.itemID;
      if (typeof attachmentID !== "number") continue;
      logger.debug("annot selection changed", {
        attachmentID,
        count: selected.length,
      });
      void send({
        event: "reader/annot-select",
        attachmentID,
        selected,
      });
    }
  }, NOTIFY_DEBOUNCE_MS);

  async function hookReader(
    reader: _ZoteroTypes.ReaderInstance,
  ): Promise<void> {
    if (hooking.has(reader)) return;
    hooking.add(reader);
    try {
      await reader._initPromise;
      const win = reader._iframeWindow as
        | (typeof globalThis & Window)
        | undefined;
      const attachmentID = reader.itemID;
      if (!win || typeof attachmentID !== "number") return;
      const body = win.document.body;
      if (hooks.get(reader)?.body === body) return; // already bound to live iframe
      hooks.get(reader)?.mo.disconnect(); // iframe was recreated — rebind

      const libraryID = Zotero.Items.get(attachmentID)?.libraryID;
      if (typeof libraryID !== "number") return;

      const mo = new win.MutationObserver(() => flush());
      mo.observe(body, { attributeFilter: ["class"], subtree: true });
      // Seed from the live selection so an existing selection at hook time isn't
      // re-pushed; only later changes flush.
      hooks.set(reader, {
        mo,
        body,
        libraryID,
        lastSig: currentSelection(reader, libraryID).join(","),
      });
      logger.debug("hooked reader for annot select", { attachmentID });
    } finally {
      hooking.delete(reader);
    }
  }

  function sweep(): void {
    for (const reader of Zotero.Reader._readers) void hookReader(reader);
  }

  const observer: { notify: _ZoteroTypes.Notifier.Notify } = {
    // Sweep on any `tab` event. A session-restored reader tab starts
    // `…-unloaded` and only instantiates its reader on the `tab` `load` event
    // (`tabs.js` `markAsLoaded`) — which is absent from the typed Event union
    // and fires for neither `add` nor `select`, so a narrower filter misses
    // readers opened at app init. `hookReader` dedupes already-bound readers.
    notify(_event, type) {
      if (type === "tab") sweep();
    },
  };
  const notifierID = Zotero.Notifier.registerObserver(
    observer,
    ["tab"],
    "zotlit-notify-annot-select",
  );
  sweep(); // readers may already be open at startup
  logger.debug("registered annot-select notifier", { id: notifierID });

  return {
    [Symbol.dispose]() {
      Zotero.Notifier.unregisterObserver(notifierID);
      for (const { mo } of hooks.values()) mo.disconnect();
      hooks.clear();
      flush.clear();
      logger.debug("unregistered annot-select notifier");
    },
  };
}
