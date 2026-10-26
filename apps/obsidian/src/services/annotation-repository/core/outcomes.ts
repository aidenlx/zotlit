// What a write left on an Annotation: the outcomes that stand, and the writes in flight on the mutation cache.
import { Effect } from "effect";

import { IDLE } from "@/services/annotation-repository/write";
import type {
  MutationState,
  TextField,
} from "@/services/annotation-repository/write";

import { ANNOTATIONS } from "./model";
import type { AnnotationMutation, OutcomeWrite } from "./model";
import type { CoreState } from "./state";

/** One field's outcome, as a write leaves it on its Annotation. */
interface Outcome {
  write: OutcomeWrite;
  state: MutationState;
}

/**
 * What a write left on one Annotation, for the card that draws its verbs:
 * `pending` from the moment a write is asked for until the last write queued
 * on it settles, then the latest failure or conflict left standing.
 *
 * @param annotationKey the Annotation's Indexed Key.
 */
function mutationFor(core: CoreState, annotationKey: string): MutationState {
  const [running] = pendingWrites(core, annotationKey);
  return (
    (running && core.pendingStates.get(running)) ??
    standingOutcome(core, annotationKey) ??
    IDLE
  );
}

/** Records the outcome one field's write leaves, and announces it. */
function settle(
  core: CoreState,
  annotationKey: string,
  outcome: Outcome,
): MutationState {
  leave(core, annotationKey, outcome);
  core.publish({ _tag: "annotation-changed", annotationKey });
  return outcome.state;
}

/**
 * Records the outcome a running write leaves on its Annotation, as the
 * latest one. The write's own settle announces it, once the mutation cache
 * no longer holds it pending.
 */
function leave(
  core: CoreState,
  annotationKey: string,
  { write, state }: Outcome,
): MutationState {
  const outcomes = core.outcomes.get(annotationKey) ?? new Map();
  outcomes.delete(write);
  if (state.kind === "failed" || state.kind === "conflict") {
    outcomes.set(write, state);
  }
  keepOutcomes(core, annotationKey, outcomes);
  return state;
}

/** Ends every failure on an Annotation, and the conflict of one field. */
function takeOver(
  core: CoreState,
  annotationKey: string,
  write: OutcomeWrite,
): void {
  const outcomes = core.outcomes.get(annotationKey);
  if (!outcomes) return;
  for (const [field, state] of outcomes) {
    if (field === write || state.kind === "failed") outcomes.delete(field);
  }
  keepOutcomes(core, annotationKey, outcomes);
}

function keepOutcomes(
  core: CoreState,
  annotationKey: string,
  outcomes: Map<OutcomeWrite, MutationState>,
): void {
  if (outcomes.size > 0) core.outcomes.set(annotationKey, outcomes);
  else core.outcomes.delete(annotationKey);
}

/** The latest failure or conflict standing on an Annotation. */
function standingOutcome(
  core: CoreState,
  annotationKey: string,
): MutationState | undefined {
  const outcomes = core.outcomes.get(annotationKey);
  return outcomes && [...outcomes.values()].at(-1);
}

/** The writes on one Annotation still in flight or waiting, oldest first. */
function pendingWrites(
  core: CoreState,
  annotationKey: string,
): AnnotationMutation[] {
  return core.queries.client.getMutationCache().findAll({
    mutationKey: [ANNOTATIONS, annotationKey],
    status: "pending",
  }) as AnnotationMutation[];
}

/** The latest write of one text field still in flight or waiting. */
function savingText(
  core: CoreState,
  field: TextField,
  annotationKey: string,
): AnnotationMutation | undefined {
  return pendingWrites(core, annotationKey).findLast(
    ({ options }) => options.mutationKey?.[2] === field,
  );
}

/**
 * What a write in flight answers, for a caller that joins it: the wait on
 * the write's own mutation that the command stored, or what the Annotation
 * shows where none is stored.
 */
function answerOf(core: CoreState, mutation: AnnotationMutation) {
  return (
    core.operations.get(mutation) ??
    Effect.sync(() =>
      mutationFor(core, String(mutation.options.mutationKey?.[1])),
    )
  );
}

export {
  mutationFor,
  settle,
  leave,
  takeOver,
  standingOutcome,
  pendingWrites,
  savingText,
  answerOf,
};
