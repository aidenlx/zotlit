// What every citekey interaction shell shares with Obsidian: one mouse event
// becomes one gesture, and one hovered note becomes the `hover-link` the Page
// preview core plugin answers.

import { Keymap, type HoverParent, type Workspace } from "obsidian";

import {
  CITEKEY_HOVER_SOURCE,
  type NavigationAction,
  type NavigationGesture,
} from "./intent";

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

/** The note one citekey surface asks the Page preview core plugin to show. */
export interface CitekeyHoverLink {
  event: MouseEvent;
  /** What Obsidian hangs the popover off, and hides it with. */
  hoverParent: HoverParent;
  targetEl: HTMLElement;
  /** The vault path of the Literature Note to preview. */
  linktext: string;
  /** The path of the note the citekey is written in. */
  sourcePath: string;
}

/**
 * Asks for the page preview of one Literature Note under the shared source id,
 * so every citekey surface stays one row in Obsidian's Page preview settings.
 * Obsidian owns the Ctrl-gating and the popover itself.
 */
export function triggerCitekeyHover(
  workspace: Pick<Workspace, "trigger">,
  link: CitekeyHoverLink,
): void {
  workspace.trigger("hover-link", { ...link, source: CITEKEY_HOVER_SOURCE });
}
