// The Annotation History's own verbs, wherever a researcher asks for one that
// is not a key: the command palette, and the PDF view's More options menu.
import type { Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";

import type { HistoryDirection } from "./history";
import type { AnnotationRepository } from "./service";

/** Both ways a step is taken, in the order they are offered. */
export const HISTORY_DIRECTIONS: readonly HistoryDirection[] = ["undo", "redo"];

/**
 * A view that steps one Attachment's Annotation History and shows what the
 * step left: a bound PDF view, and an Annotation View on the Attachment it
 * shows. Both answer the same two verbs, so the palette, the menu and the keys
 * reach one surface rather than one each.
 */
export interface HistorySurface {
  /**
   * The Attachment whose Annotation History this surface steps, or `null`
   * while it shows none.
   */
  readonly historyAttachment: string | null;
  /** Take one step, and show what it left. */
  stepHistory(direction: HistoryDirection): void;
}

/** What the two commands read, and what they act on. */
export interface AnnotationHistoryActionDeps {
  annotations: Pick<AnnotationRepository, "canRedo" | "canUndo">;
  /**
   * The surface the active view offers, or `null` where it offers none — the
   * reading that decides whether the palette carries the commands at all.
   */
  activeSurface: () => HistorySurface | null;
}

/** The name one direction carries wherever it is offered. */
export function historyCommandName(direction: HistoryDirection): string {
  return direction === "undo"
    ? m.command_undo_annotation_change_name()
    : m.command_redo_annotation_change_name();
}

/**
 * Whether a step stands in this direction for this Attachment, and would be
 * taken. The momentary guards a press meets are not read, so an entry drawn
 * from this does not flicker under its own write; the guards that stand for as
 * long as the researcher is at work — a comment editor open on the step's own
 * Annotation — are, so no entry is offered for a press that would do nothing.
 *
 * @param attachmentKey the Attachment's Indexed Key.
 */
export function historyStands(
  annotations: Pick<AnnotationRepository, "canRedo" | "canUndo">,
  attachmentKey: string,
  direction: HistoryDirection,
): boolean {
  return direction === "undo"
    ? annotations.canUndo(attachmentKey)
    : annotations.canRedo(attachmentKey);
}

/**
 * The palette's "Undo annotation change" and "Redo annotation change". Each is
 * offered while the active view shows an Attachment whose Annotation History
 * holds a step that way, and drops out of the palette otherwise, so a command
 * on the list never silently does nothing.
 *
 * Neither takes a default keyboard shortcut: the platform keys already answer
 * inside a bound PDF view and on an Annotation Card, and a default here would
 * take them from Obsidian everywhere else.
 */
export function addAnnotationHistoryActions(
  plugin: Pick<Plugin, "addCommand">,
  deps: AnnotationHistoryActionDeps,
): void {
  for (const direction of HISTORY_DIRECTIONS) {
    plugin.addCommand({
      id: `${direction}-annotation-change`,
      name: historyCommandName(direction),
      checkCallback(checking) {
        const surface = deps.activeSurface();
        const attachmentKey = surface?.historyAttachment ?? null;
        if (!surface || attachmentKey === null) return false;
        if (!historyStands(deps.annotations, attachmentKey, direction)) {
          return false;
        }
        if (!checking) surface.stepHistory(direction);
        return true;
      },
    });
  }
}
