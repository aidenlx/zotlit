// Bound the document citation read shared by both citation pickers.
import { Cause, Effect } from "effect";
import type { TFile } from "obsidian";

import type { EffectBridge } from "@/lib/effect-bridge";
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
  using stack = new DisposableStack();
  const timeout = new AbortController();
  // Allow 150 ms for a warm index; startup indexing must not hold the picker.
  const win = activeWindow;
  const timer = win.setTimeout(() => timeout.abort(), 150);
  stack.defer(() => win.clearTimeout(timer));
  const lifetime = AbortSignal.any([signal, timeout.signal]);
  try {
    const set = await bridge.runPromise(
      Effect.tryPromise(() =>
        index.getDocumentCitationSet(file, { signal: lifetime }),
      ),
      { signal: lifetime },
    );
    return set.citations.flatMap(({ indexedKey }) =>
      indexedKey === null ? [] : [indexedKey],
    );
  } catch (error) {
    const reason = signal.aborted
      ? "aborted"
      : timeout.signal.aborted
        ? "timeout"
        : "failed";
    await bridge.runPromise(
      Effect.logDebug(
        "Document citations unavailable; searching without cited Items",
      ).pipe(
        Effect.annotateLogs({
          reason,
          ...(reason === "failed"
            ? { error: Cause.isUnknownError(error) ? error.cause : error }
            : {}),
        }),
        withLogCategory("views", "citation-suggest"),
      ),
    );
    return [];
  }
}
