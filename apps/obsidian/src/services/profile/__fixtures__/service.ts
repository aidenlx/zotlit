import type { App, Plugin } from "obsidian";
import { vi } from "vitest";

import { NoteIndex } from "@/services/note-index/service";
import { SettingsService } from "@/services/settings/service";
import { TemplateService } from "@/services/template/service";
import { MockVault, PluginStub } from "@/services/template/test-vault";

import { ProfileService } from "@/services/profile/service";

export async function profileServiceFixture(files: Record<string, string> = {}) {
  await using stack = new AsyncDisposableStack();
  const vault = new MockVault();
  const metadataListeners = new Map<string, () => void>();
  for (const [path, source] of Object.entries(files))
    vault.addFile(path, source);
  const app = {
    vault,
    workspace: { updateOptions: vi.fn() },
    loadLocalStorage: () => null,
    metadataCache: {
      initialized: true,
      getFileCache: vi.fn(() => null),
      on: (name: string, callback: () => void) => {
        metadataListeners.set(name, callback);
        return { e: { offref: () => metadataListeners.delete(name) } };
      },
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
    new TemplateService({ app, plugin: plugin as unknown as Plugin, settings }),
  );
  const noteIndex = stack.use(
    new NoteIndex({ app, plugin: plugin as unknown as Plugin }),
  );
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
    indexNotes: () => metadataListeners.get("resolved")!(),
    [Symbol.asyncDispose]: () => cleanup.disposeAsync(),
  };
}
