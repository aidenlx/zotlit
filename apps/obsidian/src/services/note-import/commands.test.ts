import { it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Layer, Option } from "effect";
import type { App } from "obsidian";
import { describe, expect } from "vitest";

import { testPluginHost } from "@/lib/__fixtures__/plugin-host";
import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type {
  ZoteroReadsApi,
  ZoteroReadsState,
} from "@/services/zotero-reads/service";
import { unimplementedProfileDialogServices } from "@/setting-tab/__fixtures__";

import type { BatchImportPorts } from "./batch-import";
import {
  importAllNotes,
  importChildNotes,
  layerNoteImportCommands,
} from "./commands";
import { NoteImporter } from "./service";
import type { NoteImportView } from "./view";

const app = stubService<App>("App", {});
const ports: BatchImportPorts = {
  view: stubService<NoteImportView>("NoteImportView", {}),
  bridge: stubService<BatchImportPorts["bridge"]>("EffectBridge", {}),
};

/** The services an import reads: the database in `state`, its Snapshot `snapshot`. */
function servicesWith(
  state: ZoteroReadsState["state"],
  snapshot: ZoteroReads["Service"]["snapshot"],
) {
  return Layer.mergeAll(
    unimplementedProfileDialogServices,
    Layer.mock(MetadataCache, {}),
    Layer.mock(NoteImporter, {}),
    Layer.mock(ZoteroReads, {
      current: Effect.succeed(
        stubService<ZoteroReadsState>("ZoteroReadsState", { state }),
      ),
      reads: stubService<ZoteroReadsApi>("ZoteroReads.reads", {}),
      snapshot,
    }),
  );
}

const unavailable = new DbUnavailable({ message: "database unavailable" });

describe("Import all notes", () => {
  it.effect("answers the import's outcome", () =>
    Effect.gen(function* () {
      const result = yield* importAllNotes(ports, app).pipe(
        Effect.provide(servicesWith("loading", Effect.never)),
      );
      expect(result).toEqual({ outcome: "db-unavailable" });
    }),
  );

  it.effect("fails with the error the import failed with", () =>
    Effect.gen(function* () {
      const exit = yield* importAllNotes(ports, app).pipe(
        Effect.provide(servicesWith("ready", Effect.fail(unavailable))),
        Effect.exit,
      );
      expect(Option.getOrUndefined(Exit.findErrorOption(exit))).toBe(
        unavailable,
      );
    }),
  );

  it.effect("gives no outcome when it is interrupted", () =>
    Effect.gen(function* () {
      const fiber = yield* importAllNotes(ports, app).pipe(
        Effect.provide(servicesWith("ready", Effect.never)),
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
        true,
      );
    }),
  );
});

describe("Import child notes", () => {
  it.effect("answers the import's outcome", () =>
    Effect.gen(function* () {
      const result = yield* importChildNotes(ports, app, "ABCD2345").pipe(
        Effect.provide(servicesWith("loading", Effect.never)),
      );
      expect(result).toEqual({ outcome: "db-unavailable" });
    }),
  );

  it.effect("fails with the error the import failed with", () =>
    Effect.gen(function* () {
      const exit = yield* importChildNotes(ports, app, "ABCD2345").pipe(
        Effect.provide(servicesWith("ready", Effect.fail(unavailable))),
        Effect.exit,
      );
      expect(Option.getOrUndefined(Exit.findErrorOption(exit))).toBe(
        unavailable,
      );
    }),
  );

  it.effect("gives no outcome when it is interrupted", () =>
    Effect.gen(function* () {
      const fiber = yield* importChildNotes(ports, app, "ABCD2345").pipe(
        Effect.provide(servicesWith("ready", Effect.never)),
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
        true,
      );
    }),
  );
});

it.effect("registers both commands on the plugin while the layer is up", () =>
  Effect.gen(function* () {
    const host = testPluginHost({ app });
    yield* Layer.build(
      layerNoteImportCommands({ view: ports.view }).pipe(
        Layer.provide(
          Layer.merge(host.layer, servicesWith("loading", Effect.never)),
        ),
      ),
    );
    expect(host.commands.get("import-all-notes")?.name).toBe(
      m.command_import_all_notes_name(),
    );
    expect(host.commands.get("import-child-notes")?.name).toBe(
      m.command_import_child_notes_name(),
    );
  }),
);
