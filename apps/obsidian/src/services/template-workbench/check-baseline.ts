// Select one read-only update input before resolving the Profile to check.
import { Effect, Result } from "effect";

import { FIELD_LITERATURE_NOTE_PROFILE } from "@/lib/constants";
import { readLiveText } from "@/lib/live-text";
import { parseProfileStamp } from "@/lib/profile-stamp";
import { previewBaseline } from "@/views/note-preview/baseline";

import { TemplateDataError } from "./data";
import type { TemplateDataDeps } from "./data";
import { sourceRevision } from "./inspect";

/**
 * The update baseline of one item, or the refusal that names why there is
 * none. Fails when the Literature Note index cannot be read.
 */
export const selectCheckBaseline = Effect.fnUntraced(function* (
  deps: TemplateDataDeps,
  input: { key: string; note?: string; existing?: string },
) {
  let source: string | null = input.existing ?? null;
  let path: string | null = null;
  let kind: "supplied" | "real" | "synthetic" =
    input.existing === undefined ? "synthetic" : "supplied";
  const failed = (error: unknown) => ({
    ok: false as const,
    baseline: {
      kind,
      path,
      indexedKey: input.key,
      revision: source === null ? null : sourceRevision(source),
    },
    diagnostic: {
      code: "BASELINE_READ_FAILED",
      message: error instanceof Error ? error.message : String(error),
      hint:
        kind === "supplied"
          ? "Correct the supplied existing=<text> frontmatter and run the check again."
          : `Restore access to '${path}' and correct its frontmatter, then run the check again with note=${path}.`,
    },
  });
  if (input.existing === undefined) {
    const candidates = yield* Effect.tryPromise({
      try: async () => {
        await deps.noteIndex.whenIndexed();
        return deps.noteIndex.getNotesByItemKey(input.key);
      },
      catch: (cause) => new TemplateDataError({ cause }),
    });
    if (input.note === undefined && candidates.length > 1)
      return {
        ok: false as const,
        diagnostic: {
          code: "duplicate-literature-notes",
          message: "Multiple Literature Notes match this item.",
          hint: "Select one of the reported candidates with note=<path>, then run the check again.",
          candidates: candidates.map((file) => file.path),
        },
      };
    const selected =
      input.note === undefined
        ? candidates[0]
        : candidates.find((file) => file.path === input.note);
    if (input.note !== undefined && !selected)
      return {
        ok: false as const,
        diagnostic: {
          code: "TARGET_NOT_FOUND",
          message: "The selected path is not a Literature Note for this item.",
          hint: "Select one of the reported candidates with note=<path>, or omit note to use the only match.",
          candidates: candidates.map((file) => file.path),
        },
      };
    if (selected) {
      path = selected.path;
      kind = "real";
      const read = yield* Effect.result(
        Effect.tryPromise(() => readLiveText(deps.app, selected)),
      );
      if (Result.isFailure(read)) return failed(read.failure.cause);
      source = read.success;
    }
  }
  const stamp = yield* Effect.result(
    Effect.try(() =>
      parseProfileStamp(
        previewBaseline(source, "", null).frontmatter[
          FIELD_LITERATURE_NOTE_PROFILE
        ],
      ),
    ),
  );
  if (Result.isFailure(stamp)) return failed(stamp.failure.cause);
  return { ok: true as const, source, kind, path, stamp: stamp.success };
});
