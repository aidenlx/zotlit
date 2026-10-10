// The worker owns the full citation maps and publishes requested projections.
import { Effect, Fiber, Option, Scope, Stream } from "effect";

import {
  formatIndexedKey,
  getLastItemID,
  getCitekeyWindow,
  getLibraries,
} from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";

import { getLogger } from "@/lib/log";
import type {
  CitationLookupRequest,
  CitationLookupWireAnswer,
} from "@/services/citation-index/lookup";
import { CitekeySnapshot } from "@/services/citation-index/snapshot";
import { resolveLibraryScope } from "@/services/library-scope/scope";
import type { LibraryScope } from "@/services/library-scope/scope";

import { toDbUnavailable } from "./connection";
import type { Connection } from "./connection";
import type { DbUnavailable } from "./rpc";

export const CITEKEY_WINDOW = 1000;

const logger = getLogger("citation-index");

interface Published {
  client: NodeDatabaseClient;
  database: number;
  scope: string;
  snapshot: CitekeySnapshot;
  revision: string;
}

export const makeCitationLookup = Effect.fnUntraced(function* (
  connection: Connection["Service"],
  windowSize: number,
) {
  const lifetime = yield* Scope.Scope;
  const incarnation = crypto.randomUUID();
  let serial = 0;
  let published: Published | undefined;
  let candidate: Fiber.Fiber<void, DbUnavailable> | undefined;

  const build = Effect.fnUntraced(function* (scope: LibraryScope | null) {
    const client = yield* connection.borrow;
    const database = connection.databaseGeneration(client);
    const previous =
      published?.database === database ? published.snapshot : undefined;
    const libraries = yield* Effect.try({
      try: () => getLibraries(client),
      catch: toDbUnavailable,
    });
    const selected = resolveLibraryScope(libraries, scope);
    const groupIDs = new Map(
      libraries.map(({ libraryID, groupID }) => [libraryID, groupID]),
    );
    const lastItemID = yield* Effect.try({
      try: () => getLastItemID(client),
      catch: toDbUnavailable,
    });
    const rows = Stream.paginate(
      0,
      Effect.fnUntraced(function* (afterItemID) {
        yield* Effect.yieldNow;
        const throughItemID = Math.min(afterItemID + windowSize, lastItemID);
        const citekeys = yield* Effect.try({
          try: () => getCitekeyWindow(client, { afterItemID, throughItemID }),
          catch: toDbUnavailable,
        });
        return [
          citekeys.map((row) => ({
            ...row,
            indexedKey: formatIndexedKey(
              row.key,
              groupIDs.get(row.libraryID) ?? null,
            ),
          })),
          throughItemID < lastItemID
            ? Option.some(throughItemID)
            : Option.none(),
        ] as const;
      }),
    );
    const snapshot = yield* CitekeySnapshot.from(
      rows,
      new Set(selected.available.map(({ libraryID }) => libraryID)),
      { previous },
    ).pipe(Effect.catchDefect((cause) => Effect.fail(toDbUnavailable(cause))));
    const retained = snapshot === previous && published !== undefined;
    const revision =
      snapshot === previous && published
        ? published.revision
        : `${incarnation}:${++serial}`;
    published = {
      client,
      database,
      scope: JSON.stringify(scope),
      snapshot,
      revision,
    };
    logger.debug("Citation lookup published", {
      revision,
      retained,
      database,
    });
  });

  const lookup = Effect.fnUntraced(function* (
    request: CitationLookupRequest & { scope: LibraryScope | null },
  ): Effect.fn.Return<CitationLookupWireAnswer, DbUnavailable> {
    const scope = JSON.stringify(request.scope);
    while (true) {
      const client = yield* Effect.scoped(connection.borrow);
      const current = published;
      if (current?.client === client && current.scope === scope) {
        return {
          revision: current.revision,
          citekeys: new Map(
            (request.citekeys ?? []).map((key) => [
              key,
              current.snapshot.resolve(key),
            ]),
          ),
          indexedKeys: new Map(
            (request.indexedKeys ?? []).map((key) => [
              key,
              current.snapshot.citekeyOf(key),
            ]),
          ),
        };
      }
      // A caller owns only its wait. The worker lifetime owns the shared build
      // and its connection borrow, even if the initiating caller cancels.
      const running = yield* Effect.uninterruptible(
        Effect.suspend(() => {
          if (candidate) return Effect.succeed(candidate);
          return Effect.map(
            Effect.forkIn(
              Effect.scoped(build(request.scope)).pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    candidate = undefined;
                  }),
                ),
              ),
              lifetime,
              { startImmediately: false },
            ),
            (fiber) => (candidate = fiber),
          );
        }),
      );
      yield* Fiber.join(running);
    }
  });
  return { lookup };
});
