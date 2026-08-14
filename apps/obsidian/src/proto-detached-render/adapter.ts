// PROTOTYPE #743 — throwaway, delete after ticket resolution.
//
// The detached Preact adapter: renders InlineRun synchronously into DOM that
// is not attached to the document, the way a CM6 widget's toDOM or a reading
// view post-processor needs. Fire-and-forget — no unmount, no root retention
// — because the raw-DOM surfaces this stands in for own the element's
// lifetime themselves and never call back in to dispose it.

import { createRoot } from "react-dom/client";

import {
  fixtureAuthorInText,
  fixtureBibliographyEntry,
  fixtureParenthetical,
} from "./ast";
import type { Inline } from "./ast";
import { bench } from "./bench";
import { renderNative } from "./native";
import { InlineRun } from "./Renderer";

/** Counters the wire-in call sites and bench() increment for the protocol. */
export const stats = {
  preactRenders: 0,
  nativeRenders: 0,
  toDOMCalls: 0,
  syncFailures: 0,
};

/** The three fixtures, indexable for the CM6 wire-in's `source.length % 3` pick. */
export const fixtures: readonly (readonly Inline[])[] = [
  fixtureParenthetical,
  fixtureAuthorInText,
  fixtureBibliographyEntry,
];

/**
 * Renders `nodes` into a detached `<span>` via the compat `createRoot`.
 *
 * @returns the span, populated synchronously — `createRoot(...).render()` is
 *   a synchronous 6-line wrapper in Preact's React-compat layer, so the
 *   childNodes assertion right after `render()` is a same-tick check, not a
 *   race.
 */
export function renderDetached(nodes: readonly Inline[]): HTMLElement {
  const span = document.createElement("span");
  createRoot(span).render(InlineRun({ nodes }));
  stats.preactRenders++;
  if (span.childNodes.length === 0) stats.syncFailures++;
  return span;
}

/**
 * Mounts InlineRun in an ATTACHED tree (fixed-position, appended to
 * `document.body`) — the sidebar-path stand-in that proves the same
 * component also works as plain JSX in a normal React tree, not only
 * detached.
 *
 * @returns a disposer that unmounts and removes the mount point.
 */
export function mountAttached(): () => void {
  const div = document.createElement("div");
  div.style.position = "fixed";
  div.style.bottom = "0";
  div.style.right = "0";
  div.style.zIndex = "99999";
  div.dataset.ztProto = "attached";
  document.body.appendChild(div);
  const root = createRoot(div);
  root.render(InlineRun({ nodes: fixtureBibliographyEntry }));
  return () => {
    root.unmount();
    div.remove();
  };
}

declare global {
  interface Window {
    __ztProto?: {
      stats: typeof stats;
      fixtures: typeof fixtures;
      renderDetached: typeof renderDetached;
      renderNative: typeof renderNative;
      mountAttached: typeof mountAttached;
      bench: typeof bench;
    };
    __ztProtoMode?: "preact" | "native";
  }
}

// Always (re)assigned rather than guarded on presence: a plugin reload
// re-evaluates this module and mints a fresh `stats` object, so a presence
// guard would leave `window.__ztProto` pointing at a stale object from the
// previous load while the live widget code counts against the new one.
if (typeof window !== "undefined") {
  window.__ztProto = {
    stats,
    fixtures,
    renderDetached,
    renderNative,
    mountAttached,
    bench,
  };
}
