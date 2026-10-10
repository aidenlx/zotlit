// The worker owns the full citation maps and publishes requested projections.
import { Effect, Fiber, Option, Scope, Stream } from "effect";

import { getCitekeyLastItemID, getCitekeyPage, getLibraries } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";

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

interface Published {
  client: NodeDatabaseClient;
  database: number;
  scope: string;
  snapshot: CitekeySnapshot;
  revision: string;
}

export const makeCitationLookup = Effect.fnUntraced(function* (
  connection: Connection["Service"],
  sliceSize: number,
) {
  const lifetime = yield* Scope.Scope;
  const incarnation = crypto.randomUUID();
  let serial = 0;
  let published: Published | undefined;
  let candidate: Fiber.Fiber<Published, DbUnavailable> | undefined;

  const build = Effect.fnUntraced(function* (scope: LibraryScope | null) {
    const client = yield* connection.borrow;
    const database = connection.databaseGeneration(client);
    const previous =
      published?.database === database ? published.snapshot : undefined;
    const libraries = yield* Effect.try({
      try: () => getLibraries(client),
      catch: toDbUnavailable,
    });
    const all = resolveLibraryScope(libraries, { mode: "all" });
    const selected = resolveLibraryScope(libraries, scope);
    const rows = Stream.fromIterable(all.available).pipe(
      Stream.flatMap(({ libraryID }) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const beforeItemID = yield* Effect.try({
              try: () => getCitekeyLastItemID(client, libraryID),
              catch: toDbUnavailable,
            });
            return Stream.paginate(
              0,
              Effect.fnUntraced(function* (afterItemID) {
                yield* Effect.yieldNow;
                const { citekeys, next } = yield* Effect.try({
                  try: () =>
                    getCitekeyPage(client, {
                      libraryID,
                      beforeItemID,
                      afterItemID,
                      limit: sliceSize,
                    }),
                  catch: toDbUnavailable,
                });
                return [citekeys, Option.fromNullishOr(next)] as const;
              }),
            );
          }),
        ),
      ),
    );
    const snapshot = yield* CitekeySnapshot.from(
      rows,
      new Set(selected.available.map(({ libraryID }) => libraryID)),
      { previous },
    ).pipe(Effect.catchDefect((cause) => Effect.fail(toDbUnavailable(cause))));
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
    return published;
  });

  return Effect.fnUntraced(function* (
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
});
