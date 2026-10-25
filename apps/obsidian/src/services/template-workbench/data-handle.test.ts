import { it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import { expect, vi } from "vitest";

import type { Library } from "@zotlit/db";

import { stubService } from "@/lib/__fixtures__/service-stub";
import type { EffectBridge } from "@/lib/effect-bridge";
import {
  MY_LIBRARY_SCOPE,
  resolveLibraryScope,
} from "@/services/library-scope/scope";
import { LibraryScope } from "@/services/library-scope/service";
import { NoteIndex } from "@/services/note-index/service";
import { defaults } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";
import { layerRcRef } from "@/services/zotero-reads/connection";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import { layerZoteroReads, ZoteroReads } from "@/services/zotero-reads/service";
import {
  inProcessClient,
  memoryOpener,
} from "@/services/zotero-reads/test-utils";

import { workbenchContext } from "./__fixtures__";
import { bindTemplateData } from "./data-handle";

/** My Library, which holds no item. */
const SEED = `
  insert into version (schema, version) values ('userdata', 129);
  insert into libraries (libraryID, type, version, clientVersion)
    values (1, 'user', 1, 1);
`;

/**
 * The handle over `reads`, with plugin settings that count their reads and a
 * Library Scope that records the libraries it resolves.
 */
function handle(reads: Context.Context<ZoteroReads>) {
  const runs = { count: 0 };
  const runPromise: EffectBridge["runPromise"] = (effect) => {
    runs.count += 1;
    return Effect.runPromise(effect);
  };
  const settingsReads = { count: 0 };
  const resolveLibraries = vi.fn((libraries: readonly Library[]) =>
    Effect.sync(() => resolveLibraryScope(libraries, MY_LIBRARY_SCOPE)),
  );
  const templateData = bindTemplateData(
    { runPromise },
    Context.merge(
      workbenchContext(
        reads,
        Context.make(
          PluginSettings,
          stubService<PluginSettings["Service"]>("PluginSettings", {
            current: Effect.sync(() => {
              settingsReads.count += 1;
              return defaults;
            }),
          }),
        ),
        Context.make(
          NoteIndex,
          stubService<NoteIndex["Service"]>("NoteIndex", {
            whenIndexed: Effect.void,
          }),
        ),
      ),
      Context.make(
        LibraryScope,
        stubService<LibraryScope["Service"]>("LibraryScope", {
          resolveLibraries,
        }),
      ),
    ),
  );
  return { templateData, runs, settingsReads, resolveLibraries };
}

/** Zotero reads over a database that holds My Library alone. */
const memoryReads = Layer.build(
  layerZoteroReads(inProcessClient(layerRcRef(memoryOpener(() => SEED).open))),
);

it.effect(
  "loads through the bridge, reading the given settings in place of the plugin's",
  () =>
    Effect.gen(function* () {
      const { templateData, runs, settingsReads } = handle(yield* memoryReads);

      expect(
        yield* Effect.promise(() => templateData.load("ABCD2345", "note")),
      ).toEqual({ kind: "not-found" });
      expect(settingsReads.count).toBe(1);
      expect(
        yield* Effect.promise(() =>
          templateData.load("ABCD2345", "note", { settings: defaults }),
        ),
      ).toEqual({ kind: "not-found" });
      expect(settingsReads.count).toBe(1);
      expect(runs.count).toBe(2);
    }),
);

it.effect("rejects with what failed to read the data", () =>
  Effect.gen(function* () {
    const unavailable = new DbUnavailable({ message: "Unavailable" });
    const { templateData } = handle(
      Context.make(
        ZoteroReads,
        stubService<ZoteroReads["Service"]>("ZoteroReads", {
          snapshot: Effect.fail(unavailable),
        }),
      ),
    );

    const rejected = (load: () => Promise<unknown>) =>
      Effect.promise(() =>
        load().then(
          () => undefined,
          (error) => error,
        ),
      );
    expect(yield* rejected(() => templateData.load("ABCD2345", "note"))).toBe(
      unavailable,
    );
    expect(
      yield* rejected(() =>
        templateData.loadCitation({ key: "ABCD2345" }, "main"),
      ),
    ).toBe(unavailable);
  }),
);

it.effect("reads the verification data over the bound Library Scope", () =>
  Effect.gen(function* () {
    const { templateData, resolveLibraries } = handle(yield* memoryReads);

    expect(
      yield* Effect.promise(() =>
        templateData.verificationData({ annotation: false }),
      ),
    ).toBeNull();
    expect(resolveLibraries).toHaveBeenCalledOnce();
  }),
);
