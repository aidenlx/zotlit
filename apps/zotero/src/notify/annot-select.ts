import { logger as appLogger } from "@/lib/logger";

import { type Send } from "./send";
import { currentSelection, notifyEnabled } from "./shared";

const logger = appLogger.getChild(["notify", "annot-select"]);

type InternalReader = _ZoteroTypes.ReaderInstance["_internalReader"];

interface Hook {
  /** The patched internal reader, used to detect reader recreation on reload. */
  internal: InternalReader;
  /** The original `_updateState`, reinstated on rebind/dispose. */
  original: InternalReader["_updateState"];
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
 * (annotation **keys**). That state has a single write path: the reader's
 * `_updateState` reducer (`this._state = { ...this._state, ...state }`). We wrap
 * it so every selection change — from the sidebar, a view click, or a tool
 * switch — re-reads the post-update state, maps keys → item ids, and pushes the
 * full current set whenever it differs from the last push.
 *
 * The wrapper calls the original first and never mutates state; the flush runs
 * after and is fully guarded, so a fault in our code can't break the reader.
 * This replaces an earlier `MutationObserver` on the sidebar's `selected` class,
 * whose blind spot was a hidden/closed sidebar: deselecting there toggles no row
 * and never fired, so the deselect went unsent.
 *
 * @see https://github.com/zotero/reader/blob/9.0.4/src/common/reader.js#L493
 */
export function registerAnnotSelectNotify(send: Send): Disposable {
  const hooks = new Map<_ZoteroTypes.ReaderInstance, Hook>();
  const hooking = new Set<_ZoteroTypes.ReaderInstance>(); // dedupe concurrent hooks

  const flush = (reader: _ZoteroTypes.ReaderInstance) => {
    if (!notifyEnabled()) return;
    const hook = hooks.get(reader);
    if (!hook) return;
    const selected = currentSelection(reader, hook.libraryID);
    const sig = selected.join(",");
    if (sig === hook.lastSig) return;
    hook.lastSig = sig;
    const attachmentID = reader.itemID;
    if (typeof attachmentID !== "number") return;
    const itemID = Zotero.Items.get(attachmentID)?.parentItemID;
    if (typeof itemID !== "number") return; // standalone attachment, no parent
    logger.debug("annot selection changed", {
      itemID,
      attachmentID,
      count: selected.length,
    });
    void send({
      event: "reader/annot-select",
      itemID,
      attachmentID,
      selected,
    });
  };

  async function hookReader(
    reader: _ZoteroTypes.ReaderInstance,
  ): Promise<void> {
    if (hooking.has(reader)) return;
    hooking.add(reader);
    try {
      await reader._initPromise;
      const internal = reader._internalReader;
      const attachmentID = reader.itemID;
      if (!internal || typeof attachmentID !== "number") return;
      const prev = hooks.get(reader);
      if (prev?.internal === internal) return; // already bound
      if (prev) prev.internal._updateState = prev.original; // recreated — rebind

      const libraryID = Zotero.Items.get(attachmentID)?.libraryID;
      if (typeof libraryID !== "number") return;

      // Patch by plain assignment, NOT `monkey-around`: `around()` reparents
      // prototypes across the chrome/content membrane and breaks the reader.
      // @see docs/reader-patching.md
      // oxlint-disable-next-line typescript/unbound-method
      const original = internal._updateState;
      internal._updateState = function (this: InternalReader, ...args) {
        const ret = original.call(this, ...args);
        try {
          flush(reader);
        } catch (error) {
          logger.error("annot-select flush failed", { attachmentID, error });
        }
        return ret;
      };
      // Seed from the live selection so an existing selection at hook time isn't
      // re-pushed; only later changes flush.
      hooks.set(reader, {
        internal,
        original,
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
      for (const { internal, original } of hooks.values())
        internal._updateState = original;
      hooks.clear();
      logger.debug("unregistered annot-select notifier");
    },
  };
}
