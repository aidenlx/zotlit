// Select one read-only update input before resolving the Profile to check.
import { FIELD_LITERATURE_NOTE_PROFILE } from "@/lib/constants";
import { parseProfileStamp } from "@/lib/profile-stamp";
import { previewBaseline } from "@/views/note-preview/baseline";

import type { TemplateDataDeps } from "./data";
import { sourceRevision } from "./inspect";

export async function selectCheckBaseline(
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
      recovery:
        kind === "supplied"
          ? "Correct the supplied existing=<text> frontmatter and run the check again."
          : `Restore access to '${path}' and correct its frontmatter, then run the check again with note=${path}.`,
    },
  });
  if (input.existing === undefined) {
    await deps.noteIndex.whenIndexed();
    const candidates = deps.noteIndex.getNotesByItemKey(input.key);
    if (input.note === undefined && candidates.length > 1)
      return {
        ok: false as const,
        diagnostic: {
          code: "duplicate-literature-notes",
          message:
            "Multiple Literature Notes match this item. Select one with note=<path>.",
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
          candidates: candidates.map((file) => file.path),
        },
      };
    if (selected) {
      path = selected.path;
      kind = "real";
      try {
        source = await deps.app.vault.read(selected);
      } catch (error) {
        return failed(error);
      }
    }
  }
  try {
    const stamp = parseProfileStamp(
      previewBaseline(source, "", null).frontmatter[
        FIELD_LITERATURE_NOTE_PROFILE
      ],
    );
    return { ok: true as const, source, kind, path, stamp };
  } catch (error) {
    return failed(error);
  }
}
