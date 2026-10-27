// Bound the document citation read shared by both citation pickers.
import { Cause, Effect } from "effect";
import type { TFile } from "obsidian";

import type { EffectBridge } from "@/lib/effect-bridge";
import { recover } from "@/lib/effect-cause";
import { withLogCategory } from "@/lib/effect-log";
import type { PlainCitationIndex } from "@/services/citation-index/plain";
import type {} from "@/services/citation-index/service";

export async function readDocumentCitedKeys(
  {
    citationIndex: index,
    bridge,
  }: {
    citationIndex: Pick<PlainCitationIndex, "getDocumentCitationSet">;
    bridge: Pick<EffectBridge, "runPromise">;
  },
  file: TFile | null,
  signal: AbortSignal,
): Promise<readonly string[]> {
  if (!file) return [];
  const unavailable = (
    reason: "aborted" | "timeout" | "failed",
    error?: unknown,
  ) =>
    Effect.logDebug(
      "Document citations unavailable; searching without cited Items",
    ).pipe(
      Effect.annotateLogs({
        reason,
        ...(reason === "failed" ? { error } : {}),
      }),
      withLogCategory("views", "citation-suggest"),
    );
  const empty: readonly string[] = [];
  try {
    return await bridge.runPromise(
      Effect.tryPromise((readSignal) =>
        index.getDocumentCitationSet(file, {
          signal: AbortSignal.any([signal, readSignal]),
        }),
      ).pipe(
        Effect.map((set) =>
          set.citations.flatMap(({ indexedKey }) =>
            indexedKey === null ? [] : [indexedKey],
          ),
        ),
        // Allow 150 ms for a warm index; startup indexing must not hold the picker.
        Effect.timeoutOrElse({
          duration: 150,
          orElse: () => unavailable("timeout").pipe(Effect.as(empty)),
        }),
        recover((cause) => {
          const error = Cause.squash(cause);
          return unavailable(
            "failed",
            Cause.isUnknownError(error) ? error.cause : error,
          );
        }, Effect.succeed(empty)),
        Effect.onInterrupt(() =>
          signal.aborted ? unavailable("aborted") : Effect.void,
        ),
      ),
      { signal },
    );
  } catch {
    // The Effect handles read failures; an interrupted bridge has no result.
    return empty;
  }
}
