// The vault and Zotero source a Workbench envelope names.
import { Effect } from "effect";

import { ObsidianEnv } from "@/lib/obsidian-env";
import { ZoteroPref } from "@/services/zotero-pref/service";

import type { WorkbenchIdentity } from "./envelope";

/**
 * The identity of the vault and the connected Zotero source that an envelope
 * carries, read once the source is known.
 */
export const readWorkbenchIdentity: Effect.Effect<
  WorkbenchIdentity,
  never,
  ObsidianEnv | ZoteroPref
> = Effect.gen(function* () {
  const env = yield* ObsidianEnv;
  const { sourceId, databasePath } = yield* (yield* ZoteroPref).current;
  return {
    vault: { name: env.vaultName, path: env.basePath },
    source: { id: sourceId, databasePath },
  };
});
