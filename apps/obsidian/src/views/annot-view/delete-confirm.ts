// The one delete verb both surfaces share: the Annotation View's menu and keys,
// and Delete in the Obsidian PDF view. A delete asks once, and a group names
// its count.
import type { App } from "obsidian";

import { confirm } from "@/lib/confirm";
import type { ConfirmOptions } from "@/lib/confirm";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import type { AnnotationRepository } from "@/services/annotation-repository/service";
import { groupFailureMessages } from "@/services/annotation-repository/write";
import type { MutationState } from "@/services/annotation-repository/write";

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
  let outcomes: readonly MutationState[];
  try {
    outcomes =
      annotationKeys.length === 1
        ? [await annotations.deleteAnnotation(first)]
        : await annotations.deleteAnnotations(annotationKeys);
  } catch (error) {
    logger.warn("A delete threw before Zotero answered", {
      annotations: annotationKeys.length,
      error,
    });
    outcomes = [{ kind: "failed", failure: { kind: "unknown-outcome" } }];
  }
  for (const message of groupFailureMessages(outcomes, now()))
    new BaseNotice(message);
}
