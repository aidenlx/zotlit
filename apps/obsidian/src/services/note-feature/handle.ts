// The Note Feature for callers outside Effect: views, the setting tab and the legacy runners.
import { Effect } from "effect";

import type { EffectBridge } from "@/lib/effect-bridge";

import type { NoteCitations } from "./citations-handle";
import type { NoteCreation } from "./creation-handle";
import { plainNoteError } from "./errors";
import type { NoteFeatureHandle } from "./operations";
import { eventPayloads } from "./service";
import type { NoteFeature } from "./service";

/**
 * The Note Feature's members over `service`, run through `bridge`, with the
 * citation members and the interactive creation of `edges`
 * (`policies/services.md` → Edge handle). A
 * member resolves with its result and rejects with what failed, a render's
 * or a rewrite's throw as it was thrown. A Profile note preview renders
 * synchronously. An event subscription ends at unload.
 */
export function bindNoteFeature(
  bridge: Pick<EffectBridge, "runSync" | "runPromise" | "subscribe">,
  service: NoteFeature["Service"],
  edges: NoteCitations & NoteCreation,
): NoteFeatureHandle {
  const run = <A, E>(effect: Effect.Effect<A, E>) =>
    bridge.runPromise(
      Effect.mapError(effect, (error) => plainNoteError(error)),
    );
  return {
    ...edges,
    updateNote: (file, options) => run(service.updateNote(file, options)),
    replacedKeys: (file) => run(service.replacedKeys(file)),
    resolveCompanionNote: (indexedKey, options) =>
      run(service.resolveCompanionNote(indexedKey, options)),
    resolveCreationProfile: (sources) =>
      run(service.resolveCreationProfile(sources)),
    prepareProfileNote: (options) => {
      const preview = bridge.runSync(service.prepareProfileNote(options));
      return { ...preview, create: () => run(preview.create) };
    },
    getImportedNotesForItem: (indexedKey) =>
      run(service.getImportedNotesForItem(indexedKey)),
    on: (event, cb) =>
      bridge.subscribe(eventPayloads(service.changes, event), cb),
  };
}
