// Pure navigation decisions shared by citekey interaction shells.

import type { PaneType } from "obsidian";

export type NavigationPane = boolean | PaneType;
export type NavigationAction = "click" | "hover";
export type NavigationButton = "left" | "middle" | "none";
export type EditorMode = "source" | "live-preview";
export type NavigationSurface = "editor" | "reading";

export interface NavigationGesture {
  action: NavigationAction;
  button: NavigationButton;
  mod: boolean;
  shift: boolean;
  alt: boolean;
  /** The editor's mode; a reading-mode shell has none and leaves it out. */
  editorMode?: EditorMode;
  surface: NavigationSurface;
  /** The result of Obsidian's public `Keymap.isModEvent`, when available. */
  pane?: NavigationPane;
}

/** The resolution states that interaction shells can expose to navigation. */
export type NavigationTarget =
  | { resolution: "direct"; citekey: string }
  | { resolution: "open-or-create"; citekey: string }
  | { resolution: "citation-menu"; citekeys: readonly string[] }
  | { resolution: "unavailable" };

/** One work a hovered citation names, as the Citation Popover addresses it. */
export interface HoveredWork {
  /** The citekey the citation writes the work as, which the open action names. */
  citekey: string;
  /**
   * The work's Indexed Key: the Item identity every consumer joins the work to
   * a document's entries by. A citekey reaching no Zotero Item names no Item to
   * carry, and leaves it out.
   */
  indexedKey?: string;
}

/** One work a rendered citation names, as its click target. */
export interface CitedWork extends HoveredWork {
  /**
   * The work's summary, or — for a key that reaches no Zotero Item — the key as
   * the citation writes it, braces and all, which is the raw text the
   * References Sidebar shows an unresolved key by.
   */
  label: string;
}

/**
 * What a click on a rendered citation reaches: the one work it names opens
 * straight away, several works ask which, and none leaves the citation inert.
 */
export function citationTarget(works: readonly CitedWork[]): NavigationTarget {
  if (works.length === 0) return { resolution: "unavailable" };
  if (works.length === 1) {
    return { resolution: "open-or-create", citekey: works[0]!.citekey };
  }
  return {
    resolution: "citation-menu",
    citekeys: works.map((work) => work.citekey),
  };
}

export type NavigationIntent =
  | { kind: "open"; citekey: string; pane: NavigationPane }
  | {
      kind: "show-citation-menu";
      citekeys: readonly string[];
      pane: NavigationPane;
    }
  | { kind: "hover"; citekey: string }
  | { kind: "nothing" };

/**
 * Converts a mouse gesture into Obsidian's pane choice.
 *
 * The editor shell normally supplies `Keymap.isModEvent(event)` as `pane` so
 * Obsidian remains the authority for its modifier mapping. This pure fallback
 * keeps the core useful to shells that already have structured modifiers.
 */
export function navigationPane(
  gesture: Pick<NavigationGesture, "button" | "mod" | "shift" | "alt">,
): NavigationPane {
  if (gesture.button === "middle") return "tab";
  if (!gesture.mod) return false;
  if (gesture.alt && gesture.shift) return "window";
  if (gesture.alt) return "split";
  return "tab";
}

/**
 * Decides what a citekey gesture means without reading application state or
 * producing a side effect.
 */
export function navigationIntent(
  gesture: NavigationGesture,
  target: NavigationTarget,
): NavigationIntent {
  if (gesture.action === "hover") {
    return target.resolution === "direct"
      ? { kind: "hover", citekey: target.citekey }
      : { kind: "nothing" };
  }

  if (gesture.button === "none") return { kind: "nothing" };

  if (
    gesture.surface === "editor" &&
    gesture.editorMode === "source" &&
    gesture.button === "left" &&
    !gesture.mod
  ) {
    return { kind: "nothing" };
  }

  const pane = gesture.pane ?? navigationPane(gesture);
  switch (target.resolution) {
    case "direct":
    case "open-or-create":
      if (isSourceModeSameTabDowngrade(gesture, pane)) {
        return { kind: "open", citekey: target.citekey, pane: false };
      }
      return { kind: "open", citekey: target.citekey, pane };
    case "citation-menu":
      return {
        kind: "show-citation-menu",
        citekeys: target.citekeys,
        pane,
      };
    case "unavailable":
      return { kind: "nothing" };
  }
}

function isSourceModeSameTabDowngrade(
  gesture: NavigationGesture,
  pane: NavigationPane,
): boolean {
  return (
    gesture.surface === "editor" &&
    gesture.editorMode === "source" &&
    gesture.button === "left" &&
    gesture.mod &&
    !gesture.shift &&
    pane === "tab"
  );
}
