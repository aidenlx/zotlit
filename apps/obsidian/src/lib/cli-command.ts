// A zotlit:* command whose handler is an Effect. The plugin's bridge runs it,
// as any call from Obsidian into Effect code; unloading the plugin interrupts
// a run still in flight, and stops one that starts after it at its first
// pause. ZotLitPlugin.registerCliHandler then turns a failure into the text
// Obsidian prints (`cli-rejection.ts`).

import type { Effect } from "effect";
import type { CliData, CliFlags, PluginManifest } from "obsidian";

import type { EffectBridge } from "./effect-bridge";
import { settleAtEdge } from "./signal-edge";

/** A command's answer to the caller's parameters: the text it prints. */
export type CliCommandHandler = (
  params: CliData,
) => Effect.Effect<string, unknown>;

/** One zotlit:* command: its help text and flags, and its handler. */
export interface CliCommand {
  readonly description: string;
  readonly flags: CliFlags | null;
  readonly handler: CliCommandHandler;
}

/** Where a namespace registers its commands: the plugin. */
export interface CliHost {
  registerCliCommand(name: string, command: CliCommand): void;
}

/** A host whose commands report the plugin's version. */
export type VersionedCliHost = CliHost & {
  readonly manifest: Pick<PluginManifest, "version">;
};

/** Runs one command's Effect; `plugin-runtime.ts` makes it from the plugin's bridge. */
export type CliRunner = (
  effect: Effect.Effect<string, unknown>,
) => Promise<string>;

/**
 * A runner over `bridge` whose runs `signal` interrupts. A failure rejects
 * with its squashed cause; a run that unload interrupts rejects with the
 * signal's reason, as a command that read the signal itself did.
 */
export function cliRunner(
  bridge: Pick<EffectBridge, "runPromiseExit">,
  signal: AbortSignal,
): CliRunner {
  return async (effect) =>
    settleAtEdge(await bridge.runPromiseExit(effect, { signal }), signal);
}
