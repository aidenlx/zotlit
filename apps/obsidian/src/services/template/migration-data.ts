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

/**
 * The verification data for a caller outside Effect: the Template Migration
 * engine and the Profile dialogs. `build.ts` binds it (`bindTemplateData`).
 */
export interface LiteratureNoteTemplateMigrationDataDeps {
  readonly templateData: {
    verificationData(options: {
      annotation: boolean;
    }): Promise<MigrationVerificationData | null>;
  };
}

/** {@link readMigrationVerificationData} for a caller outside Effect, through its handle. */
export function loadLiteratureNoteTemplateMigrationData(
  deps: LiteratureNoteTemplateMigrationDataDeps,
  options: { annotation: boolean },
): Promise<MigrationVerificationData | null> {
  return deps.templateData.verificationData(options);
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
      const candidates: string[] = [];
      for (const library of scope.available) {
        const itemIDs = yield* reads.ScopeItemIDs({
          kind: "literature-items",
          libraryID: library.libraryID,
        });
        const slices = yield* Stream.runCollect(
          reads.DisplayRefs({ itemIDs: itemIDs ?? [] }),
        );
        for (const { ref } of slices.flat())
          if (ref) candidates.push(ref.indexedKey);
      }

      let verificationBase: MigrationVerificationData | undefined;
      for (const indexedKey of candidates) {
        // The Citation is read under the lease before the render, not after.
        const citation = yield* citationVerificationRefs(reads, indexedKey);
        const [note, filename] = yield* Effect.all(
          [load(indexedKey, "note"), load(indexedKey, "filename")],
          { concurrency: "unbounded" },
        );
        if (note.kind !== "data" || filename.kind !== "data") continue;
        if (!options.annotation) {
          return {
            note: note.data,
            filename: filename.data,
            annotation: null,
            citation,
          };
        }
        verificationBase ??= {
          note: note.data,
          filename: filename.data,
          annotation: null,
          citation,
        };
        const annotationKey = firstAnnotationIndexedKey(note.data);
        if (!annotationKey) continue;
        const annotation = yield* load(annotationKey, "annotation");
        if (annotation.kind !== "data") continue;
        return {
          note: note.data,
          filename: filename.data,
          annotation: annotation.data,
          citation,
        };
      }
      return verificationBase ?? null;
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
