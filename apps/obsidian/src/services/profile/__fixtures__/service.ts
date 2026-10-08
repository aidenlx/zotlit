import type { App, Plugin } from "obsidian";

import { NoteIndex } from "@/services/note-index/service";
import { SettingsService } from "@/services/settings/service";
import { TemplateService } from "@/services/template/service";
import { createObsidianHost, PluginStub } from "@/lib/__fixtures__/obsidian-host";

import { Effect } from "effect";

import { LibraryScopeService } from "@/services/library-scope/service";
import { QueryClientService } from "@/services/query-client/service";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";

import { ProfileService } from "@/services/profile/service";

export async function profileServiceFixture(
  files: Record<string, string> = {},
  reads?: Pick<ZoteroReadsService, "ready" | "on">,
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
    new SettingsService({
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
  const noteIndex = stack.use(
    new NoteIndex({ app, plugin: plugin as unknown as Plugin }),
  );
  const libraryScope = stack.use(new LibraryScopeService({ settings,
    queries: stack.use(new QueryClientService()),
    reads: reads ?? ({
      ready: Promise.resolve({
        reads: {
          Libraries: () =>
            Effect.succeed([{ libraryID: 1, type: "user", version: 0, clientVersion: null, groupID: null, name: null }]),
        },
      }),
      on: () => () => {},
    } as unknown as ZoteroReadsService),
  }));
  const profile = stack.use(
    new ProfileService({ app, settings, template, noteIndex, libraryScope }),
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
