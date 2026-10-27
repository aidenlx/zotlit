import { Context, Effect, Layer, Stream } from "effect";
import { effectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";
import { buildLibraryScope } from "@/services/library-scope/__fixtures__";
import { PluginSettings } from "@/services/settings/service";
import { createTemplateHost } from "@/services/template/__fixtures__";
import { Template } from "@/services/template/service";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { readsAnswering } from "@/services/zotero-reads/__fixtures__";
import type { ZoteroReads } from "@/services/zotero-reads/service";

import { profileOver } from "@/services/profile/__fixtures__";
import { Profile } from "@/services/profile/service";

export async function profileServiceFixture(
  files: Record<string, string> = {},
  reads?: Pick<ZoteroReads["Service"], "reads" | "events">,
  context = Context.empty(),
) {
  await using stack = new AsyncDisposableStack();
  const host = createTemplateHost(files);
  const runtime = buildRuntime(profileOver(host).pipe(Layer.provideMerge(Layer.succeedContext(context))), stack);
  await runtime.context();
  const settings = runtime.runSync(PluginSettings);
  const bridge = effectBridge(runtime);
  const template = Object.assign(runtime.runSync(Template), { runtime, bridge });
  const profile = Object.assign(runtime.runSync(Profile), { runtime, bridge });
  const profileService = runtime.runSync(Profile);
  const libraryScope = await buildLibraryScope({ settings,
    reads: reads ?? stubService<ZoteroReads["Service"]>("ZoteroReads", {
      reads: readsAnswering( { Libraries: () => Effect.succeed([{ libraryID: 1, type: "user", version: 0, clientVersion: null, groupID: null, name: null }]) }),
      events: Stream.empty,
    }),
  }, stack);
  const cleanup = stack.move();
  return {
    runtime, bridge, app: host.app, vault: host.vault, settings, template, profile, profileService, libraryScope, host,
    indexNotes: () => host.metadataCache.announceAll(),
    [Symbol.asyncDispose]: () => cleanup.disposeAsync(),
  };
}
