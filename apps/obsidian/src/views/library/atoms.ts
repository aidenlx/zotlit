// Leaf-owned Library gestures that read the plugin's Effect services.
import { Effect, Exit } from "effect";

import { recover } from "@/lib/effect-cause";
import { withLogCategory } from "@/lib/effect-log";
import { viewRuntime } from "@/lib/view-atoms";
import { QueryService } from "@/services/item-query/service";
import { LibraryScope } from "@/services/library-scope/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

import type { LibraryNode } from "./document";
import { libraryOf, sameLibrary } from "./tree";

export const makeItemNodeCommand = () =>
  viewRuntime.fn(
    (request: {
      readonly indexedKey: string;
      readonly result: PromiseWithResolvers<LibraryNode | null>;
    }) =>
      Effect.gen(function* () {
        const { indexedKey } = request;
        const library = libraryOf(indexedKey);
        if (!library) return null;
        const libraries = yield* (yield* LibraryScope).libraries;
        const libraryID = libraries.find(({ selector }) =>
          sameLibrary(selector, library),
        )?.libraryID;
        if (libraryID === undefined) return null;
        const outcome = yield* (yield* QueryService).run({
          from: "items",
          filter: `${JSON.stringify([indexedKey])}.contains(indexedKey)`,
          fields: ["collections"],
          limit: 1,
          libraries: { mode: "selected", libraries: [library] },
        });
        const filed =
          outcome.kind === "result"
            ? outcome.result.rows?.[0]?.values.collections
            : undefined;
        const first = Array.isArray(filed) ? filed[0] : undefined;
        if (typeof first !== "string")
          return { kind: "library", library } satisfies LibraryNode;
        const snapshot = yield* (yield* ZoteroReads).snapshot;
        const paths = yield* snapshot.CollectionPaths({
          libraryIDs: [libraryID],
        });
        const path = paths.find((names) => names.join("/") === first);
        return path
          ? ({ kind: "collection", library, path } satisfies LibraryNode)
          : ({ kind: "library", library } satisfies LibraryNode);
      }).pipe(
        Effect.scoped,
        recover(
          (error) =>
            Effect.logWarning(
              "The Library View could not find an Item's Collection",
              { indexedKey: request.indexedKey, error },
            ),
          Effect.succeed(null),
        ),
        Effect.onExit((exit) =>
          Effect.sync(() =>
            request.result.resolve(Exit.isSuccess(exit) ? exit.value : null),
          ),
        ),
        withLogCategory("library-view"),
      ),
  );
