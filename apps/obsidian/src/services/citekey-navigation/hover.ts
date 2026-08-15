// What one hover over a recognized citation means, decided without touching the DOM.

import type { GestureSurface } from "./shell";

/** The editing mode a hover happened in, which the Require Mod gate is read per. */
export type HoverEditingMode = "source" | "live-preview" | "reading";

/**
 * Whether hover needs a held Mod, per editing mode: Source mode keeps the
 * modifier so plain-text editing is never interrupted, while the two rendered
 * modes answer to bare hover.
 *
 * These are the locked defaults, held as constants until the Hover Action
 * settings own them.
 */
const HOVER_REQUIRES_MOD: Readonly<Record<HoverEditingMode, boolean>> = {
  source: true,
  "live-preview": false,
  reading: false,
};

/** One hover gesture, as the pure decision below reads it. */
export interface CitationHoverGesture {
  /**
   * `PointerEvent.pointerType`, or `undefined` for an event carrying none —
   * which a plain `MouseEvent` on the desktop does.
   */
  pointerType: string | undefined;
  /** `Keymap.isModifier(event, "Mod")`, read once at hover time. */
  mod: boolean;
  mode: HoverEditingMode;
}

/** Why a hover shows nothing, which is what the surfaces log. */
export type HoverSuppression = "not-a-mouse" | "needs-mod" | "no-works";

export type CitationHoverIntent =
  | { kind: "popover"; citekeys: readonly string[] }
  | { kind: "nothing"; reason: HoverSuppression };

/**
 * Whether a hovered citation shows the Citation Popover, and for which works.
 *
 * Every work the citation names is stacked, so a multi-item citation shows all
 * of them — the direct-only rule a page preview answers to belongs to the file
 * it would have to name, not to a popover that names none.
 *
 * @param citekeys the citekeys the citation names, in the order it names them.
 */
export function citationHoverIntent(
  gesture: CitationHoverGesture,
  citekeys: readonly string[],
): CitationHoverIntent {
  // ZotLit is desktop-only, so a hover a pen or a finger produced shows
  // nothing. Direct popover construction bypasses the guard Obsidian runs
  // before its own hover, which is why this one is stated here.
  if (gesture.pointerType !== undefined && gesture.pointerType !== "mouse") {
    return { kind: "nothing", reason: "not-a-mouse" };
  }
  if (HOVER_REQUIRES_MOD[gesture.mode] && !gesture.mod) {
    return { kind: "nothing", reason: "needs-mod" };
  }
  if (citekeys.length === 0) return { kind: "nothing", reason: "no-works" };
  return { kind: "popover", citekeys };
}

/** The editing mode one surface's hovers are gated by. */
export function hoverEditingMode({
  surface,
  editorMode,
}: GestureSurface): HoverEditingMode {
  return surface === "reading" ? "reading" : (editorMode ?? "source");
}
