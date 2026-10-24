// The Obsidian environment the plugin runs in, read once when the graph builds.
import { apiVersion, getLanguage, Platform } from "obsidian";
import type { FileSystemAdapter } from "obsidian";

import { Context, Effect, Layer } from "@/lib/effect";
import { ObsidianApp } from "@/lib/obsidian-app";

/** Obsidian's platform flags, as `Platform` holds them. */
export type ObsidianPlatform = Readonly<typeof Platform>;

/** Where the plugin runs: platform, Obsidian version, UI language, vault folder. */
export class ObsidianEnv extends Context.Service<
  ObsidianEnv,
  {
    readonly platform: ObsidianPlatform;
    /** Obsidian's `apiVersion`, such as `1.14.4`. */
    readonly apiVersion: string;
    /** Obsidian's UI language, from `getLanguage()`. */
    readonly language: string;
    /** The vault's folder on disk. Desktop-only plugin: the adapter is always a `FileSystemAdapter`. */
    readonly basePath: string;
  }
>()("zotlit/obsidian/ObsidianEnv") {}

/** The environment of the running Obsidian. None of it changes while the plugin runs. */
export const layerObsidianEnv: Layer.Layer<ObsidianEnv, never, ObsidianApp> =
  Layer.effect(
    ObsidianEnv,
    Effect.gen(function* () {
      const app = yield* ObsidianApp;
      return ObsidianEnv.of({
        platform: { ...Platform },
        apiVersion,
        language: getLanguage(),
        basePath: (app.vault.adapter as FileSystemAdapter).getBasePath(),
      });
    }),
  );
