// One annotation insertion: render, commit, and return its operation outcome.
import { Effect } from "effect";

import { annotationOpenUri, parseIndexedKey } from "@zotlit/db";

import { withLogCategory } from "@/lib/effect-log";
import * as m from "@/lib/i18n/generated/messages";
import { AnnotationRepository } from "@/services/annotation-repository/service";
import type {
  AnnotationRecord,
  AnnotationSource,
} from "@/services/annotation-repository/service";
import type { ExcerptSummary } from "@/services/excerpt-image/prepare";
import { plainTemplateError } from "@/services/template/errors";
import { ProfileAnnotationError } from "@/services/template/service";
import { UseLedger } from "@/services/use-ledger/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { Placement } from "@/views/annot-view/async-insert";

import { prepareAnnotationInsert } from "./insert-annotation";

export interface AnnotationSnapshot {
  source: AnnotationSource | null;
  sourceScope: string | null;
}
interface AnnotationInsertTarget {
  signal: AbortSignal;
  valid(): boolean;
  commit(text: string, placement?: Placement): boolean;
}
export type AnnotationInsertRequest = (
  | {
      annotation: AnnotationRecord;
      snapshot: AnnotationSnapshot;
    }
  | {
      hit: { key: string; attachmentKey: string; itemKey: string };
    }
) & {
  target: AnnotationInsertTarget;
  notePath: string;
  placement?: Placement;
};

function fallbackText(annotation: AnnotationRecord): string {
  const key = parseIndexedKey(annotation.key);
  const parent = parseIndexedKey(annotation.parentKey);
  return (
    annotation.text ??
    `${m.excerpt_image_unavailable()}${key && parent ? ` [Zotero](${annotationOpenUri({ annotationKey: key.key, attachmentKey: parent.key, groupID: key.groupID, pageLabel: annotation.pageLabel })})` : ""}`
  );
}

/** How one asynchronous annotation insert ended. */
export type AnnotationInsertOutcome =
  /** No note in Source mode or Live Preview takes the insert. */
  | { kind: "no-note" }
  /** The selected search hit is no longer in the repository. */
  | { kind: "unavailable" }
  /** The annotation's source is gone, so nothing is inserted. */
  | { kind: "source-unavailable" }
  /** The template could not render, and the fallback text took its place. */
  | { kind: "fallback"; landed: boolean }
  | { kind: "inserted"; summary: ExcerptSummary }
  /** A Profile error: the annotation's own text took the template's place. */
  | { kind: "profile-error"; error: ProfileAnnotationError; landed: boolean }
  /** The insert failed; the log keeps the error. */
  | { kind: "failed" }
  /** The target went away, or a newer insert took its place. */
  | { kind: "cancelled" };

/** The captured destination cancels the read and render before any text is committed. */
export const commitAnnotation = Effect.fn("AnnotationNoteActions.insert")(
  function* (options: AnnotationInsertRequest) {
    const { target, notePath, placement } = options;
    const cancelled = Effect.callback<never>((resume) => {
      const interrupt = () => resume(Effect.interrupt);
      if (target.signal.aborted) {
        interrupt();
        return;
      }
      target.signal.addEventListener("abort", interrupt, { once: true });
      return Effect.sync(() =>
        target.signal.removeEventListener("abort", interrupt),
      );
    });
    const preparation = Effect.gen(function* () {
      if (target.signal.aborted) return yield* Effect.interrupt;
      let annotation: AnnotationRecord;
      let snapshot: AnnotationSnapshot;
      if ("hit" in options) {
        const { dataDir } = yield* (yield* ZoteroPref).current;
        const list = yield* (yield* AnnotationRepository).read(
          options.hit.attachmentKey,
        );
        const found = list?.annotations.find(
          ({ key }) => key === options.hit.key,
        );
        if (!list || !found) return null;
        annotation = found;
        snapshot = { source: list.source, sourceScope: dataDir };
      } else {
        ({ annotation, snapshot } = options);
      }
      const result = yield* prepareAnnotationInsert({
        annotation,
        source: snapshot.source!,
        sourceScope: snapshot.sourceScope!,
        notePath,
        valid: target.valid,
      }).pipe(
        Effect.map((insert) => ({ kind: "prepared" as const, insert })),
        Effect.catch((cause) =>
          Effect.succeed({
            kind: "error" as const,
            error: plainTemplateError(cause),
          }),
        ),
      );
      return { annotation, result };
    });
    const prepared = yield* Effect.raceFirst(preparation, cancelled);
    if (!target.valid()) return { kind: "cancelled" } as const;
    if (!prepared) return { kind: "unavailable" } as const;
    const { annotation, result } = prepared;
    let outcome: AnnotationInsertOutcome;
    if (result.kind === "error") {
      const { error } = result;
      if (error instanceof ProfileAnnotationError)
        outcome = {
          kind: "profile-error",
          error,
          landed: target.commit(annotation.text ?? annotation.key, placement),
        };
      else {
        yield* Effect.logWarning("Annotation insert failed", {
          annotationKey: annotation.key,
          error,
        });
        outcome = { kind: "failed" };
      }
    } else if (!result.insert) {
      outcome = {
        kind: "fallback",
        landed: target.commit(fallbackText(annotation), placement),
      };
    } else {
      outcome = target.commit(result.insert.text, placement)
        ? { kind: "inserted", summary: result.insert.summary }
        : { kind: "cancelled" };
    }
    if (
      "hit" in options &&
      (outcome.kind === "inserted" ||
        ((outcome.kind === "fallback" || outcome.kind === "profile-error") &&
          outcome.landed))
    )
      yield* (yield* UseLedger).record(options.hit.itemKey, "cited");
    return outcome;
  },
  withLogCategory("views", "annot-view"),
);
