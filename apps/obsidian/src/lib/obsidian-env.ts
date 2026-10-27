// The Obsidian environment the plugin runs in, read once when the graph builds,
// and the enabled core plugins, read on each ask.
import { Context, Effect, Layer } from "effect";
import { apiVersion, getLanguage, Platform } from "obsidian";
import type { FileSystemAdapter } from "obsidian";

import { ObsidianApp } from "@/lib/obsidian-app";

/** Obsidian's platform flags, as `Platform` holds them. */
export type ObsidianPlatform = Readonly<typeof Platform>;

/** Where the plugin runs: platform, Obsidian version, UI language, vault name, folder and app id. */
export class ObsidianEnv extends Context.Service<
  ObsidianEnv,
  {
    readonly platform: ObsidianPlatform;
    /** Obsidian's `apiVersion`, such as `1.14.4`. */
    readonly apiVersion: string;
    /** Obsidian's UI language, from `getLanguage()`. */
    readonly language: string;
    /** The vault's name, from `Vault.getName()`. */
    readonly vaultName: string;
    /** The vault's folder on disk. Desktop-only plugin: the adapter is always a `FileSystemAdapter`. */
    readonly basePath: string;
    /**
     * Obsidian's undocumented `App.appId`: the vault's id on this device,
     * which Obsidian names its own IndexedDB databases with.
     */
    readonly appId: string;
    /**
     * Whether the core plugin `id`, such as `graph`, is enabled now. It reads
     * Obsidian's undocumented `app.internalPlugins.getEnabledPluginById` on
     * each run, because the user can turn a core plugin on or off at any time.
     */
    corePluginEnabled(id: string): Effect.Effect<boolean>;
  }
>()("zotlit/obsidian/ObsidianEnv") {}

/**
 * The environment of the running Obsidian. Only the enabled core plugins
 * change while the plugin runs; the other values are read once.
 */
export const layerObsidianEnv: Layer.Layer<ObsidianEnv, never, ObsidianApp> =
  Layer.effect(
    ObsidianEnv,
    Effect.gen(function* () {
      const app = yield* ObsidianApp;
      return ObsidianEnv.of({
        platform: { ...Platform },
        apiVersion,
        language: getLanguage(),
        vaultName: app.vault.getName(),
        basePath: (app.vault.adapter as FileSystemAdapter).getBasePath(),
        appId: app.appId,
        corePluginEnabled: Effect.fn("ObsidianEnv.corePluginEnabled")((id) =>
          Effect.sync(() =>
            Boolean(app.internalPlugins.getEnabledPluginById(id)),
          ),
        ),
      });
    }),
  );
