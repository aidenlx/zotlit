// What every citekey interaction shell shares with Obsidian: one mouse event
// becomes one gesture, click and hover alike, and one hovered note becomes the
// `hover-link` the Page preview core plugin answers.

import { Keymap } from "obsidian";
import type { App, HoverParent, Workspace } from "obsidian";

import { CITEKEY_HOVER_SOURCE, hoverEditingMode } from "./hover";
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

/** The Page preview core plugin, as far as its Mod gate reads it. */
interface PagePreviewPlugin {
  /** The toggles of its settings rows, by hover source; absent until changed. */
  options: Record<string, boolean>;
}

/**
 * Whether Obsidian's Page preview settings make a hover under the citekey
 * source wait for Mod: the row's own toggle once the researcher changed it,
 * else the default the source registered. This is the gate Obsidian puts on a
 * citation's page preview, and every ZotLit hover that answers under Page
 * Preview reads it here. With the core plugin off its rows keep no toggle, and
 * the source's default stands.
 *
 * Mirrors the core plugin's own `onHoverLink`, verified against Obsidian
 * 1.14.4.
 */
export function pagePreviewRequiresMod(app: App): boolean {
  const plugin = app.internalPlugins.getEnabledPluginById(
    "page-preview",
  ) as PagePreviewPlugin | null;
  const options = plugin?.options ?? {};
  if (Object.hasOwn(options, CITEKEY_HOVER_SOURCE))
    return options[CITEKEY_HOVER_SOURCE]!;
  return (
    app.workspace.hoverLinkSources[CITEKEY_HOVER_SOURCE]?.defaultMod ?? true
  );
}
