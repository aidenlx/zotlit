// What every citekey interaction shell shares with Obsidian: one mouse event
// becomes one gesture, click and hover alike.

import { Keymap } from "obsidian";

import { hoverEditingMode } from "./hover";
import type { CitationHoverGesture } from "./hover";
import type { NavigationAction, NavigationGesture } from "./intent";

/** The surface a gesture happened on, and the editor's mode where it has one. */
export type GestureSurface = Pick<NavigationGesture, "surface" | "editorMode">;

/**
 * The gesture one mouse event carries, with Obsidian left as the authority on
 * its own modifier-to-pane mapping.
 *
 * Obsidian reads middle-click off `mousedown`, where `Keymap.isModEvent` has no
 * answer, so the new tab that button always means is supplied here instead.
 */
export function mouseGesture(
  event: MouseEvent,
  action: NavigationAction,
  where: GestureSurface,
): NavigationGesture {
  const button =
    action === "hover" ? "none" : event.button === 1 ? "middle" : "left";
  return {
    action,
    button,
    mod: Keymap.isModifier(event, "Mod"),
    shift: event.shiftKey,
    alt: event.altKey,
    surface: where.surface,
    editorMode: where.editorMode,
    pane: button === "middle" ? "tab" : Keymap.isModEvent(event),
  };
}

/**
 * The hover one mouse event carries. The modifier is read here and once only,
 * so a Mod pressed after the pointer settled changes nothing.
 */
export function hoverGesture(
  event: MouseEvent,
  where: GestureSurface,
): CitationHoverGesture {
  return {
    pointerType: (event as Partial<PointerEvent>).pointerType,
    mod: Keymap.isModifier(event, "Mod"),
    mode: hoverEditingMode(where),
  };
}
