// Settings for the declarative setting tab, legacy services, and views.
import { Effect } from "@/lib/effect";
import type { ManagedRuntime } from "@/lib/effect";
import { subscribe } from "@/lib/effect-stream";
import type { ResolvedLiteratureNoteProfileBindings } from "@/services/profile/bindings";

import type { HydrationOrigin } from "./classify";
import { PluginSettings } from "./service";
import type { Settings, SettingsDiagnostic, SettingsPatch } from "./service";

export interface PlainPluginSettings {
  readonly current: Readonly<Settings>;
  readonly loaded: Promise<Readonly<Settings>>;
  readonly diagnostics: readonly SettingsDiagnostic[];
  readonly hydrationOrigin: HydrationOrigin | null;
  update(
    patch: SettingsPatch | ((current: Readonly<Settings>) => SettingsPatch),
  ): Readonly<Settings>;
  reset(keys?: readonly (keyof Settings)[]): Readonly<Settings>;
  updateDefaultLiteratureNoteProfileBindings(
    patch: Partial<ResolvedLiteratureNoteProfileBindings>,
  ): void;
  flush(): Promise<void>;
  release(): void;
  subscribe(callback: (value: Readonly<Settings>) => void): () => void;
}

export function plainPluginSettings(
  runtime: ManagedRuntime.ManagedRuntime<PluginSettings, never>,
): PlainPluginSettings {
  const settings = runtime.runSync(PluginSettings.use(Effect.succeed));
  // Retain the runtime's context for unload races. The service Scope owns
  // shutdown; its closed methods return the last snapshot or do no work.
  const context = runtime.runSync(Effect.context<PluginSettings>());
  const run = {
    runSync: Effect.runSyncWith(context),
    runPromise: Effect.runPromiseWith(context),
  };
  return {
    get current() {
      return run.runSync(settings.current);
    },
    get loaded() {
      // Take the snapshot in the Promise continuation, as with the old store.
      return run
        .runPromise(settings.loaded)
        .then(() => run.runSync(settings.current)!);
    },
    get diagnostics() {
      return run.runSync(settings.diagnostics);
    },
    get hydrationOrigin() {
      return run.runSync(settings.hydrationOrigin);
    },
    update: (patch) => run.runSync(settings.update(patch)),
    reset: (keys) => run.runSync(settings.reset(keys)),
    updateDefaultLiteratureNoteProfileBindings: (patch) =>
      run.runSync(settings.updateDefaultLiteratureNoteProfileBindings(patch)),
    flush: () => run.runPromise(settings.flush()),
    release: () => run.runSync(settings.release()),
    subscribe: (callback) => subscribe(runtime, settings.changes, callback),
  };
}
