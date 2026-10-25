// A Release service built from its layer over fake settings and App.
import { TFile, TFolder } from "obsidian";
import type { App } from "obsidian";
import { vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { Context, Effect, Layer } from "@/lib/effect";
import type { Scope } from "@/lib/effect";
import type { EffectBridge } from "@/lib/effect-bridge";
import { effectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";
import { ObsidianApp } from "@/lib/obsidian-app";
import type { HydrationOrigin } from "@/services/settings/classify";
import type { Settings } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";
import type { SettingsPatch } from "@/services/settings/service";

import { V1_TEMPLATE_FOLDER } from "./constants";
import { layerRelease, Release } from "./service";

export interface ReleaseAppFixture {
  readonly app: App;
  layoutReady(): void;
}

/** An App with one template folder and a layout-ready callback the test fires. */
export function releaseApp(
  templateFiles: readonly string[],
  folderPath: string = V1_TEMPLATE_FOLDER,
): ReleaseAppFixture {
  const folder = new TFolder();
  folder.children = templateFiles.map((name) => {
    const file = new TFile();
    file.name = name;
    return file;
  });
  let ready: (() => void) | undefined;
  const app = {
    workspace: {
      onLayoutReady: (callback: () => void) => {
        ready = callback;
      },
    },
    internalPlugins: { getEnabledPluginById: () => null },
    vault: {
      getFolderByPath: (path: string) => (path === folderPath ? folder : null),
    },
  } as unknown as App;
  return {
    app,
    layoutReady: () => ready?.(),
  };
}

export interface ReleaseFixtureOptions {
  readonly app: App;
  readonly layoutReady: () => void;
  readonly current: () => Readonly<Settings>;
  readonly origin?: HydrationOrigin | null;
  readonly update?: (patch: SettingsPatch) => void;
  readonly version?: string;
  readonly openFirstScreen?: () => void | Promise<void>;
}

export interface ReleaseFixture {
  readonly release: Release["Service"];
  readonly update: ReturnType<typeof vi.fn>;
  readonly layoutReady: () => void;
}

/** The Release service over its real layer, open for the current Scope. */
export function releaseOf(
  options: ReleaseFixtureOptions,
): Effect.Effect<ReleaseFixture, never, Scope.Scope> {
  const { layer, update } = releaseLayer(options);
  return Effect.map(Layer.build(layer), (context) => ({
    release: Context.get(context, Release),
    update,
    layoutReady: options.layoutReady,
  }));
}

/** The same Release service for a test outside Effect; dispose it when done. */
export async function buildRelease(options: ReleaseFixtureOptions): Promise<
  ReleaseFixture &
    AsyncDisposable & {
      readonly bridge: EffectBridge;
    }
> {
  await using stack = new AsyncDisposableStack();
  const { layer, update } = releaseLayer(options);
  const runtime = buildRuntime(layer, stack);
  await runtime.context();
  const fixture = {
    release: runtime.runSync(Release),
    update,
    layoutReady: options.layoutReady,
    bridge: effectBridge(runtime),
  };
  const lifetime = stack.move();
  return Object.assign(fixture, {
    [Symbol.asyncDispose]: () => lifetime.disposeAsync(),
  });
}

function releaseLayer(options: ReleaseFixtureOptions) {
  const update = vi.fn((patch: SettingsPatch) => {
    options.update?.(patch);
    return options.current();
  });
  const settings = stubService<PluginSettings["Service"]>("PluginSettings", {
    current: Effect.sync(options.current),
    hydrationOrigin: Effect.sync(() => options.origin ?? null),
    update: (patchOrUpdater) =>
      Effect.sync(() => {
        const patch =
          typeof patchOrUpdater === "function"
            ? patchOrUpdater(options.current())
            : patchOrUpdater;
        return update(patch);
      }),
  });
  const layer = layerRelease({
    version: options.version ?? "2.0.0",
    openFirstScreen: options.openFirstScreen,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ObsidianApp, options.app),
        Layer.succeed(PluginSettings, settings),
      ),
    ),
  );
  return { layer, update };
}
