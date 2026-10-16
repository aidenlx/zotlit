import { parseIndexedKey } from "@zotlit/db";
import { planItemFilter, testItemSeed } from "@zotlit/item-query";
import type {
  WorkbenchHost,
  WorkbenchLibrary,
  WorkbenchMatchResult,
} from "@zotlit/workbench/ui";

// Match vocabulary spans every Library in the pinned live database.
import { Effect } from "@/lib/effect";
import type { QueryService } from "@/services/item-query/service";
import {
  resolveLibraryScope,
  selectorKey,
} from "@/services/library-scope/scope";
import { testItemMatches } from "@/services/profile-selection";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";
import { readerText } from "@/views/query-view/reader-diagnostic";
import type { ReaderDiagnosticSource } from "@/views/query-view/reader-diagnostic";

import { getSampleItem } from "./selection-data";

export function createMatchData(
  db: Pick<ZoteroReadsService, "acquireRead">,
  query: Pick<QueryService, "run"> | undefined,
): WorkbenchHost["matchData"] {
  return {
    async tags() {
      await using lease = await db.acquireRead();
      return [...(await Effect.runPromise(lease.reads.TagNames({})))];
    },
    async collections() {
      await using lease = await db.acquireRead();
      const libraries = resolveLibraryScope(
        await Effect.runPromise(lease.reads.Libraries({})),
        { mode: "all" },
      ).available;
      const paths = await Effect.runPromise(
        lease.reads.CollectionPaths({
          libraryIDs: libraries.map(({ libraryID }) => libraryID),
        }),
      );
      return paths.map((path) => [...path]);
    },
    async libraries() {
      await using lease = await db.acquireRead();
      return resolveLibraryScope(
        await Effect.runPromise(lease.reads.Libraries({})),
        { mode: "all" },
      ).available.map((library) => ({
        id: selectorKey(library.selector) as WorkbenchLibrary["id"],
        ...(library.name === null ? {} : { name: library.name }),
      }));
    },
    matches: (indexedKey, filter) => testMatch(query, indexedKey, filter),
  };
}

/**
 * Whether the Item matches `filter`, as Profile selection tests it: a sample
 * Item in memory, from its seed, and a real Item through ZotLit Query.
 */
async function testMatch(
  query: Pick<QueryService, "run"> | undefined,
  indexedKey: string,
  filter: string,
): Promise<WorkbenchMatchResult> {
  const planned = planItemFilter(filter);
  if (!("matches" in planned)) return problem(planned);
  const sample = getSampleItem(indexedKey);
  if (sample) {
    if (!sample.seed) return { kind: "missing" };
    const answer = testItemSeed(filter, sample.seed);
    return answer.kind === "problem" ? problem(answer.diagnostic) : answer;
  }
  const parsed = parseIndexedKey(indexedKey);
  if (!parsed || !query) return { kind: "missing" };
  const answer = await testItemMatches(query, parsed, [filter]);
  if (answer.kind === "missing") return answer;
  const fault = answer.kind === "failed" ? answer.diagnostic : answer.faults[0];
  if (fault) return problem(fault);
  if (answer.kind === "failed") return { kind: "missing" };
  return { kind: "result", matched: answer.matched[0] === true };
}

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
