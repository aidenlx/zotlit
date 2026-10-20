// Choosing an Annotation Suggester result: the trigger text gives way to the
// annotation rendered through the user's template.
import type { App, MarkdownFileInfo } from "obsidian";

import { getLogger } from "@/lib/log";
import type { AnnotationRepository } from "@/services/annotation-repository/service";
import type { NoteFeature } from "@/services/note-feature";
import type { UseLedger } from "@/services/use-ledger/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import { captureInsertion } from "@/views/annot-view/async-insert";
import { prepareAndCommit } from "@/views/annot-view/drag-insert";
import type { InsertionTarget } from "@/views/annot-view/drag-insert";

import type { AnnotationHit } from "./annotation-search";

const logger = getLogger(["views", "annotation-suggest"]);

export interface AnnotationInsertDeps {
  app: App;
  annotations: Pick<AnnotationRepository, "read">;
  noteFeature: Pick<NoteFeature, "prepareAnnotationInsert">;
  zoteroPref: Pick<ZoteroPrefService, "dataDir">;
  useLedger: Pick<UseLedger, "record">;
  notify: (message: string | DocumentFragment) => void;
}

/**
 * The text that lands for `rendered`: one line gets a single trailing space,
 * unless one follows already, so typing goes on after it; a block such as the
 * default callout already stands apart on lines of its own.
 */
function padInline(rendered: string, next: string): string {
  if (rendered.replaceAll(/^\n+|\n+$/g, "").includes("\n")) return rendered;
  return next === " " ? rendered : `${rendered} `;
}

/**
 * How an insert ended: `unavailable` where the repository no longer holds the
 * annotation, which the caller tells the researcher; `settled` where the
 * render ran, whether its text landed or a later edit dropped it.
 */
export type AnnotationInsertOutcome =
  | { kind: "unavailable" }
  | { kind: "settled" };

/**
 * Replace `range` of the note with `hit`, read from the annotation repository
 * (the Local API while Zotero runs, the database while it is closed) and
 * rendered through the template of the note's Literature Note Profile. The
 * range is held across the read and the render: an edit over it, or a switch
 * of note, drops the insert. A Use of the paper is recorded once text lands.
 */
export async function insertAnnotation(
  deps: AnnotationInsertDeps,
  {
    hit,
    info,
    isCurrent,
    range,
  }: {
    hit: AnnotationHit;
    info: MarkdownFileInfo;
    isCurrent: () => boolean;
    range: { from: number; to: number };
  },
): Promise<AnnotationInsertOutcome> {
  const { editor, file } = info;
  if (!editor || !file) return { kind: "settled" };
  using held = captureInsertion({ editor, info, isCurrent, range });
  const sourceScope = deps.zoteroPref.dataDir;
  const list = await deps.annotations.read(hit.attachmentKey);
  if (!held.valid()) return { kind: "settled" };
  const annotation = list?.annotations.find(({ key }) => key === hit.key);
  if (!list || !annotation) {
    logger.debug("Annotation Suggester hit not in the repository", {
      annotationKey: hit.key,
      attachmentKey: hit.attachmentKey,
      listed: list !== null,
    });
    return { kind: "unavailable" };
  }
  const target: InsertionTarget = {
    ...held,
    commit(text) {
      // The text after the range as it stands now, which edits made during
      // the read and the render may have changed.
      const at = held.range();
      const next =
        at === null ? "" : editor.cm.state.doc.sliceString(at.to, at.to + 1);
      if (!held.commit(padInline(text, next))) return false;
      deps.useLedger.record(hit.itemKey, "cited");
      return true;
    },
  };
  await prepareAndCommit(deps, {
    annotation,
    snapshot: { source: list.source, sourceScope },
    target,
    notePath: file.path,
  });
  return { kind: "settled" };
}
