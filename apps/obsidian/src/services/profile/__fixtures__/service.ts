import type { App } from "obsidian";

import { buildNoteIndex } from "@/services/note-index/__fixtures__";
import { buildSettings } from "@/services/settings/__fixtures__";
import { TemplateService } from "@/services/template/service";
import { createObsidianHost, PluginStub } from "@/lib/__fixtures__/obsidian-host";

import { Effect } from "@/lib/effect";

import { buildLibraryScope } from "@/services/library-scope/__fixtures__";
import type { PlainZoteroReads } from "@/services/zotero-reads/plain";

import { ProfileService } from "@/services/profile/service";

export async function profileServiceFixture(
  files: Record<string, string> = {},
  reads?: Pick<PlainZoteroReads, "reads" | "on">,
) {
  await using stack = new AsyncDisposableStack();
  const host = createObsidianHost(files);
  const { vault } = host;
  const app = {
    ...host.app,
    loadLocalStorage: () => null,
    fileManager: {
      trashFile: async (file: { path: string }) => vault.deleteFile(file.path),
    },
  } as unknown as App;
  const plugin = new PluginStub(app, { __VERSION__: 10 });
  const settings = stack.use(
    await buildSettings({
      plugin,
      migrateLegacy: (raw) => raw,
      migrateV1: (raw) => raw,
      migrateV2: (raw) => raw,
      migrateV3: (raw) => raw,
      migrateV4: (raw) => raw,
      migrateV5: (raw) => raw,
      migrateV6: (raw) => raw,
      migrateV7: (raw) => raw,
      migrateV8: (raw) => raw,
      migrateV9: (raw) => raw,
    }),
  );
  const template = stack.use(
    new TemplateService({ app, settings }),
  );
  const noteIndex = buildNoteIndex(app, stack);
  const libraryScope = await buildLibraryScope({ settings,
    reads: reads ?? ({
      reads: {
          Libraries: () =>
            Effect.succeed([{ libraryID: 1, type: "user", version: 0, clientVersion: null, groupID: null, name: null }]),
        },
      on: () => () => {},
    } as unknown as PlainZoteroReads),
  }, stack);
  const profile = stack.use(
    new ProfileService({ app, settings, template, noteIndex }),
  );
  await profile.ready;
  const cleanup = stack.move();
  return {
    app,
    vault,
    settings,
    template,
    profile,
    libraryScope,
    host,
    /** Re-indexes every note from the current `getFileCache` answers, the way `changed` events do. */
    indexNotes: () => host.metadataCache.announceAll(),
    [Symbol.asyncDispose]: () => cleanup.disposeAsync(),
  };
}
