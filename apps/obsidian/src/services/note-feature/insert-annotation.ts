// Renders the captured card once, after its final image outcome is durable.
import {
  annotationColorToName,
  annotationOpenUri,
  fetchAnnotationParentContext,
  getAttachmentByKey,
  parseIndexedKey,
  resolveIndexedKeyLibrary,
} from "@zotlit/db";
import { TemplateError } from "@zotlit/templates/facade";

import {
  annotationCitation,
  buildAnnotationResolvers,
} from "@/lib/annotation-render";
import { unknownProfileDiagnostic } from "@/lib/profile-stamp";
import type {
  AnnotationRecord,
  AnnotationSource,
} from "@/services/annotation-repository/service";
import { excerptRequest } from "@/services/excerpt-image/service";
import { ProfileAnnotationError } from "@/services/template/service";

import type { NoteFeatureDeps } from "./context";

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
    | "db"
    | "zoteroPref"
    | "settings"
    | "singleExcerpt"
    | "noteIndex"
  >,
  options: AnnotationInsertOptions,
) {
  await Promise.all([ctx.template.ready, ctx.profile.ready]);
  using lease = await ctx.db.acquireRead();
  const { annotation: a, source, signal } = options;
  const valid = () =>
    !signal.aborted &&
    options.valid() &&
    options.sourceScope === ctx.zoteroPref.dataDir;
  if (!valid() || !ctx.singleExcerpt || !ctx.settings.current) return null;
  const paths = {
    dataDir: ctx.zoteroPref.dataDir,
    baseAttachmentPath: ctx.zoteroPref.baseAttachmentPath,
  };
  const request = excerptRequest({
    annotation: a,
    source,
    client: lease.client,
    paths,
  });
  // This also validates the captured source against the lease's database identity.
  if (!request) return null;
  const parent = resolveIndexedKeyLibrary(lease.client, a.parentKey);
  const key = parseIndexedKey(a.key);
  const attachment =
    parent && getAttachmentByKey(lease.client, parent.key, parent.libraryID);
  if (!attachment || !key) return null;
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
  const { parentItem, tplAttachment } = fetchAnnotationParentContext(
    lease.client,
    attachment,
    resolvers,
  );
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
  const prepared = await ctx.singleExcerpt({
    annotation: a,
    request,
    settings: ctx.settings.current,
    notePath: options.notePath,
    sourceLink: fileLink(),
    signal,
    valid,
  });
  if (!valid()) return null;
  const metadata = a.templateMetadata;
  const data = {
    key: key.key,
    indexedKey: a.key,
    libraryID: request.libraryID,
    type: a.type,
    text: a.text,
    commentHtml: a.comment,
    get comment() {
      return a.comment ? resolvers.commentToMarkdown(a.comment) : null;
    },
    colorHex: a.color,
    colorName: annotationColorToName(a.color),
    pageLabel: a.pageLabel,
    page,
    authorName: metadata?.authorName ?? null,
    get isExternal() {
      return requireFact(metadata?.isExternal, "isExternal");
    },
    get dateAdded() {
      return Temporal.Instant.from(
        requireFact(metadata?.dateAdded, "dateAdded"),
      );
    },
    get dateModified() {
      return Temporal.Instant.from(
        requireFact(metadata?.dateModified, "dateModified"),
      );
    },
    tags: a.tags.map((name) => ({
      name,
      type: metadata?.tags?.find((tag) => tag.name === name)?.type ?? "unknown",
      toString: () => name,
    })),
    imgLink: prepared.helper,
    fileLink,
    backlink: annotationOpenUri({
      annotationKey: key.key,
      attachmentKey: attachment.key,
      groupID: key.groupID,
      pageLabel: a.pageLabel,
    }),
    parentItem,
    parentAttachment: tplAttachment,
    get citation() {
      return annotationCitation(parentItem, a.pageLabel, ctx.template);
    },
    toString: () => a.text ?? a.comment ?? a.type,
  };
  return {
    text: ctx.template.renderProfileAnnotation(data, {
      profile: profile.profile,
    }),
    summary: prepared.summary(),
  };
}

function requireFact<T>(value: T | null | undefined, field: string): T {
  if (value == null)
    throw new TemplateError(
      `Annotation source did not supply ${field}`,
      "annotation",
    );
  return value;
}
