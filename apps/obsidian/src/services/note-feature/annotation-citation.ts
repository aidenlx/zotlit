// Renders an Annotation's page-pinned citation for the annotation view's "Copy citation".
import { Effect } from "effect";

import {
  buildAnnotationsTemplateData,
  resolveIndexedKeyLibraryIn,
} from "@zotlit/db";

import {
  annotationCitation,
  buildAnnotationResolvers,
} from "@/lib/annotation-render";
import { syncTemplate } from "@/services/template-workbench/sync-template";
import { templateFailure } from "@/services/template/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

/** What "Copy citation" puts on the clipboard, or why it has nothing to put. */
export type AnnotationCitation =
  | { kind: "citation"; text: string }
  /** The parent item carries no citation key, or the Annotation has no parent item. */
  | { kind: "no-citation-key" }
  /** The Zotero database holds no Annotation under the key. */
  | { kind: "not-in-database" };

/**
 * Render an Annotation's page-pinned citation: the same Citation Template path
 * the `zt.citation` field uses ({@link annotationCitation}), from one
 * `AnnotationSources` read in one Snapshot. A citation string imports no file,
 * so the resolvers' `attachmentImport` port blocks every source.
 *
 * @param annotationKey the Annotation's Indexed Key.
 */
export const renderAnnotationCitation = Effect.fn(
  "NoteFeature.renderAnnotationCitation",
)(function* (annotationKey: string) {
  const sources = yield* Effect.scoped(
    Effect.gen(function* () {
      const reads = yield* (yield* ZoteroReads).snapshot;
      const libraries = yield* reads.Libraries({});
      const selector = resolveIndexedKeyLibraryIn(libraries, annotationKey);
      return selector
        ? yield* reads.AnnotationSources({
            libraryID: selector.libraryID,
            keys: [selector.key],
          })
        : null;
    }),
  );
  const { dataDir, baseAttachmentPath } = yield* (yield* ZoteroPref).current;
  const resolvers = buildAnnotationResolvers({
    zoteroPref: { dataDir, baseAttachmentPath },
    attachmentImport: {
      decide: (path, origin) => ({
        approved: false,
        path,
        origin,
        reason: "no-trusted-root",
      }),
      resolveLink: () => () => "",
    },
  });
  const [data] = sources
    ? buildAnnotationsTemplateData(sources, resolvers).values()
    : [];
  if (!data) return { kind: "not-in-database" } satisfies AnnotationCitation;
  const template = yield* syncTemplate;
  const text = yield* Effect.try({
    try: () => annotationCitation(data.parentItem, data.pageLabel, template),
    catch: templateFailure,
  });
  return (
    text === null ? { kind: "no-citation-key" } : { kind: "citation", text }
  ) satisfies AnnotationCitation;
});
