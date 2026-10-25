import { Effect, Layer } from "effect";

import * as m from "@/lib/i18n/generated/messages";
import { PluginHost } from "@/lib/plugin-host";

import { Release } from "./service";

/** The command that reopens the Release Note for the current version. */
export const layerReleaseActions: Layer.Layer<
  never,
  never,
  PluginHost | Release
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const release = yield* Release;
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    yield* host.addCommand({
      id: "open-release-note",
      name: m.command_open_release_note_name(),
      callback: () => void runPromise(release.openReleaseNote()),
    });
  }),
);
