// Choosing an Annotation Suggester result: the trigger text gives way to the
// annotation rendered through the user's template.
import type { App, MarkdownFileInfo } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
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
): Promise<void> {
  const { editor, file } = info;
  if (!editor || !file) return;
  const next = editor.cm.state.doc.sliceString(range.to, range.to + 1);
  using held = captureInsertion({ editor, info, isCurrent, range });
  const sourceScope = deps.zoteroPref.dataDir;
  const list = await deps.annotations.read(hit.attachmentKey);
  if (!held.valid()) return;
  const annotation = list?.annotations.find(({ key }) => key === hit.key);
  if (!list || !annotation) {
    logger.debug("Annotation Suggester hit not in the repository", {
      annotationKey: hit.key,
      attachmentKey: hit.attachmentKey,
      listed: list !== null,
    });
    deps.notify(m.annotation_suggest_unavailable());
    return;
  }
  const target: InsertionTarget = {
    ...held,
    commit(text) {
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
}
