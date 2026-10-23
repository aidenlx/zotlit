// Choosing an Annotation Suggester result: the trigger text gives way to the
// annotation rendered through the user's template.
import type { App, MarkdownFileInfo } from "obsidian";

import { getLogger } from "@/lib/log";
import type { AnnotationRepository } from "@/services/annotation-repository/service";
import type { NoteFeature } from "@/services/note-feature";
import type { PlainUseLedger } from "@/services/use-ledger/plain";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import { captureInsertion } from "@/views/annot-view/async-insert";
import { prepareAndCommit } from "@/views/annot-view/drag-insert";

import type { AnnotationHit } from "./annotation-search";

const logger = getLogger(["views", "annotation-suggest"]);

export interface AnnotationInsertDeps {
  app: App;
  annotations: Pick<AnnotationRepository, "read">;
  noteFeature: Pick<NoteFeature, "prepareAnnotationInsert">;
  zoteroPref: Pick<ZoteroPrefService, "dataDir">;
  useLedger: Pick<PlainUseLedger, "record">;
  notify: (message: string | DocumentFragment) => void;
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
  using held = captureInsertion({
    editor,
    info,
    isCurrent,
    range,
    workspace: deps.app.workspace,
  });
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
  const landed = await prepareAndCommit(deps, {
    annotation,
    snapshot: { source: list.source, sourceScope },
    target: held,
    notePath: file.path,
    // The researcher typed the trigger where the text goes.
    placement: { replacesTrigger: true },
  });
  if (landed) deps.useLedger.record(hit.itemKey, "cited");
  return { kind: "settled" };
}
