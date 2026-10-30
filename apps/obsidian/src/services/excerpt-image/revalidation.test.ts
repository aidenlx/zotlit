// A saved pixel edit revalidates its Excerpt Image, the newest edit winning.
import { it } from "@effect/vitest";
import { Deferred, Effect, Layer, PubSub, Queue, Stream } from "effect";
import { expect } from "vitest";

import type { AnnotationSources, Attachment } from "@zotlit/db";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { AnnotationRepository } from "@/services/annotation-repository/service";
import type {
  AnnotationRecord,
  AnnotationSource,
} from "@/services/annotation-repository/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";
import { readsAnswering } from "@/services/zotero-reads/__fixtures__";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";

import type { ExcerptRequest } from "./contract";
import { ExcerptDisplays } from "./display";
import { layerExcerptRevalidation } from "./revalidation";

const SERVER_ID = "A8sf5Zsz8ySw";
const source: AnnotationSource = {
  kind: "zotero-local-api",
  serverID: SERVER_ID,
};
const record = stubService<AnnotationRecord>("AnnotationRecord", {
  key: "ANNT2345",
  parentKey: "ATCH2345",
  type: "image",
});
const attachment = stubService<Attachment>("Attachment", {
  key: "ATCH2345",
  indexedKey: "ATCH2345",
  libraryID: 1,
  linkMode: 0,
  path: "storage:paper.pdf",
});
/** Reads of a database whose Server ID is `serverID`. */
const readsOf = (serverID: string) =>
  readsAnswering({
    DatabaseIdentity: () =>
      Effect.succeed({ serverID, userID: 1, localUserKey: "k" }),
    AttachmentSources: () =>
      Effect.succeed(
        stubService<AnnotationSources>("AnnotationSources", {
          attachments: [attachment],
        }),
      ),
  });
const reads = readsOf(SERVER_ID);

/**
 * The revalidation layer over a pixel-edit stream the case publishes to.
 * `snapshot` is each read's Snapshot; `revalidated` takes each request the
 * display revalidates.
 */
const register = Effect.fn("test.register")(function* (
  snapshot: Effect.Effect<ZoteroReadsApi>,
) {
  const edits = yield* PubSub.unbounded<{
    record: AnnotationRecord;
    source: AnnotationSource;
  }>();
  const revalidated = yield* Queue.unbounded<ExcerptRequest>();
  yield* Layer.build(
    layerExcerptRevalidation.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(AnnotationRepository, {
            excerptPixelsChanged: Stream.fromPubSub(edits),
          }),
          Layer.succeed(
            ExcerptDisplays,
            stubService<ExcerptDisplays["Service"]>("ExcerptDisplays", {
              revalidate: (request) =>
                Queue.offer(revalidated, request).pipe(Effect.asVoid),
            }),
          ),
          Layer.succeed(
            ZoteroReads,
            stubService<ZoteroReads["Service"]>("ZoteroReads", { snapshot }),
          ),
          Layer.mock(ZoteroPref, {
            current: Effect.succeed(
              stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", {
                dataDir: "/zotero",
                baseAttachmentPath: null,
              }),
            ),
          }),
        ),
      ),
    ),
  );
  return { edits, revalidated };
});

it.effect("revalidates the edited Annotation's Excerpt Image", () =>
  Effect.gen(function* () {
    const { edits, revalidated } = yield* register(Effect.succeed(reads));

    yield* PubSub.publish(edits, { record, source });

    expect(yield* Queue.take(revalidated)).toMatchObject({
      annotation: { key: record.key },
      attachmentKey: attachment.indexedKey,
      sourceScope: "/zotero",
    });
  }),
);

it.effect("interrupts an older read of the same Annotation", () =>
  Effect.gen(function* () {
    const started = yield* Queue.unbounded<void>();
    const olderStopped = yield* Deferred.make<void>();
    let count = 0;
    const { edits, revalidated } = yield* register(
      Effect.gen(function* () {
        const older = ++count === 1;
        yield* Queue.offer(started, undefined);
        // The older read holds its Snapshot until it is interrupted.
        if (older)
          return yield* Effect.never.pipe(
            Effect.onInterrupt(() => Deferred.succeed(olderStopped, undefined)),
          );
        return reads;
      }),
    );

    yield* PubSub.publish(edits, { record, source });
    yield* Queue.take(started);
    yield* PubSub.publish(edits, { record, source });
    yield* Deferred.await(olderStopped);

    expect(yield* Queue.take(revalidated)).toMatchObject({
      annotation: { key: record.key },
    });
    expect(count).toBe(2);
  }),
);
