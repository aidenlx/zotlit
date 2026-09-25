// The verbs over one Annotation or a group that both surfaces share: the
// Annotation View's menus and keys, and the Obsidian PDF view's keys and Mark
// Popup. A delete asks once, and a group names its count. Every verb here
// never rejects, so a caller may start one with `void`.
import type { App } from "obsidian";

import { confirm } from "@/lib/confirm";
import type { ConfirmOptions } from "@/lib/confirm";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import * as toast from "@/lib/toast";
import type {
  AnnotationRecord,
  AnnotationRepository,
} from "@/services/annotation-repository/service";
import { groupFailureMessages } from "@/services/annotation-repository/write";
import type { MutationState } from "@/services/annotation-repository/write";

import { copiedText } from "./copied-text";

const logger = getLogger(["views", "annot-view"]);

/**
 * The confirmation a delete of `count` Annotations asks for. An erase leaves
 * Zotero holding nothing, and the Annotation History puts it back only under a
 * new key, so the delete asks once, and a group names its count.
 */
export function deleteConfirmation(count: number): ConfirmOptions {
  return count > 1
    ? {
        title: m.annot_view_delete_group_confirm_title({ count }),
        content: m.annot_view_delete_group_confirm_content(),
        action: m.annot_view_delete_confirm_action(),
        destructive: true,
      }
    : {
        title: m.annot_view_delete_confirm_title(),
        content: m.annot_view_delete_confirm_content(),
        action: m.annot_view_delete_confirm_action(),
        destructive: true,
      };
}

/**
 * Ask once, then erase these Annotations in Zotero: one alone, or two or more
 * as one History Step where each keeps its own outcome. A write that did not
 * land says why in a notice, once per reason, as every failed write does.
 * Never rejects.
 *
 * @param options.annotationKeys Indexed Keys, in list order.
 * @param options.now the clock a cooldown's remaining seconds are read against.
 */
export async function confirmDelete(
  app: App,
  annotations: Pick<
    AnnotationRepository,
    "deleteAnnotation" | "deleteAnnotations"
  >,
  {
    annotationKeys,
    now,
  }: { annotationKeys: readonly string[]; now: () => Temporal.Instant },
): Promise<void> {
  const [first] = annotationKeys;
  if (first === undefined) return;
  if (!(await confirm(deleteConfirmation(annotationKeys.length), app))) return;
  await settleWrites(
    async () =>
      annotationKeys.length === 1
        ? [await annotations.deleteAnnotation(first)]
        : await annotations.deleteAnnotations(annotationKeys),
    { what: "delete", count: annotationKeys.length, now },
  );
}

/**
 * Recolour these Annotations in Zotero: one alone, or two or more as one
 * History Step where each keeps its own outcome. A write that did not land
 * says why in a notice, once per reason. Never rejects.
 *
 * @param options.annotationKeys Indexed Keys, in list order.
 * @param options.color the swatch to store.
 * @param options.now the clock a cooldown's remaining seconds are read against.
 */
export async function recolor(
  annotations: Pick<AnnotationRepository, "patchColor" | "patchColors">,
  {
    annotationKeys,
    color,
    now,
  }: {
    annotationKeys: readonly string[];
    color: string;
    now: () => Temporal.Instant;
  },
): Promise<void> {
  const [first] = annotationKeys;
  if (first === undefined) return;
  await settleWrites(
    async () =>
      annotationKeys.length === 1
        ? [await annotations.patchColor(first, color)]
        : await annotations.patchColors(annotationKeys, color),
    { what: "recolour", count: annotationKeys.length, now },
  );
}

/**
 * Put the text of these cards on the clipboard as `text/plain`, by the one
 * rule of {@link copiedText}.
 *
 * @param cards in list order.
 * @returns whether there was text to copy; nothing is written where none is.
 */
export function copyText(
  cards: readonly Pick<AnnotationRecord, "text" | "comment">[],
): boolean {
  const text = copiedText(cards);
  if (text === "") return false;
  void toast.promise(navigator.clipboard.writeText(text), {
    success: m.annot_view_copied_text(),
    error: m.annot_view_copy_failed(),
  });
  return true;
}

/**
 * Wait for the writes of one verb, and say why in a notice, once per reason,
 * for each that did not land. A send that threw is an outcome ZotLit never
 * learned.
 */
async function settleWrites(
  send: () => Promise<readonly MutationState[]>,
  {
    what,
    count,
    now,
  }: { what: string; count: number; now: () => Temporal.Instant },
): Promise<void> {
  let outcomes: readonly MutationState[];
  try {
    outcomes = await send();
  } catch (error) {
    logger.warn("A write threw before Zotero answered", {
      verb: what,
      annotations: count,
      error,
    });
    outcomes = [{ kind: "failed", failure: { kind: "unknown-outcome" } }];
  }
  for (const message of groupFailureMessages(outcomes, now()))
    new BaseNotice(message);
}
