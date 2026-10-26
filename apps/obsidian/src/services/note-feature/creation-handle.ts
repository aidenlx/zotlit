// The interactive note creation for callers outside Effect: the Note Feature's views.
import { Effect } from "effect";
import type { Context } from "effect";
import type { TFile } from "obsidian";

import type { Item } from "@zotlit/db";

import type { EffectBridge } from "@/lib/effect-bridge";
import type { Notifier } from "@/lib/notifier";
import { settleAtEdge } from "@/lib/signal-edge";
import type { ZoteroPref } from "@/services/zotero-pref/service";

import { createNoteInteractively } from "./creation-view";
import type {
  InteractiveCreationOptions,
  InteractiveCreationPorts,
} from "./creation-view";
import type { NoteFeature } from "./service";

/** The services the interactive creation reads. */
export type NoteCreationServices = NoteFeature | Notifier | ZoteroPref;

export interface NoteCreation {
  /** @see createNoteInteractively */
  createNoteInteractively(
    item: Item,
    options?: InteractiveCreationOptions,
  ): Promise<TFile | null>;
}

/**
 * The interactive creation over `context` and `ports`, run through `bridge`.
 * It resolves with the created file, or `null`, and rejects with what the
 * plan failed with. Unload interrupts it: the picker closes, and it resolves
 * `null`, as a cancelled creation does.
 */
export function bindNoteCreation(
  bridge: Pick<EffectBridge, "runPromiseExit">,
  context: Context.Context<NoteCreationServices>,
  ports: InteractiveCreationPorts,
): NoteCreation {
  return {
    createNoteInteractively: async (item, options) =>
      settleAtEdge(
        await bridge.runPromiseExit(
          Effect.provideContext(
            createNoteInteractively(ports, item, options),
            context,
          ),
        ),
        undefined,
        () => null,
      ),
  };
}
