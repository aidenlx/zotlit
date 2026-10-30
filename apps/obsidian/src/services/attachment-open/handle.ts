// Literature Note Attachments for callers outside Effect: the `open-pdf`
// command, the file menu, and the Quick Switcher's and Library View's PDF opens.
import type { Context } from "effect";

import { exitOver, valueOr } from "@/lib/effect-bridge";
import type { EffectBridge } from "@/lib/effect-bridge";

import { literatureNoteAttachments } from "./literature-note";
import type { LiteratureNoteServices } from "./literature-note";
import type { ObsidianOpenableAttachment } from "./resolve";

/** The edge handle `plugin-runtime.ts` binds; see {@link bindLiteratureNoteAttachments}. */
export interface LiteratureNoteAttachmentsHandle {
  /**
   * The Obsidian-Openable PDF Attachments of the Item `indexedKey` names; none
   * while the database cannot be read, or once the plugin unloads.
   * `undefined` when unload stops the lookup, so the caller opens nothing and
   * shows no "No PDF attachment" notice.
   */
  literatureNoteAttachments(
    indexedKey: string,
  ): Promise<ObsidianOpenableAttachment[] | undefined>;
}

/** {@link literatureNoteAttachments} over `bridge`, which unload interrupts. */
export function bindLiteratureNoteAttachments(
  bridge: Pick<EffectBridge, "runPromiseExit">,
  context: Context.Context<LiteratureNoteServices>,
): LiteratureNoteAttachmentsHandle {
  const runExit = exitOver(bridge, context);
  return {
    literatureNoteAttachments: async (indexedKey) =>
      valueOr<ObsidianOpenableAttachment[] | undefined, never>(
        await runExit(literatureNoteAttachments(indexedKey)),
        undefined,
      ),
  };
}
