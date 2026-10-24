// A Local Server built from its layer over empty settings and dependency stubs.
import { stubService } from "@/lib/__fixtures__/service-stub";
import { Effect, Layer } from "@/lib/effect";
import { buildRuntime } from "@/lib/effect-layer";
import { NoteIndex } from "@/services/note-index/service";
import { applySettings } from "@/services/settings/__fixtures__";
import type { SettingsOverrides } from "@/services/settings/__fixtures__";
import {
  layerPluginSettings,
  PluginSettings,
} from "@/services/settings/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";

import { layerLocalServer, LocalServer } from "./service";

export async function buildLocalServer(
  overrides: SettingsOverrides,
  stack: AsyncDisposableStack,
) {
  const settingsLayer = layerPluginSettings({
    loadData: () => Promise.resolve(null),
    saveData: () => Promise.resolve(),
  });
  const prefLayer = Layer.succeed(
    ZoteroPref,
    stubService<ZoteroPref["Service"]>("ZoteroPref", {
      // The Local Server reads only the source id from this snapshot.
      current: Effect.succeed({
        sourceId: "a1b2c3d4",
      } as ZoteroPrefSnapshot),
    }),
  );
  const noteIndexLayer = Layer.succeed(
    NoteIndex,
    stubService<NoteIndex["Service"]>("NoteIndex", {
      whenIndexed: () => Effect.void,
      getIndexedItemKeys: () => Effect.succeed(["ABCD2345"]),
    }),
  );
  const runtime = buildRuntime(
    layerLocalServer.pipe(
      Layer.provideMerge(settingsLayer),
      Layer.provide(prefLayer),
      Layer.provide(noteIndexLayer),
    ),
    stack,
  );
  await runtime.context();
  const settings = runtime.runSync(PluginSettings);
  applySettings(settings, runtime, overrides);
  return {
    runtime,
    server: runtime.runSync(LocalServer),
    settings,
  };
}
