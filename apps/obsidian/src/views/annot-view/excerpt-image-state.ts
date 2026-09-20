import type {
  AnnotationRecord,
  AnnotationSource,
} from "@/services/annotation-repository/service";
import {
  excerptFingerprint,
  excerptSourceIdentity,
} from "@/services/excerpt-image/service";

export interface ExcerptImageTarget {
  key: string;
  annotation: AnnotationRecord;
  source: AnnotationSource | null;
  sourceScope: string | null;
  refresh: number;
}

/** Retain the owned result when a published list changes only non-pixel input. */
export function excerptImageTarget(
  previous: ExcerptImageTarget | null,
  input: Omit<ExcerptImageTarget, "key">,
): ExcerptImageTarget {
  const { annotation, source } = input;
  const key = JSON.stringify([
    annotation.key,
    annotation.parentKey,
    input.sourceScope,
    input.refresh,
    source && excerptSourceIdentity(source),
    excerptFingerprint(annotation),
  ]);
  return previous?.key === key ? previous : { key, ...input };
}

/** Pure card lifecycle. URL ownership transfers only to the current target. */
export type ExcerptImageState =
  | { kind: "disposed" }
  | { kind: "loading"; target: object }
  | { kind: "unavailable"; target: object }
  | { kind: "available"; target: object; url: string };

export type ExcerptImageEvent =
  | { kind: "start"; target: object }
  | { kind: "resolved"; target: object; url: string | null }
  | { kind: "failed"; target: object }
  | { kind: "dispose" };

export function transitionExcerptImage(
  state: ExcerptImageState,
  event: ExcerptImageEvent,
): {
  state: ExcerptImageState;
  release: string[];
} {
  const previous = state.kind === "available" ? [state.url] : [];
  if (event.kind === "start")
    return {
      state: { kind: "loading", target: event.target },
      release: previous,
    };
  if (event.kind === "dispose")
    return { state: { kind: "disposed" }, release: previous };
  if (state.kind === "disposed" || state.target !== event.target) {
    return {
      state,
      release: event.kind === "resolved" && event.url ? [event.url] : [],
    };
  }
  if (event.kind === "failed" || !event.url)
    return {
      state: { kind: "unavailable", target: event.target },
      release: previous,
    };
  return {
    state: { kind: "available", target: event.target, url: event.url },
    release: previous.filter((url) => url !== event.url),
  };
}

/** A target change hides the old result before the next effect runs. */
export function excerptImageForTarget(
  state: ExcerptImageState,
  target: object,
): ExcerptImageState {
  return state.kind !== "disposed" && state.target === target
    ? state
    : { kind: "loading", target };
}
