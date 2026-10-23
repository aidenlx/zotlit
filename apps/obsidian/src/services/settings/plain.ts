// Settings for the declarative setting tab, legacy services, and views.
import { Effect } from "@/lib/effect";
import type { ManagedRuntime } from "@/lib/effect";
import { withLogCategory } from "@/lib/effect-log";
import { subscribe } from "@/lib/effect-stream";
import type { ResolvedLiteratureNoteProfileBindings } from "@/services/profile/bindings";

import type { HydrationOrigin } from "./classify";
import { PluginSettings } from "./service";
import type { Settings, SettingsDiagnostic, SettingsPatch } from "./service";

export interface PlainPluginSettings {
  readonly current: Readonly<Settings> | null;
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
  subscribe(callback: (value: Readonly<Settings> | null) => void): () => void;
}

export function plainPluginSettings(
  runtime: ManagedRuntime.ManagedRuntime<PluginSettings, never>,
): PlainPluginSettings {
  const settings = runtime.runSync(PluginSettings.use(Effect.succeed));
  return {
    get current() {
      return runtime.runSync(settings.current);
    },
    get loaded() {
      // Take the snapshot in the Promise continuation, as with the old store.
      return runtime
        .runPromise(settings.loaded)
        .then(() => runtime.runSync(settings.current)!);
    },
    get diagnostics() {
      return runtime.runSync(settings.diagnostics);
    },
    get hydrationOrigin() {
      return runtime.runSync(settings.hydrationOrigin);
    },
    update: (patch) => runtime.runSync(settings.update(patch)),
    reset: (keys) => runtime.runSync(settings.reset(keys)),
    updateDefaultLiteratureNoteProfileBindings: (patch) =>
      runtime.runSync(
        settings.updateDefaultLiteratureNoteProfileBindings(patch),
      ),
    flush: () => runtime.runPromise(settings.flush()),
    release: () => runtime.runSync(settings.release()),
    subscribe: (callback) =>
      subscribe(runtime, settings.changes, (value) => {
        try {
          callback(value);
        } catch (error) {
          runtime.runSync(
            Effect.logError("subscriber threw").pipe(
              Effect.annotateLogs({ error }),
              withLogCategory("settings"),
            ),
          );
        }
      }),
  };
}
