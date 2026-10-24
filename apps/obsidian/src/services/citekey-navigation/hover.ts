// What one hover over a recognized citation means, decided without touching the DOM.

import type { HoverAction, Settings } from "@/services/settings/schema";

import type { GestureSurface } from "./shell";

/**
 * The shared `hover-link` source id: every citekey surface previews its
 * Literature Note under this one id, which keeps Obsidian's Page preview
 * settings to a single row whose Ctrl-gating governs them all.
 */
export const CITEKEY_HOVER_SOURCE = "zotlit-citekey";

/** The editing mode a hover happened in, which the Require Mod gate is read per. */
export type HoverEditingMode = "source" | "live-preview" | "reading";

/**
 * How hover is set to answer: the one action every citekey surface routes
 * through, and — for the Citation Popover alone — whether it waits for a held
 * Mod in the mode the hover happened in.
 */
export interface HoverPreferences {
  action: HoverAction;
  requireMod: Readonly<Record<HoverEditingMode, boolean>>;
}

/** The Hover Action settings, as one hover reads them. */
export function hoverPreferences(
  settings: Readonly<Settings>,
): HoverPreferences {
  return {
    action: settings["citation.hover-action"],
    requireMod: {
      source: settings["citation.hover-require-mod-source"],
      "live-preview": settings["citation.hover-require-mod-live-preview"],
      reading: settings["citation.hover-require-mod-reading"],
    },
  };
}

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
export type HoverSuppression =
  | "hover-off"
  | "not-a-mouse"
  | "needs-mod"
  | "no-works"
  | "not-direct";

export type CitationHoverIntent =
  | { kind: "popover"; citekeys: readonly string[] }
  | { kind: "page-preview"; citekey: string }
  | { kind: "nothing"; reason: HoverSuppression };

/**
 * What one hovered citation shows: the Citation Popover of every work it
 * names, the page preview of the one Literature Note it names, or nothing.
 *
 * The popover stacks every work the citation names, so a multi-item citation
 * shows all of them. The page preview keeps the direct-only rule instead — it
 * has to name one file, and a citation naming several names no single one.
 *
 * @param citekeys the citekeys the citation names, in the order it names them.
 */
export function citationHoverIntent(
  gesture: CitationHoverGesture,
  hover: HoverPreferences,
  citekeys: readonly string[],
): CitationHoverIntent {
  if (hover.action === "off") {
    return { kind: "nothing", reason: "hover-off" };
  }
  // ZotLit is desktop-only, so a hover a pen or a finger produced shows
  // nothing. Direct popover construction bypasses the guard Obsidian runs
  // before its own hover, which is why this one is stated here.
  if (gesture.pointerType !== undefined && gesture.pointerType !== "mouse") {
    return { kind: "nothing", reason: "not-a-mouse" };
  }
  if (hover.action === "page-preview") {
    // Obsidian's own Page preview settings own the Mod gate of this branch,
    // so the Require Mod toggles are read for the popover alone.
    if (citekeys.length === 0) return { kind: "nothing", reason: "no-works" };
    if (citekeys.length > 1) return { kind: "nothing", reason: "not-direct" };
    return { kind: "page-preview", citekey: citekeys[0]! };
  }
  if (hover.requireMod[gesture.mode] && !gesture.mod) {
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
