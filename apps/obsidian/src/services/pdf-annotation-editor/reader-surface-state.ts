// The Reader Surface State: what the surfaces of one bound PDF view draw from,
// held in one vanilla store per view.
//
// The binding turns external signals into state through the reducers here, and
// each renderer subscribes to its own selector with an equality, so a signal
// that changes nothing on screen draws nothing.
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";

import { capabilityReason } from "@/services/annotation-repository/capability";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import { editingCapabilityAffordance } from "@/services/annotation-repository/capability-copy";
import type { CapabilityAffordance } from "@/services/annotation-repository/capability-copy";

import { creationToolbar } from "./creation-toolbar";
import type { CreationToolbarControl } from "./creation-toolbar";
import type { AnnotationTool, MarkTool, ToolColorStore } from "./tools";

export interface ReaderSurfaceState {
  /** The tool a released selection commits with, or `null` while none is armed. */
  armed: MarkTool | null;
  /** Whether the Annotation Marks are drawn over the pages. */
  marksVisible: boolean;
  /** Every tool's colour, as the settings-backed tool colour store holds it. */
  colors: Readonly<Record<AnnotationTool, string>>;
  /** What this Attachment's Annotations may be edited to right now. */
  capability: EditingCapability;
  /**
   * The instant {@link ReaderSurfaceState.capability} was ingested at. The
   * Creation Toolbar's copy is read against it, so the countdown's tick moves
   * the affordance and leaves the toolbar still.
   */
  capabilityAt: Temporal.Instant;
  /** The instant a cooldown's remaining seconds are measured from. */
  now: Temporal.Instant;
}

export type ReaderSurfaceStore = ReturnType<typeof createReaderSurfaceState>;

export function createReaderSurfaceState({
  colors,
  capability,
  now,
}: Pick<ReaderSurfaceState, "colors" | "capability" | "now">) {
  return createStore<ReaderSurfaceState>()(
    subscribeWithSelector(
      (): ReaderSurfaceState => ({
        armed: null,
        marksVisible: true,
        colors,
        capability,
        capabilityAt: now,
        now,
      }),
    ),
  );
}

export function arm(store: ReaderSurfaceStore, tool: MarkTool | null): void {
  store.setState({ armed: tool });
}

/** Writes a tool's colour to the settings-backed store and to this view. */
export function setToolColor(
  store: ReaderSurfaceStore,
  toolColors: ToolColorStore,
  { tool, color }: { tool: AnnotationTool; color: string },
): void {
  toolColors.set(tool, color);
  store.setState({ colors: toolColors.current() });
}

export function toggleMarks(store: ReaderSurfaceStore): void {
  store.setState(({ marksVisible }) => ({ marksVisible: !marksVisible }));
}

/**
 * Takes the capability the repository now answers. One with the same meaning
 * as the held one keeps the held object and only moves the clock, so a
 * repeated announcement changes no subscriber's slice.
 */
export function ingestCapability(
  store: ReaderSurfaceStore,
  capability: EditingCapability,
  now: Temporal.Instant,
): void {
  if (sameCapability(store.getState().capability, capability)) {
    tick(store, now);
    return;
  }
  store.setState({ capability, capabilityAt: now, now });
}

export function tick(store: ReaderSurfaceStore, now: Temporal.Instant): void {
  store.setState({ now });
}

export function selectCreationToolbar({
  armed,
  colors,
  marksVisible,
  capability,
  capabilityAt,
}: ReaderSurfaceState): readonly CreationToolbarControl[] {
  return creationToolbar({
    armed,
    colors,
    marksVisible,
    capability,
    now: capabilityAt,
  });
}

/**
 * The affordance the reader's toolbar shows, or `null` while it shows none.
 * Authorization is offered in the Annotation View and settings, so only the
 * two states a reader waits out are shown here.
 */
export function selectCapabilityAffordance({
  capability,
  now,
}: ReaderSurfaceState): CapabilityAffordance | null {
  return capability.kind === "authorizing" || capability.kind === "cooldown"
    ? editingCapabilityAffordance(capability, now)
    : null;
}

/** Whether two capabilities mean the same: one reason, and one deadline. */
export function sameCapability(
  a: EditingCapability,
  b: EditingCapability,
): boolean {
  if (capabilityReason(a) !== capabilityReason(b)) return false;
  return a.kind === "cooldown" && b.kind === "cooldown"
    ? a.retryAfter.equals(b.retryAfter)
    : true;
}

/** Whether two flat records, or two `null`s, hold equal primitive fields. */
export function sameFlat<T extends object>(a: T | null, b: T | null): boolean {
  if (a === null || b === null) return a === b;
  const keys = Object.keys(a) as (keyof T)[];
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.is(a[key], b[key]))
  );
}

/** Whether two lists of flat records hold equal records in the same order. */
export function sameFlatList<T extends object>(
  a: readonly T[],
  b: readonly T[],
): boolean {
  return (
    a.length === b.length &&
    a.every((record, index) => sameFlat(record, b[index]!))
  );
}
