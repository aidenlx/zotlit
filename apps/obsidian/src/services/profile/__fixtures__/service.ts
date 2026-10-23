import { Context, Effect, Layer } from "@/lib/effect";
import { buildRuntime } from "@/lib/effect-layer";
import { buildLibraryScope } from "@/services/library-scope/__fixtures__";
import { plainPluginSettings } from "@/services/settings/plain";
import { createTemplateHost } from "@/services/template/__fixtures__";
import { plainTemplate } from "@/services/template/plain";
import type { PlainZoteroReads } from "@/services/zotero-reads/plain";

import { profileOver } from "@/services/profile/__fixtures__";
import { plainProfile } from "@/services/profile/plain";

export async function profileServiceFixture(
  files: Record<string, string> = {},
  reads?: Pick<PlainZoteroReads, "reads" | "on">,
  context = Context.empty(),
) {
  await using stack = new AsyncDisposableStack();
  const host = createTemplateHost(files);
  const runtime = buildRuntime(profileOver(host).pipe(Layer.provideMerge(Layer.succeedContext(context))), stack);
  await runtime.context();
  const settings = plainPluginSettings(runtime);
  const template = plainTemplate(runtime);
  const profile = plainProfile(runtime);
  const libraryScope = await buildLibraryScope({ settings,
    reads: reads ?? ({
      reads: { Libraries: () => Effect.succeed([{ libraryID: 1, type: "user", version: 0, clientVersion: null, groupID: null, name: null }]) },
      on: () => () => {},
    } as unknown as PlainZoteroReads),
  }, stack);
  const cleanup = stack.move();
  return {
    app: host.app, vault: host.vault, settings, template, profile, libraryScope, host,
    indexNotes: () => host.metadataCache.announceAll(),
    [Symbol.asyncDispose]: () => cleanup.disposeAsync(),
  };
}
