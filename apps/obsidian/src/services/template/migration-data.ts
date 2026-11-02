// The real Zotero item a Legacy Template conversion verifies against.
import { Effect, Stream } from "effect";

import type { CiteRef } from "@zotlit/db";

import { LibraryScope } from "@/services/library-scope/service";
import { readTemplateData } from "@/services/template-workbench/data";
import type { TemplateDataServices } from "@/services/template-workbench/data";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";

/** One real Zotero item, in every shape a conversion verifies against. */
export interface MigrationVerificationData {
  readonly note: object;
  readonly filename: object;
  readonly annotation: object | null;
  /** The one-item Citation both Citation Variants of the fold render. */
  readonly citation: readonly CiteRef[];
}

/** A candidate whose note and filename data build, and its data with an annotation when found. */
interface Verified {
  readonly base: MigrationVerificationData;
  readonly complete: MigrationVerificationData | null;
}

/** One root's data, failing with what failed to read or build it. */
const load = (indexedKey: string, root: "note" | "filename" | "annotation") =>
  readTemplateData(indexedKey, root).pipe(
    Effect.mapError(({ cause }) => cause),
  );

/**
 * Load one real in-scope Zotero item through the Workbench's inert render
 * seam: the first in-scope item whose note and filename data build, with an
 * annotation's data when `annotation` asks for one.
 */
export const readMigrationVerificationData = Effect.fn(
  "TemplateMigration.readVerificationData",
)(function* (options: {
  annotation: boolean;
}): Effect.fn.Return<
  MigrationVerificationData | null,
  unknown,
  TemplateDataServices | LibraryScope
> {
  const libraryScope = yield* LibraryScope;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const reads = yield* (yield* ZoteroReads).snapshot;
      const scope = yield* libraryScope.resolveLibraries(
        yield* reads.Libraries({}),
      );
      const candidates = Stream.fromIterable(scope.available, {
        chunkSize: 1,
      }).pipe(
        Stream.flatMap((library) =>
          Stream.unwrap(
            Effect.map(
              reads.ScopeItemIDs({
                kind: "literature-items",
                libraryID: library.libraryID,
              }),
              (itemIDs) => reads.DisplayRefs({ itemIDs: itemIDs ?? [] }),
            ),
          ),
        ),
        Stream.flatMap((slice) =>
          Stream.fromIterable(
            slice.flatMap(({ ref }) => (ref ? [ref.indexedKey] : [])),
            { chunkSize: 1 },
          ),
        ),
      );

      const verified = yield* candidates.pipe(
        Stream.mapEffect(
          // Untraced: runs once per candidate item until one verifies.
          Effect.fnUntraced(function* (indexedKey) {
            // The Citation is read under the lease before the render, not after.
            const citation = yield* citationVerificationRefs(reads, indexedKey);
            const [note, filename] = yield* Effect.all(
              [load(indexedKey, "note"), load(indexedKey, "filename")],
              { concurrency: "unbounded" },
            );
            if (note.kind !== "data" || filename.kind !== "data") return null;
            const base: MigrationVerificationData = {
              note: note.data,
              filename: filename.data,
              annotation: null,
              citation,
            };
            if (!options.annotation) return { base, complete: base };
            const annotationKey = firstAnnotationIndexedKey(note.data);
            if (!annotationKey) return { base, complete: null };
            const annotation = yield* load(annotationKey, "annotation");
            return {
              base,
              complete:
                annotation.kind === "data"
                  ? { ...base, annotation: annotation.data }
                  : null,
            };
          }),
        ),
        Stream.filter((candidate) => candidate !== null),
        Stream.takeUntil((candidate) => candidate.complete !== null),
        // Keep the first base, as the fallback when no candidate completes.
        Stream.runFold(
          (): Verified | null => null,
          (first, candidate): Verified => ({
            base: (first ?? candidate).base,
            complete: candidate.complete,
          }),
        ),
      );
      return verified && (verified.complete ?? verified.base);
    }),
  );
});

/**
 * The one-item Citation the Citation Template fold verifies against: the same
 * ref shape the citation suggester inserts, so the fold is checked through the
 * data path a real insertion takes.
 */
const citationVerificationRefs = Effect.fnUntraced(function* (
  reads: ZoteroReadsApi,
  indexedKey: string,
) {
  const items = yield* reads.ItemsByIndexedKeys({ indexedKeys: [indexedKey] });
  const item = items.get(indexedKey);
  if (!item) return [] as readonly CiteRef[];
  const citationKey =
    "citationKey" in item.fields ? (item.fields.citationKey ?? null) : null;
  return [{ citationKey, item }] as readonly CiteRef[];
});

function firstAnnotationIndexedKey(data: object): string | undefined {
  if (!("annotations" in data) || !Array.isArray(data.annotations)) {
    return undefined;
  }
  for (const annotation of data.annotations) {
    if (
      annotation !== null &&
      typeof annotation === "object" &&
      "indexedKey" in annotation &&
      typeof annotation.indexedKey === "string"
    ) {
      return annotation.indexedKey;
    }
  }
  return undefined;
}
