// Bound the document citation read shared by both citation pickers.
import { abortable } from "@std/async/abortable";
import type { TFile } from "obsidian";

import { getLogger } from "@/lib/log";
import type { CitationIndex } from "@/services/citation-index/service";

const logger = getLogger(["views", "citation-suggest"]);

export async function readDocumentCitedKeys(
  index: Pick<CitationIndex, "getDocumentCitationSet">,
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
    const set = await abortable(
      index.getDocumentCitationSet(file, { signal: lifetime }),
      lifetime,
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
    logger.debug(
      "Document citations unavailable; searching without cited Items",
      {
        reason,
        ...(reason === "failed" ? { error } : {}),
      },
    );
    return [];
  }
}
