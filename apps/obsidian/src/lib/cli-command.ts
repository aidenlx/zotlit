// A zotlit:* command whose handler is an Effect. The plugin's ManagedRuntime
// runs it, as any call from Obsidian into Effect code; unloading the plugin
// interrupts a run still in flight. ZotLitPlugin.registerCliHandler then
// turns a failure into the text Obsidian prints (`cli-rejection.ts`).

import type { CliData, CliFlags, PluginManifest } from "obsidian";

import { Cause, Exit } from "@/lib/effect";
import type { Effect, ManagedRuntime } from "@/lib/effect";

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

/** Runs one command's Effect; `build.ts` makes it from the plugin's runtime. */
export type CliRunner = (
  effect: Effect.Effect<string, unknown>,
) => Promise<string>;

/**
 * A runner over `runtime` whose runs `signal` interrupts. A failure rejects
 * with its squashed cause; a run that unload interrupts rejects with the
 * signal's reason, as a command that read the signal itself did.
 */
export function cliRunner<R>(
  runtime: ManagedRuntime.ManagedRuntime<R, never>,
  signal: AbortSignal,
): CliRunner {
  return async (effect) => {
    const exit = await runtime.runPromiseExit(effect, { signal });
    if (Exit.isSuccess(exit)) return exit.value;
    if (signal.aborted && Cause.hasInterruptsOnly(exit.cause))
      throw signal.reason;
    throw Cause.squash(exit.cause);
  };
}
