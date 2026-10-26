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
 * or a rewrite's throw as it was thrown. An event subscription ends at
 * unload.
 */
export function bindNoteFeature(
  bridge: Pick<EffectBridge, "runPromise" | "subscribe">,
  service: NoteFeature["Service"],
  edges: NoteCitations & NoteCreation,
): NoteFeatureHandle {
  const run = <A, E>(effect: Effect.Effect<A, E>) =>
    bridge.runPromise(
      Effect.mapError(effect, (error) => plainNoteError(error)),
    );
  return {
    ...edges,
    createNote: (item, options) => run(service.createNote(item, options)),
    updateNote: (file, options) => run(service.updateNote(file, options)),
    overwriteNote: (file, indexedKey, options) =>
      run(service.overwriteNote(file, indexedKey, options)),
    replacedKeys: (file) => run(service.replacedKeys(file)),
    resolveCompanionNote: (indexedKey, options) =>
      run(service.resolveCompanionNote(indexedKey, options)),
    resolveCreationProfile: (sources) =>
      run(service.resolveCreationProfile(sources)),
    getImportedNotesForItem: (indexedKey) =>
      run(service.getImportedNotesForItem(indexedKey)),
    on: (event, cb) =>
      bridge.subscribe(eventPayloads(service.changes, event), cb),
  };
}
