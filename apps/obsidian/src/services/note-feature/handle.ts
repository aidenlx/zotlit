// The Note Feature for callers outside Effect: views, the setting tab and the legacy runners.
import { Effect } from "effect";

import type { EffectBridge } from "@/lib/effect-bridge";
import { filterTag } from "@/lib/effect-stream";
import { settleAtEdge } from "@/lib/signal-edge";

import type { NoteCitations } from "./citations-handle";
import type { PlannedCreationProfile } from "./creation-planning";
import { plainNoteError } from "./errors";
import type { NoteFeatureHandle } from "./operations";
import type { NoteFeature } from "./service";
import type {
  NoteFeatureEvent,
  NoteFeatureEvents,
  PreparedCreationProfile,
} from "./types";

/**
 * The Note Feature's members over `service`, run through `bridge`, with the
 * citation members of `citations` (`policies/services.md` → Edge handle). A
 * member resolves with its result and rejects with what failed, a render's
 * or a rewrite's throw as it was thrown; a plan rejects with the abort reason
 * of its `signal`, and with the interrupt when unload stops it. A Profile note
 * preview renders synchronously. An event subscription ends at unload.
 */
export function bindNoteFeature(
  bridge: Pick<
    EffectBridge,
    "runSync" | "runPromise" | "runPromiseExit" | "subscribe"
  >,
  service: NoteFeature["Service"],
  citations: NoteCitations,
): NoteFeatureHandle {
  const run = <A, E>(effect: Effect.Effect<A, E>) =>
    bridge.runPromise(
      Effect.mapError(effect, (error) => plainNoteError(error)),
    );
  const promised = (
    preview: PlannedCreationProfile,
  ): PreparedCreationProfile => ({
    ...preview,
    create: (options) => run(preview.create(options)),
  });
  return {
    ...citations,
    createNote: (item, options) => run(service.createNote(item, options)),
    updateNote: (file, options) => run(service.updateNote(file, options)),
    switchNoteProfile: (file, options) =>
      run(service.switchNoteProfile(file, options)),
    replacedKeys: (file) => run(service.replacedKeys(file)),
    overwriteNote: (file, indexedKey, options) =>
      run(service.overwriteNote(file, indexedKey, options)),
    resolveCompanionNote: (indexedKey, options) =>
      run(service.resolveCompanionNote(indexedKey, options)),
    resolveCreationProfile: (sources) =>
      run(service.resolveCreationProfile(sources)),
    planCreations: async (indexedKeys, { signal, ...sources } = {}) => {
      signal?.throwIfAborted();
      const exit = await bridge.runPromiseExit(
        service
          .planCreations(indexedKeys, sources)
          .pipe(
            Effect.map(
              (plans) =>
                new Map(
                  Array.from(plans, ([key, plan]) => [
                    key,
                    { ...plan, previews: plan.previews.map(promised) },
                  ]),
                ),
            ),
          ),
        signal && { signal },
      );
      return settleAtEdge(exit, signal);
    },
    prepareProfileNote: (options) => {
      const preview = bridge.runSync(service.prepareProfileNote(options));
      return { ...preview, create: () => run(preview.create) };
    },
    prepareProfileSwitch: (file) => run(service.prepareProfileSwitch(file)),
    getImportedNotesForItem: (indexedKey) =>
      run(service.getImportedNotesForItem(indexedKey)),
    on: (event, cb) =>
      bridge.subscribe(
        filterTag(service.changes, event),
        (change: NoteFeatureEvent) =>
          change._tag === "excerpt-images-reported"
            ? (cb as NoteFeatureEvents[typeof change._tag])(change.summary)
            : (cb as NoteFeatureEvents[typeof change._tag])({
                itemKey: change.itemKey,
                fields: change.fields,
              }),
      ),
  };
}
