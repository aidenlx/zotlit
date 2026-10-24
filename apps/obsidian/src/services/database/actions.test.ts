import { createMockPlugin } from "@mock/obsidian";
import type { Command } from "obsidian";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { Effect, Layer } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";
import { PluginHost } from "@/lib/plugin-host";
import type { PluginHostShape } from "@/lib/plugin-host";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import { ZoteroReads } from "@/services/zotero-reads/service";

import { layerDatabaseActions } from "./actions";

const REFRESH_COMMAND = "refresh-zotero-data";

function layerCommand(refresh: ZoteroReads["Service"]["refresh"]) {
  return Effect.gen(function* () {
    const plugin = createMockPlugin();
    const host = stubService<PluginHostShape>("PluginHost", {
      addCommand: (command) => plugin.addCommand(command),
    });
    const reads = stubService<ZoteroReads["Service"]>("ZoteroReads", {
      refresh,
    });

    yield* Layer.build(
      layerDatabaseActions.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(PluginHost, host),
            Layer.succeed(ZoteroReads, reads),
          ),
        ),
      ),
    );

    const command = plugin.commands.get(REFRESH_COMMAND);
    if (!command) throw new Error(`${REFRESH_COMMAND} was not registered`);
    return command;
  });
}

async function run(command: Command): Promise<void> {
  if (!command.callback) throw new Error("The command has no callback");
  await command.callback();
}

describe("database refresh action", () => {
  beforeEach(() => {
    vi.stubGlobal("sleep", () => Promise.resolve());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.effect("registers the command and refreshes once when run", () =>
    Effect.gen(function* () {
      const refresh = vi.fn(() => Effect.void);
      const command = yield* layerCommand(refresh);

      expect(command.id).toBe(REFRESH_COMMAND);
      expect(refresh).not.toHaveBeenCalled();
      yield* Effect.promise(() => run(command));
      expect(refresh).toHaveBeenCalledOnce();
    }),
  );

  it.effect("swallows DbUnavailable", () =>
    Effect.gen(function* () {
      const refresh = vi.fn(() =>
        Effect.fail(new DbUnavailable({ message: "database unavailable" })),
      );
      const command = yield* layerCommand(refresh);

      yield* Effect.promise(() => run(command));
      expect(refresh).toHaveBeenCalledOnce();
    }),
  );

  it.effect("swallows an interrupted refresh", () =>
    Effect.gen(function* () {
      const refresh = vi.fn(() => Effect.interrupt);
      const command = yield* layerCommand(refresh);

      yield* Effect.promise(() => run(command));
      expect(refresh).toHaveBeenCalledOnce();
    }),
  );

  it.effect("rethrows any other error", () =>
    Effect.gen(function* () {
      const failure = new Error("refresh failed");
      const command = yield* layerCommand(() => Effect.die(failure));

      const error = yield* Effect.promise(() =>
        run(command).then(
          () => null,
          (error: unknown) => error,
        ),
      );
      expect(error).toBe(failure);
    }),
  );
});
