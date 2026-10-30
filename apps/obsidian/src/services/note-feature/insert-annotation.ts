// Renders the captured card once, after its final image outcome is durable.
import { Effect } from "effect";

import {
  annotationOpenUri,
  buildAnnotationParents,
  parseIndexedKey,
} from "@zotlit/db";

import {
  annotationCitation,
  buildAnnotationResolvers,
} from "@/lib/annotation-render";
import { unknownProfileDiagnostic } from "@/lib/profile-stamp";
import type {
  AnnotationRecord,
  AnnotationSource,
} from "@/services/annotation-repository/service";
import { ExcerptPreparation } from "@/services/excerpt-image/prepare";
import type { ExcerptSummary } from "@/services/excerpt-image/prepare";
import {
  excerptInputs,
  excerptRequestFrom,
} from "@/services/excerpt-image/request";
import { NoteIndex } from "@/services/note-index/service";
import { Profile } from "@/services/profile/service";
import { PluginSettings } from "@/services/settings/service";
import { syncTemplate } from "@/services/template-workbench/sync-template";
import { ProfileAnnotationError, Template } from "@/services/template/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

import { annotationInsertData } from "./insert-annotation-data";

export interface AnnotationInsertOptions {
  annotation: AnnotationRecord;
  source: AnnotationSource;
  sourceScope: string;
  notePath: string;
  /** Whether the editor still takes the insert. */
  valid: () => boolean;
}

/** The captured card's rendered text and its Excerpt Image summary. */
export interface AnnotationInsert {
  text: string;
  summary: ExcerptSummary;
}

/**
 * Render the captured card through the annotation template of its parent
 * item's Literature Note Profile, after its Excerpt Image is prepared. `null`
 * where the insert went stale (the caller's `valid`, or a moved Zotero data
 * directory) or the database cannot place the card. An interrupt cancels it,
 * and aborts the excerpt preparation.
 *
 * Fails with {@link ProfileAnnotationError} when the parent's note names an
 * unknown Profile.
 */
export const prepareAnnotationInsert = Effect.fn(
  "NoteFeature.prepareAnnotationInsert",
)(function* (options: AnnotationInsertOptions) {
  const { annotation: a, source } = options;
  const pref = yield* ZoteroPref;
  const reads = yield* (yield* ZoteroReads).snapshot;
  const { dataDir: startDataDir, baseAttachmentPath } = yield* pref.current;
  // The insert is current while the editor takes it and the Zotero data
  // directory is the one the card came from.
  const valid = Effect.map(
    pref.current,
    ({ dataDir }) => options.valid() && options.sourceScope === dataDir,
  );
  if (!(yield* valid)) return null;
  const paths = { dataDir: startDataDir, baseAttachmentPath };
  // The parent context, not the Annotation's own row: a card the Local API
  // answered can precede its SQLite row.
  const { identity, sources, attachment } = yield* excerptInputs(
    reads,
    a.parentKey,
  );
  const request = excerptRequestFrom({
    annotation: a,
    source,
    identity,
    attachment,
    paths,
  });
  // This also validates the captured source against the Snapshot's database identity.
  const key = parseIndexedKey(a.key);
  if (!request || !attachment || !key) return null;
  const unusedImport = () => {
    throw new Error(
      "Captured annotation rendering uses prepared excerpt helpers",
    );
  };
  const resolvers = buildAnnotationResolvers({
    zoteroPref: paths,
    attachmentImport: { decide: unusedImport, resolveLink: unusedImport },
    annotationImageLink: () => null,
  });
  const { parentItem, tplAttachment } = buildAnnotationParents(
    sources,
    resolvers,
  ).get(attachment.itemID)!;
  const [file] = parentItem
    ? yield* (yield* NoteIndex).getNotesByItemKey(parentItem.indexedKey)
    : [];
  const profile = yield* (yield* Profile).profileOf(file);
  if (!profile.ok)
    return yield* Effect.fail(
      new ProfileAnnotationError(
        unknownProfileDiagnostic(profile.stamped.stamp, {
          path: file?.path,
          indexedKey: parentItem?.indexedKey,
        }),
      ),
    );
  const page = "pageIndex" in a.position ? a.position.pageIndex + 1 : null;
  const fileLink = resolvers.fileLink(attachment, { annotation: a.key, page });
  // The Durable Annotation Link: what the note points back to the passage
  // with, on any computer, rather than this computer's file path.
  const backlink = annotationOpenUri({
    annotationKey: key.key,
    attachmentKey: attachment.key,
    groupID: key.groupID,
    pageLabel: a.pageLabel,
  });
  const settings = yield* (yield* PluginSettings).current;
  const prepared = yield* (yield* ExcerptPreparation).forCard({
    annotation: a,
    request,
    settings,
    notePath: options.notePath,
    sourceLink: `[Zotero](${backlink})`,
    valid,
  });
  if (!(yield* valid)) return null;
  const templates = yield* syncTemplate;
  const data = annotationInsertData({
    annotation: a,
    key: key.key,
    libraryID: request.libraryID,
    page,
    resolvers,
    imgLink: prepared.helper,
    fileLink,
    backlink,
    parent: { parentItem, tplAttachment },
    citation: () => annotationCitation(parentItem, a.pageLabel, templates),
  });
  const text = yield* (yield* Template).renderProfileAnnotation(data, {
    profile: profile.profile,
  });
  return { text, summary: prepared.summary() } satisfies AnnotationInsert;
}, Effect.scoped);
