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

import type { NoteFeatureDeps } from "./context";

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
 * `AnnotationSources` read. A citation string imports no file, so the
 * resolvers' `attachmentImport` port blocks every source.
 *
 * @param annotationKey the Annotation's Indexed Key.
 */
export async function renderAnnotationCitation(
  ctx: Pick<NoteFeatureDeps, "zoteroReads" | "zoteroPref"> & {
    template: Pick<NoteFeatureDeps["template"], "ready" | "renderCitation">;
    profile: Pick<NoteFeatureDeps["profile"], "ready">;
  },
  annotationKey: string,
): Promise<AnnotationCitation> {
  await Promise.all([ctx.template.ready, ctx.profile.ready]);
  using lease = await ctx.zoteroReads.acquireRead();
  const { reads } = lease;
  const sources = await Effect.runPromise(
    Effect.flatMap(reads.Libraries({}), (libraries) => {
      const selector = resolveIndexedKeyLibraryIn(libraries, annotationKey);
      return selector
        ? reads.AnnotationSources({
            libraryID: selector.libraryID,
            keys: [selector.key],
          })
        : Effect.succeed(null);
    }),
  );
  const resolvers = buildAnnotationResolvers({
    zoteroPref: ctx.zoteroPref,
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
  if (!data) return { kind: "not-in-database" };
  const text = annotationCitation(
    data.parentItem,
    data.pageLabel,
    ctx.template,
  );
  return text === null
    ? { kind: "no-citation-key" }
    : { kind: "citation", text };
}
