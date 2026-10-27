// Match vocabulary spans every Library in the pinned live database.
import { Effect } from "effect";

import { formatIndexedKey, parseIndexedKey } from "@zotlit/db";
import { planItemFilter, testItemSeed } from "@zotlit/item-query";
import type {
  WorkbenchHost,
  WorkbenchLibrary,
  WorkbenchMatchResult,
} from "@zotlit/workbench/ui";

import type { ViewRegistryHandle } from "@/lib/view-atoms";
import { QueryService } from "@/services/item-query/service";
import {
  resolveLibraryScope,
  selectorKey,
} from "@/services/library-scope/scope";
import {
  matchesRequest,
  readMatches,
} from "@/services/profile-selection/match-query";
import { ZoteroReads } from "@/services/zotero-reads/service";
import { readerText } from "@/views/query-view/reader-diagnostic";
import type { ReaderDiagnosticSource } from "@/views/query-view/reader-diagnostic";

import { makeWorkbenchCommand, makeWorkbenchTask } from "./command";
import { getSampleItem } from "./selection-data";

export function createMatchData(
  registry: ViewRegistryHandle,
): WorkbenchHost["matchData"] & Disposable {
  // The Workbench shows the Match pane twice, and each copy reads at once.
  const shared = { concurrent: true };
  const tags = makeWorkbenchTask(
    registry,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const reads = yield* (yield* ZoteroReads).snapshot;
          return [...(yield* reads.TagNames({}))];
        }),
      ),

    shared,
  );
  const collections = makeWorkbenchTask(
    registry,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const reads = yield* (yield* ZoteroReads).snapshot;
          const libraries = resolveLibraryScope(yield* reads.Libraries({}), {
            mode: "all",
          }).available;
          const paths = yield* reads.CollectionPaths({
            libraryIDs: libraries.map(({ libraryID }) => libraryID),
          });
          return paths.map((path) => [...path]);
        }),
      ),

    shared,
  );
  const libraries = makeWorkbenchTask(
    registry,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const reads = yield* (yield* ZoteroReads).snapshot;
          return resolveLibraryScope(yield* reads.Libraries({}), {
            mode: "all",
          }).available.map((library) => ({
            id: selectorKey(library.selector) as WorkbenchLibrary["id"],
            ...(library.name === null ? {} : { name: library.name }),
          }));
        }),
      ),

    shared,
  );
  const matches = makeWorkbenchCommand(
    registry,
    (input: { indexedKey: string; filter: string }) =>
      testMatch(input.indexedKey, input.filter),
    shared,
  );
  const customFields = makeWorkbenchCommand(
    registry,
    (signal: AbortSignal) =>
      Effect.raceFirst(
        Effect.gen(function* () {
          return yield* (yield* QueryService).customFieldNames;
        }),
        Effect.callback<never>((resume) => {
          const abort = () => resume(Effect.interrupt);
          signal.addEventListener("abort", abort, { once: true });
          return Effect.sync(() => signal.removeEventListener("abort", abort));
        }),
      ),

    shared,
  );
  return {
    tags: () => tags.run(),
    collections: () => collections.run(),
    libraries: () => libraries.run(),
    matches: (indexedKey, filter) => matches.run({ indexedKey, filter }),
    customFields: (signal) =>
      signal.aborted
        ? Promise.resolve([])
        : customFields.run(signal).catch((error: unknown) => {
            if (signal.aborted) return [];
            throw error;
          }),
    [Symbol.dispose]() {
      for (const command of [
        tags,
        collections,
        libraries,
        matches,
        customFields,
      ])
        command[Symbol.dispose]();
    },
  };
}

/**
 * Whether the Item matches `filter`, as Profile selection tests it: a sample
 * Item in memory, from its seed, and a real Item through ZotLit Query.
 */
const testMatch = Effect.fn("TemplateWorkbench.testMatch")(function* (
  indexedKey: string,
  filter: string,
): Effect.fn.Return<WorkbenchMatchResult, unknown, QueryService> {
  const planned = planItemFilter(filter);
  if (!("matches" in planned)) return problem(planned);
  const sample = getSampleItem(indexedKey);
  if (sample) {
    if (!sample.seed) return { kind: "missing" };
    const answer = testItemSeed(filter, sample.seed);
    return answer.kind === "problem" ? problem(answer.diagnostic) : answer;
  }
  const parsed = parseIndexedKey(indexedKey);
  if (!parsed) return { kind: "missing" };
  const query = yield* QueryService;
  const answer = readMatches(
    yield* query.run(matchesRequest([parsed], [filter])),
    [filter],
  );
  if (answer.kind === "failed")
    return answer.diagnostic ? problem(answer.diagnostic) : { kind: "missing" };
  const row = answer.byKey.get(formatIndexedKey(parsed.key, parsed.groupID));
  if (!row) return { kind: "missing" };
  const fault = row.faults[0];
  return fault
    ? problem(fault)
    : { kind: "result", matched: row.matched[0] === true };
});

/** A Diagnostic as the Match tab shows it, on its condition where it has one. */
function problem(
  diagnostic: ReaderDiagnosticSource & {
    location?: { span?: { from: number; to: number } };
  },
): WorkbenchMatchResult {
  return {
    kind: "problem",
    message: readerText(diagnostic),
    ...(diagnostic.location?.span ? { span: diagnostic.location.span } : {}),
  };
}
