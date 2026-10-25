// The worker owns the full citation maps and publishes requested projections.
import { Effect, Fiber, Option, Ref, Scope, Stream } from "effect";

import {
  formatIndexedKey,
  getLastItemID,
  getCitekeyWindow,
  getLibraries,
  getAnnotationParentKeys,
  resolveIndexedKeyLibraryIn,
} from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";

import { withLogCategory } from "@/lib/effect-log-category";
import type {
  CitationLookupRequest,
  CitationLookupWireAnswer,
  AnnotationParent,
} from "@/services/citation-index/lookup";
import { CitekeySnapshot } from "@/services/citation-index/snapshot";
import { resolveLibraryScope } from "@/services/library-scope/scope";
import type { LibraryScope } from "@/services/library-scope/scope";

import { toDbUnavailable } from "./connection";
import type { Connection } from "./connection";
import type { DbUnavailable } from "./rpc";

export const CITEKEY_WINDOW = 1000;

interface Published {
  client: NodeDatabaseClient;
  database: number;
  scope: string;
  snapshot: CitekeySnapshot;
  revision: string;
}

interface Candidate {
  fiber: Fiber.Fiber<void, DbUnavailable>;
  client?: NodeDatabaseClient;
}

export const makeCitationLookup = Effect.fnUntraced(function* (
  connection: Connection["Service"],
  windowSize: number,
) {
  const lifetime = yield* Scope.Scope;
  const incarnation = crypto.randomUUID();
  const serial = yield* Ref.make(0);
  const published = yield* Ref.make<Published | undefined>(undefined);
  const candidate = yield* Ref.make<Candidate | undefined>(undefined);

  const build = Effect.fnUntraced(function* (
    scope: LibraryScope | null,
    borrowed: Pick<Candidate, "client">,
  ) {
    const client = yield* connection.borrow;
    borrowed.client = client;
    const database = connection.databaseGeneration(client);
    const before = yield* Ref.get(published);
    const previous =
      before?.database === database ? before.snapshot : undefined;
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
    const retained = snapshot === previous && before !== undefined;
    const revision =
      snapshot === previous && before
        ? before.revision
        : `${incarnation}:${yield* Ref.updateAndGet(serial, (n) => n + 1)}`;
    yield* Ref.set(published, {
      client,
      database,
      scope: JSON.stringify(scope),
      snapshot,
      revision,
    });
    yield* Effect.logDebug("Citation lookup published").pipe(
      Effect.annotateLogs({ revision, retained, database }),
      withLogCategory("citation-index"),
    );
  });

  const lookup = Effect.fnUntraced(function* (
    request: CitationLookupRequest & { scope: LibraryScope | null },
  ): Effect.fn.Return<CitationLookupWireAnswer, DbUnavailable> {
    const scope = JSON.stringify(request.scope);
    while (true) {
      const answer = yield* Effect.scoped(
        Effect.gen(function* () {
          const client = yield* connection.borrow;
          const current = yield* Ref.get(published);
          if (current?.client === client && current.scope === scope) {
            const annotationKeys = yield* Effect.try({
              try: () => {
                const answers = new Map<string, AnnotationParent | null>(
                  (request.annotationKeys ?? []).map((key) => [key, null]),
                );
                if (answers.size === 0) return answers;
                const libraries = getLibraries(client);
                const identities = [...answers.keys()].flatMap((indexedKey) => {
                  const identity = resolveIndexedKeyLibraryIn(
                    libraries,
                    indexedKey,
                  );
                  return identity ? [{ ...identity, indexedKey }] : [];
                });
                for (const [libraryID, keys] of Map.groupBy(
                  identities,
                  (identity) => identity.libraryID,
                )) {
                  const groupID = libraries.find(
                    (library) => library.libraryID === libraryID,
                  )?.groupID;
                  const parents = new Map(
                    getAnnotationParentKeys(
                      client,
                      keys.map(({ key }) => key),
                      libraryID,
                    ).map(({ key, parentKey }) => [
                      key,
                      formatIndexedKey(parentKey, groupID),
                    ]),
                  );
                  for (const { key, indexedKey } of keys) {
                    const parentKey = parents.get(key);
                    if (parentKey !== undefined)
                      answers.set(indexedKey, {
                        indexedKey: parentKey,
                        citekey: current.snapshot.citekeyOf(parentKey),
                      });
                  }
                }
                return answers;
              },
              catch: toDbUnavailable,
            });
            if (
              annotationKeys.size > 0 &&
              (yield* Effect.scoped(connection.borrow)) !== client
            )
              return null;
            return {
              revision: current.revision,
              annotationKeys,
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
          return null;
        }),
      );
      if (answer !== null) return answer;
      // A caller owns only its wait. The worker lifetime owns the shared build
      // and its connection borrow, even if the initiating caller cancels.
      const running = yield* Effect.uninterruptible(
        Effect.suspend(() =>
          Effect.gen(function* () {
            const current = yield* Ref.get(candidate);
            if (current) return current;
            const borrowed: Pick<Candidate, "client"> = {};
            const fiber = yield* Effect.forkIn(
              Effect.scoped(build(request.scope, borrowed)).pipe(
                Effect.ensuring(Ref.set(candidate, undefined)),
              ),
              lifetime,
              { startImmediately: false },
            );
            const next = Object.assign(borrowed, { fiber });
            yield* Ref.set(candidate, next);
            return next;
          }),
        ),
      );
      const result = yield* Effect.result(Fiber.join(running.fiber));
      if (result._tag === "Failure") {
        const currentClient = yield* Effect.scoped(connection.borrow);
        if (running.client === undefined || running.client === currentClient)
          return yield* result.failure;
      }
    }
  });
  return { lookup };
});
