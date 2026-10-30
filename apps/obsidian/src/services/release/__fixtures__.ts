// A Release service built from its layer over fake settings and App.
import { Context, Effect, Layer } from "effect";
import type { Scope } from "effect";
import { TFile, TFolder } from "obsidian";
import type { App, Events } from "obsidian";
import { vi } from "vitest";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { MemoryVault } from "@/lib/__fixtures__/obsidian-vault";
import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { stubService } from "@/lib/__fixtures__/service-stub";
import type { EffectBridge } from "@/lib/effect-bridge";
import { effectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";
import { ObsidianApp } from "@/lib/obsidian-app";
import { layerVaultFrom } from "@/lib/obsidian-vault";
import { layerWorkspaceFrom } from "@/lib/obsidian-workspace";
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

type EventSource = Pick<Events, "on" | "offref">;
type EventCallback = (...args: never[]) => unknown;

export function obsidianEventMethods(source: EventSource) {
  return {
    on: (name: string, callback: EventCallback) =>
      source.on(name, (...args: unknown[]) =>
        Reflect.apply(callback, undefined, args),
      ),
    offref: (ref: Parameters<EventSource["offref"]>[0]) => source.offref(ref),
  };
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
  const workspace = new MemoryWorkspace();
  const vault = MemoryVault.with({
    getFolderByPath: (path: string) => (path === folderPath ? folder : null),
  });
  const app = stubService<App>("App", {
    workspace: stubService<App["workspace"]>("Workspace", {
      ...obsidianEventMethods(workspace),
      onLayoutReady: (callback) => workspace.onLayoutReady(callback),
      getActiveFile: () => workspace.getActiveFile(),
      getActiveViewOfType: (type) => workspace.getActiveViewOfType(type),
    }),
    internalPlugins: stubService<App["internalPlugins"]>("InternalPlugins", {
      getEnabledPluginById: () => null,
    }),
    vault: stubService<App["vault"]>("Vault", {
      ...obsidianEventMethods(vault),
      read: (file) => vault.read(file),
      cachedRead: (file) => vault.cachedRead(file),
      process: (file, fn, options) => vault.process(file, fn, options),
      create: (path, data, options) => vault.create(path, data, options),
      trash: (file, system) => vault.trash(file, system),
      getFileByPath: (path) => vault.getFileByPath(path),
      getFolderByPath: (path) => vault.getFolderByPath(path),
      getAbstractFileByPath: (path) => vault.getAbstractFileByPath(path),
    }),
  });
  return {
    app,
    layoutReady: () => workspace.layoutReady(),
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
        layerVaultFrom(options.app.vault),
        layerWorkspaceFrom(options.app.workspace),
        testNotifier().layer,
        Layer.succeed(PluginSettings, settings),
      ),
    ),
  );
  return { layer, update };
}
