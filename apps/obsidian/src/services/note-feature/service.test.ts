import { it } from "@effect/vitest";
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Scope,
  Stream,
} from "effect";
import { TFile } from "obsidian";
import { describe, expect } from "vitest";

import type { Item } from "@zotlit/db";

import { MemoryFileManager } from "@/lib/__fixtures__/obsidian-file-manager";
import { createObsidianHost } from "@/lib/__fixtures__/obsidian-host";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { Vault } from "@/lib/obsidian-vault";
import { NoteIndex } from "@/services/note-index/service";
import { readsAnswering } from "@/services/zotero-reads/__fixtures__";

import { noteFeatureServices } from "./__fixtures__/note-feature";
import type { NoteFeatureSources } from "./__fixtures__/note-feature";
import { NoteWriteAborted } from "./errors";
import { layerNoteFeature, makeCreateGate, NoteFeature } from "./service";
import type { CreateNoteResult } from "./types";

const ITEM = stubService<Item>("Item", { itemID: 1, indexedKey: "ABCD2345" });

function noteAt(path: string): TFile {
  const file = new TFile();
  file.path = path;
  return file;
}

/** What the gate reads to refuse a note created before the Note Index saw it. */
const gateServices = Layer.mergeAll(
  Layer.mock(NoteIndex, { getNotesByItemKey: () => Effect.succeed([]) }),
  Layer.mock(Vault, { getAbstractFileByPath: () => Effect.succeed(null) }),
  Layer.mock(MetadataCache, {}),
);

describe("the create gate", () => {
  it.effect(
    "makes a create for a key in progress wait, then refuses it for the note the first created",
    () =>
      Effect.gen(function* () {
        const release = yield* Deferred.make<void>();
        const file = noteAt("Paper.md");
        const gate = yield* makeCreateGate((_item, options) =>
          Effect.gen(function* () {
            yield* Deferred.await(release);
            yield* options.onFileCreated(file);
            return { outcome: "created", file } satisfies CreateNoteResult;
          }),
        );
        const first = yield* gate(ITEM, {}).pipe(
          Effect.forkChild({ startImmediately: true }),
        );
        const second = yield* gate(ITEM, {}).pipe(
          Effect.forkChild({ startImmediately: true }),
        );
        yield* Deferred.succeed(release, undefined);

        expect(yield* Fiber.join(first)).toEqual({ outcome: "created", file });
        expect(yield* Fiber.join(second)).toMatchObject({
          outcome: "refused",
        });
      }).pipe(Effect.provide(gateServices)),
  );

  it.effect(
    "fails a waiting create with the failure of the one it waited on",
    () =>
      Effect.gen(function* () {
        const release = yield* Deferred.make<void>();
        const failure = new NoteWriteAborted({
          path: "Paper.md",
          cause: new Error("Render failed"),
        });
        const gate = yield* makeCreateGate(() =>
          Deferred.await(release).pipe(Effect.andThen(Effect.fail(failure))),
        );
        const first = yield* gate(ITEM, {}).pipe(
          Effect.forkChild({ startImmediately: true }),
        );
        const second = yield* gate(ITEM, {}).pipe(
          Effect.forkChild({ startImmediately: true }),
        );
        yield* Deferred.succeed(release, undefined);

        expect(yield* Fiber.await(first)).toStrictEqual(Exit.fail(failure));
        expect(yield* Fiber.await(second)).toStrictEqual(Exit.fail(failure));
      }).pipe(Effect.provide(gateServices)),
  );

  it.effect(
    "frees the key of an interrupted create, and runs the create that waited on it",
    () =>
      Effect.gen(function* () {
        const file = noteAt("Paper.md");
        let writes = 0;
        const gate = yield* makeCreateGate(() =>
          Effect.suspend(() =>
            ++writes === 1
              ? Effect.never
              : Effect.succeed({
                  outcome: "created",
                  file,
                } satisfies CreateNoteResult),
          ),
        );
        const first = yield* gate(ITEM, {}).pipe(
          Effect.forkChild({ startImmediately: true }),
        );
        const waiting = yield* gate(ITEM, {}).pipe(
          Effect.forkChild({ startImmediately: true }),
        );
        yield* Fiber.interrupt(first);

        // The waiter did not ask to stop: it enters the gate again.
        expect(yield* Fiber.join(waiting)).toEqual({
          outcome: "created",
          file,
        });
        expect(writes).toBe(2);
      }).pipe(Effect.provide(gateServices)),
  );
});

describe("NoteFeature.changes", () => {
  it.effect("delivers what is reported, and ends when the layer closes", () =>
    Effect.gen(function* () {
      const host = createObsidianHost();
      const reads = readsAnswering({});
      const sources = stubService<NoteFeatureSources>("NoteFeatureSources", {
        zoteroReads: { reads, snapshot: Effect.succeed(reads) },
        app: {
          ...host.app,
          fileManager: new MemoryFileManager(),
        },
      });
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        layerNoteFeature.pipe(Layer.provide(noteFeatureServices(sources))),
        scope,
      );
      const feature = Context.get(context, NoteFeature);
      const heard = yield* Stream.runCollect(feature.changes).pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Effect.yieldNow;
      const summary = { zotero: 1, unchecked: 0, unavailable: 0 };
      yield* feature.reportExcerptImages(summary);
      yield* Scope.close(scope, Exit.void);

      expect(yield* Fiber.join(heard)).toEqual([
        { _tag: "excerpt-images-reported", payload: summary },
      ]);
    }),
  );
});
