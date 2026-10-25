// The Language Pack's edges outside Effect: its start in `onload`, ahead of
// the service graph, and the setting tab's handle on it.

import { Effect, Stream } from "effect";
import type { App } from "obsidian";

import type { EffectBridge } from "@/lib/effect-bridge";
import { runtimeServices } from "@/lib/effect-services";
import { Notifier } from "@/lib/notifier";
import { ObsidianApp } from "@/lib/obsidian-app";
import { layerObsidianEnv } from "@/lib/obsidian-env";
import { toastLanguagePackInstall } from "@/services/language-pack/notices";
import {
  LanguagePack,
  startLanguagePack,
} from "@/services/language-pack/service";
import type {
  LanguagePackSituation,
  LanguagePackStartup,
} from "@/services/language-pack/service";

/**
 * Apply the Language Pack before any copy shows: `onload`'s own notices (an
 * old installer, a service that failed to start) read `m.*` before the
 * service graph builds. Runs with the plugin's run services, as the graph does.
 *
 * @throws the storage failure that stops startup.
 */
export function startI18n(
  app: App,
  pluginVersion: string,
): LanguagePackStartup {
  return Effect.runSyncWith(runtimeServices)(
    startLanguagePack(pluginVersion).pipe(
      Effect.provide(layerObsidianEnv),
      Effect.provideService(ObsidianApp, app),
    ),
  );
}

/** The {@link LanguagePack} as the setting tab holds it. */
export interface LanguagePackLifecycle {
  readonly endonym: string;
  getSituation(): LanguagePackSituation;
  /** Calls `listener` after each change; the returned function stops it. */
  subscribe(listener: () => void): () => void;
  /** Installs behind the download toast, which reports the outcome. */
  install(): void;
  /** @throws the storage failure of {@link LanguagePack}'s `reset`. */
  reset(): void;
}

/**
 * The setting tab's {@link LanguagePackLifecycle}, run through the plugin's
 * bridge on the services `build.ts` reads once.
 */
export function languagePackEdge(
  services: {
    readonly pack: LanguagePack["Service"];
    readonly notifier: Notifier["Service"];
  },
  bridge: Pick<EffectBridge, "runSync" | "runPromiseExit" | "subscribe">,
): LanguagePackLifecycle {
  const { pack, notifier } = services;
  const toast = toastLanguagePackInstall.pipe(
    Effect.provideService(LanguagePack, pack),
    Effect.provideService(Notifier, notifier),
  );
  return {
    endonym: pack.endonym,
    getSituation: () => bridge.runSync(pack.situation),
    subscribe: (listener) =>
      bridge.subscribe(Stream.drop(pack.changes, 1), () => listener()),
    // In the runtime's Scope, so unload ends the toast with the download.
    // The toast reports each failure itself, so the run cannot fail.
    install: () => void bridge.runPromiseExit(toast),
    reset: () => bridge.runSync(pack.reset),
  };
}
