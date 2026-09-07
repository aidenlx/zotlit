import type { App, Plugin } from "obsidian";
import { vi } from "vitest";

import { NoteIndex } from "@/services/note-index/service";
import { SettingsService } from "@/services/settings/service";
import { TemplateService } from "@/services/template/service";
import { MockVault, PluginStub } from "@/services/template/test-vault";

import { LibraryScopeService } from "@/services/library-scope/service";
import type { DatabaseService } from "@/services/database/service";

import { ProfileService } from "@/services/profile/service";

export async function profileServiceFixture(
  files: Record<string, string> = {},
  db?: DatabaseService,
) {
  await using stack = new AsyncDisposableStack();
  const vault = new MockVault();
  const metadataListeners = new Map<string, (...args: unknown[]) => void>();
  for (const [path, source] of Object.entries(files))
    vault.addFile(path, source);
  const app = {
    vault,
    // The runtime-enable shape: layout is ready, so the index scans at once.
    workspace: { updateOptions: vi.fn(), onLayoutReady: (cb: () => void) => cb() },
    loadLocalStorage: () => null,
    metadataCache: {
      getFileCache: vi.fn(() => null),
      on: (name: string, callback: (...args: unknown[]) => void) => {
        metadataListeners.set(name, callback);
        return { e: { offref: () => metadataListeners.delete(name) } };
      },
      // A clean cache: the one-shot calls back at once.
      onCleanCache: (callback: () => void) => callback(),
    },
    fileManager: {
      processFrontMatter: vi.fn(),
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
    db: db ?? { ready: Promise.resolve(), state: "ready", client: {}, on: () => () => {} } as unknown as DatabaseService,
    ...(db ? {} : { loadLibraries: () => [{ libraryID: 1, type: "user", groupID: null, name: null }] }),
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
    /** Re-indexes every note from the current `getFileCache` answers, the way `changed` events do. */
    indexNotes: () => {
      for (const file of vault.getMarkdownFiles()) {
        metadataListeners.get("changed")!(
          file,
          "",
          app.metadataCache.getFileCache(file),
        );
      }
    },
    [Symbol.asyncDispose]: () => cleanup.disposeAsync(),
  };
}
