import { it } from "@effect/vitest";
import { Effect, Layer, Logger, ManagedRuntime, References } from "effect";
import { describe, expect } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { LogCategory } from "@/lib/effect-log";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type {
  ZoteroReadsApi,
  ZoteroReadsState,
} from "@/services/zotero-reads/service";

import { libraryTagNames, libraryTagNamesOf } from "./library-tag-names";

interface Logged {
  level: string;
  category: readonly string[];
  annotations: Readonly<Record<string, unknown>>;
}

/** A Logger layer that records each Effect log record it is given. */
function captureLogs() {
  const logged: Logged[] = [];
  const layer = Logger.layer([
    Logger.make(({ logLevel, fiber }) => {
      logged.push({
        level: logLevel,
        category: fiber.getRef(LogCategory),
        annotations: fiber.getRef(References.CurrentLogAnnotations),
      });
    }),
  ]);
  return { logged, layer };
}

const WARNING = { level: "Warn", category: ["database", "library-tag-names"] };

const GROUP_KEY = "ABCD2345g42";

const ready: ZoteroReadsState = {
  state: "ready",
  error: null,
  moved: false,
  dbFileMissing: false,
  activeReadMode: null,
};

const degraded: ZoteroReadsState = {
  ...ready,
  state: "degraded",
};

function readsOf(
  current: ZoteroReadsState,
  snapshot: ZoteroReadsApi,
): ZoteroReads["Service"] {
  return stubService<ZoteroReads["Service"]>("ZoteroReads", {
    current: Effect.succeed(current),
    snapshot: Effect.succeed(snapshot),
  });
}

function snapshotOf(
  libraries: () => Effect.Effect<
    readonly { libraryID: number; groupID: number | null }[],
    DbUnavailable
  >,
  tagNames = (): Effect.Effect<readonly string[], DbUnavailable> =>
    Effect.succeed([]),
): {
  api: ZoteroReadsApi;
  libraryCalls: object[];
  tagNameCalls: object[];
} {
  const libraryCalls: object[] = [];
  const tagNameCalls: object[] = [];
  return {
    api: stubService<ZoteroReadsApi>("ZoteroReadsApi", {
      Libraries: ((input: Parameters<ZoteroReadsApi["Libraries"]>[0]) => {
        libraryCalls.push(input);
        return libraries();
      }) as unknown as ZoteroReadsApi["Libraries"],
      TagNames: ((input: Parameters<ZoteroReadsApi["TagNames"]>[0]) => {
        tagNameCalls.push(input);
        return tagNames();
      }) as unknown as ZoteroReadsApi["TagNames"],
    }),
    libraryCalls,
    tagNameCalls,
  };
}

describe("libraryTagNames", () => {
  it.effect("returns no tags while the database is degraded", () =>
    Effect.gen(function* () {
      const snapshot = snapshotOf(() => Effect.succeed([]));

      expect(
        yield* libraryTagNames(readsOf(degraded, snapshot.api), GROUP_KEY),
      ).toEqual([]);
      expect(snapshot.libraryCalls).toEqual([]);
    }),
  );

  it.effect("returns no tags and warns when a read fails", () =>
    Effect.gen(function* () {
      const failure = new DbUnavailable({ message: "database unavailable" });
      const snapshot = snapshotOf(() => Effect.fail(failure));
      const { logged, layer } = captureLogs();

      expect(
        yield* libraryTagNames(readsOf(ready, snapshot.api), GROUP_KEY).pipe(
          Effect.provide(layer),
        ),
      ).toEqual([]);
      expect(logged).toEqual([
        {
          ...WARNING,
          annotations: { annotationKey: GROUP_KEY, error: failure },
        },
      ]);
    }),
  );

  it.effect("returns no tags and warns when a read dies", () =>
    Effect.gen(function* () {
      const defect = new Error("read crashed");
      const snapshot = snapshotOf(() => Effect.die(defect));
      const { logged, layer } = captureLogs();

      expect(
        yield* libraryTagNames(readsOf(ready, snapshot.api), GROUP_KEY).pipe(
          Effect.provide(layer),
        ),
      ).toEqual([]);
      expect(logged).toEqual([
        {
          ...WARNING,
          annotations: { annotationKey: GROUP_KEY, error: defect },
        },
      ]);
    }),
  );

  it.effect("returns the tag names for the Annotation's library", () =>
    Effect.gen(function* () {
      const snapshot = snapshotOf(
        () => Effect.succeed([{ libraryID: 7, groupID: 42 }]),
        () => Effect.succeed(["history", "method"]),
      );

      expect(
        yield* libraryTagNames(readsOf(ready, snapshot.api), GROUP_KEY),
      ).toEqual(["history", "method"]);
      expect(snapshot.libraryCalls).toEqual([{}]);
      expect(snapshot.tagNameCalls).toEqual([{ libraryID: 7 }]);
    }),
  );
});

it.effect("libraryTagNamesOf resolves an empty list after disposal", () =>
  Effect.gen(function* () {
    let open = true;
    const snapshot = snapshotOf(
      () =>
        open
          ? Effect.succeed([{ libraryID: 7, groupID: 42 }])
          : Effect.fail(new DbUnavailable({ message: "closed" })),
      () => Effect.succeed(["history"]),
    );
    const reads = readsOf(ready, snapshot.api);
    const { logged, layer } = captureLogs();
    const runtime = ManagedRuntime.make(
      Layer.mergeAll(
        Layer.effect(
          ZoteroReads,
          Effect.acquireRelease(Effect.succeed(reads), () =>
            Effect.sync(() => {
              open = false;
            }),
          ),
        ),
        layer,
      ),
    );
    yield* Effect.promise(() => runtime.context());
    const tagsOf = libraryTagNamesOf(runtime);

    expect(yield* Effect.promise(() => tagsOf(GROUP_KEY))).toEqual(["history"]);

    yield* runtime.disposeEffect;

    expect(yield* Effect.promise(() => tagsOf(GROUP_KEY))).toEqual([]);
    expect(logged).toEqual([
      {
        ...WARNING,
        annotations: {
          annotationKey: GROUP_KEY,
          error: expect.any(DbUnavailable),
        },
      },
    ]);
  }),
);
