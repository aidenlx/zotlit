// Creation planning and Profile selection for callers outside Effect: the
// Note Feature's members, which views, the setting tab and legacy runners call.
import { Effect } from "effect";
import type { Context } from "effect";

import type { EffectBridge } from "@/lib/effect-bridge";
import { settleAtEdge } from "@/lib/signal-edge";

import type { ComposeNoteDeps } from "./compose";
import {
  getImportedNotesForItem,
  planCreations,
  prepareProfileNote,
  prepareProfileSwitch,
  resolveCompanionNote,
  resolveCreationProfile,
} from "./creation-planning";
import type {
  CreateAtGate,
  CreationPlanningServices,
} from "./creation-planning";
import type { NoteFeature } from "./operations";

/** The edge handle `createNoteFeature` binds; see {@link bindCreationPlanning}. */
export type CreationPlanningHandle = Pick<
  NoteFeature,
  | "getImportedNotesForItem"
  | "planCreations"
  | "prepareProfileNote"
  | "prepareProfileSwitch"
  | "resolveCompanionNote"
  | "resolveCreationProfile"
>;

/**
 * The creation planning functions over `context`, run through `bridge`, with
 * `create` as the create gate (`policies/services.md` → Edge handle). A member
 * resolves with its result and rejects with what failed; a plan rejects with
 * the abort reason of its `signal`, and with the interrupt when unload stops
 * it. A Profile note preview renders synchronously.
 */
export function bindCreationPlanning(
  bridge: Pick<EffectBridge, "runSync" | "runPromise" | "runPromiseExit">,
  context: Context.Context<CreationPlanningServices>,
  {
    create,
    events,
  }: { create: CreateAtGate } & Pick<ComposeNoteDeps, "events">,
): CreationPlanningHandle {
  const provide = <A, E>(
    effect: Effect.Effect<A, E, CreationPlanningServices>,
  ) => Effect.provideContext(effect, context);
  const run = <A, E>(effect: Effect.Effect<A, E, CreationPlanningServices>) =>
    bridge.runPromise(provide(effect));
  return {
    resolveCompanionNote: (indexedKey, options) =>
      run(resolveCompanionNote(indexedKey, options)),
    resolveCreationProfile: (sources) => run(resolveCreationProfile(sources)),
    planCreations: async (indexedKeys, { signal, ...sources } = {}) => {
      signal?.throwIfAborted();
      const exit = await bridge.runPromiseExit(
        provide(planCreations(indexedKeys, { ...sources, create })),
        signal && { signal },
      );
      return settleAtEdge(exit, signal);
    },
    prepareProfileNote: (options) => {
      const preview = bridge.runSync(
        provide(prepareProfileNote(options, { create, events })),
      );
      return {
        ...preview,
        // The gate's own rejection, as a create through the gate gives it.
        create: () =>
          run(
            preview.create.pipe(
              Effect.catchTag("CreateRejected", ({ cause }) =>
                Effect.fail(cause),
              ),
            ),
          ),
      };
    },
    prepareProfileSwitch: (file) => run(prepareProfileSwitch(file)),
    getImportedNotesForItem: (indexedKey) =>
      run(getImportedNotesForItem(indexedKey)),
  };
}
