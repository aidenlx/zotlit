// Renders the captured card once, after its final image outcome is durable.
import { Effect, Ref, Schema, Stream } from "effect";

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
import type { ExcerptSummary } from "@/services/excerpt-image/prepare";
import type { prepareSingleExcerpt } from "@/services/excerpt-image/prepare-single";
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
  signal: AbortSignal;
  valid: () => boolean;
}

/** The captured card's rendered text and its Excerpt Image summary. */
export interface AnnotationInsert {
  text: string;
  summary: ExcerptSummary;
}

/**
 * The single-excerpt preparation, a legacy port until the excerpt area
 * converts: the plugin binds `app` and the excerpt resolver.
 */
export type SingleExcerpt = (
  options: Omit<Parameters<typeof prepareSingleExcerpt>[0], "app" | "resolver">,
) => ReturnType<typeof prepareSingleExcerpt>;

/**
 * A legacy Promise port rejected, such as the single-excerpt preparation when
 * a file write fails. The message is the rejection's own.
 */
export class LegacyPortError extends Schema.TaggedError<
  LegacyPortError,
  { readonly brand: unique symbol }
>()("LegacyPortError", {
  /** The port step that rejected. */
  step: Schema.String,
  /** What the port rejected with. */
  cause: Schema.Defect(),
}) {
  override get message(): string {
    if (this.cause instanceof Error) return this.cause.message;
    return typeof this.cause === "string" ? this.cause : "Unknown error";
  }
}

/** A legacy port's Promise, its rejection a {@link LegacyPortError}. */
const portCall = <A>(step: string, call: () => Promise<A>) =>
  Effect.tryPromise({
    try: call,
    catch: (cause) => new LegacyPortError({ step, cause }),
  });

/**
 * Render the captured card through the annotation template of its parent
 * item's Literature Note Profile, after its Excerpt Image is prepared. `null`
 * where the insert went stale (the signal, the caller's `valid`, or a moved
 * Zotero data directory) or the database cannot place the card.
 *
 * Fails with {@link ProfileAnnotationError} when the parent's note names an
 * unknown Profile.
 */
export const prepareAnnotationInsert = Effect.fn(
  "NoteFeature.prepareAnnotationInsert",
)(function* (singleExcerpt: SingleExcerpt, options: AnnotationInsertOptions) {
  const { annotation: a, source, signal } = options;
  const pref = yield* ZoteroPref;
  const reads = yield* (yield* ZoteroReads).snapshot;
  const { dataDir, baseAttachmentPath } = yield* pref.current;
  // The data directory as the preparation reads it on each `valid()`.
  const scope = yield* Ref.make(dataDir);
  yield* pref.changes.pipe(
    Stream.runForEach((snapshot) => Ref.set(scope, snapshot.dataDir)),
    Effect.forkScoped({ startImmediately: true }),
  );
  const valid = () =>
    !signal.aborted &&
    options.valid() &&
    options.sourceScope === Ref.getUnsafe(scope);
  if (!valid()) return null;
  const paths = { dataDir, baseAttachmentPath };
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
  const prepared = yield* portCall("single-excerpt", () =>
    singleExcerpt({
      annotation: a,
      request,
      settings,
      notePath: options.notePath,
      sourceLink: `[Zotero](${backlink})`,
      signal,
      valid,
    }),
  );
  if (!valid()) return null;
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
