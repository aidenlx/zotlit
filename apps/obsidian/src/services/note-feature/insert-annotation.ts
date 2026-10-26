// Renders the captured card once, after its final image outcome is durable.
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
import {
  excerptRequestFrom,
  readExcerptInputs,
} from "@/services/excerpt-image/request";
import { ProfileAnnotationError } from "@/services/template/service";

import type { NoteFeatureDeps } from "./context";
import { annotationInsertData } from "./insert-annotation-data";

export interface AnnotationInsertOptions {
  annotation: AnnotationRecord;
  source: AnnotationSource;
  sourceScope: string;
  notePath: string;
  signal: AbortSignal;
  valid: () => boolean;
}

export async function prepareAnnotationInsert(
  ctx: Pick<
    NoteFeatureDeps,
    | "template"
    | "profile"
    | "zoteroReads"
    | "zoteroPref"
    | "settings"
    | "bridge"
    | "singleExcerpt"
    | "noteIndex"
  >,
  options: AnnotationInsertOptions,
) {
  await using lease = await ctx.zoteroReads.acquireRead();
  const { annotation: a, source, signal } = options;
  const valid = () =>
    !signal.aborted &&
    options.valid() &&
    options.sourceScope === ctx.zoteroPref.dataDir;
  if (!valid() || !ctx.singleExcerpt) return null;
  const paths = {
    dataDir: ctx.zoteroPref.dataDir,
    baseAttachmentPath: ctx.zoteroPref.baseAttachmentPath,
  };
  // The parent context, not the Annotation's own row: a card the Local API
  // answered can precede its SQLite row.
  const { identity, sources, attachment } = await readExcerptInputs(
    lease.reads,
    a.parentKey,
  );
  const request = excerptRequestFrom({
    annotation: a,
    source,
    identity,
    attachment,
    paths,
  });
  // This also validates the captured source against the lease's database identity.
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
  const file = parentItem
    ? ctx.noteIndex.getNotesByItemKey(parentItem.indexedKey)[0]
    : undefined;
  const profile = file ? ctx.profile.profileOf(file) : ctx.profile.profileOf();
  if (!profile.ok)
    throw new ProfileAnnotationError(
      unknownProfileDiagnostic(profile.stamped.stamp, {
        path: file?.path,
        indexedKey: parentItem?.indexedKey,
      }),
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
  const prepared = await ctx.singleExcerpt({
    annotation: a,
    request,
    settings: ctx.bridge.runSync(ctx.settings.current),
    notePath: options.notePath,
    sourceLink: `[Zotero](${backlink})`,
    signal,
    valid,
  });
  if (!valid()) return null;
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
    citation: () => annotationCitation(parentItem, a.pageLabel, ctx.template),
  });
  return {
    text: ctx.template.renderProfileAnnotation(data, {
      profile: profile.profile,
    }),
    summary: prepared.summary(),
  };
}
