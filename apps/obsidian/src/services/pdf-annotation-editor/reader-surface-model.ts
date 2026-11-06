// The Reader Surface Model: the Reader Surface State of one bound PDF view as
// a writable atom, and one derived atom for each thing a surface draws, held
// in the binding's own atom registry. Each derived atom carries the equality
// that tells a change on screen from none, so a renderer that watches it
// hears only what it draws.
//
// The writers live here too: `update` and `modify` run the pure transitions of
// reader-surface-state.ts against the registry, and the edge functions below
// take the tool colour store's and the repository's facts into the state.
import { Effect } from "effect";
import type { Scope } from "effect";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";

import { scheduleBrowserTask } from "@/lib/browser-scheduler";
import type { EffectBridge } from "@/lib/effect-bridge";
import type {
  AnnotationRecord,
  AnnotationRepository,
} from "@/services/annotation-repository/service";
import { editingLive } from "@/views/annot-view/card-controls";
import { sameKeys } from "@/views/annot-view/card-selection";

import {
  ingestAnnotationState,
  ingestRecords,
  sameCapability,
  sameFlat,
  sameFlatList,
  selectAdjust,
  selectCapabilityAffordance,
  selectCapture,
  selectCreateRow,
  selectCreationToolbar,
  selectFloatingHead,
  selectSelectedKey,
  selectSelectedKeys,
  selectSelectedRow,
  selectTextDraft,
} from "./reader-surface-state";
import type {
  Floating,
  ReaderSurfaceState,
  Step,
  Transition,
} from "./reader-surface-state";
import type { AnnotationTool, ToolColorStore } from "./tools";

/** The registry a binding holds its model in, from bind to unbind. */
export type ReaderSurfaceRegistry = AtomRegistry.AtomRegistry;

/** One binding's registry, disposed when the Scope it is taken on closes. */
export const readerSurfaceRegistry: Effect.Effect<
  ReaderSurfaceRegistry,
  never,
  Scope.Scope
> = Effect.acquireRelease(
  Effect.sync(() => AtomRegistry.make({ scheduleTask: scheduleBrowserTask })),
  (registry) => Effect.sync(() => registry.dispose()),
);

/** What the Mark Popup draws: what floats, and the row it shows over it. */
export interface PopupView {
  floating: Floating;
  row: readonly object[];
}

export interface ReaderSurfaceModel {
  readonly state: Atom.Writable<ReaderSurfaceState>;
  readonly armed: Atom.Atom<ReaderSurfaceState["armed"]>;
  readonly toolbar: Atom.Atom<ReturnType<typeof selectCreationToolbar>>;
  readonly capabilityAffordance: Atom.Atom<
    ReturnType<typeof selectCapabilityAffordance>
  >;
  /** The capability, held still while it means the same. */
  readonly capability: Atom.Atom<ReaderSurfaceState["capability"]>;
  readonly editingLive: Atom.Atom<boolean>;
  readonly floatingHead: Atom.Atom<ReturnType<typeof selectFloatingHead>>;
  readonly selectedKey: Atom.Atom<string | null>;
  readonly selectedKeys: Atom.Atom<readonly string[]>;
  readonly adjust: Atom.Atom<ReturnType<typeof selectAdjust>>;
  readonly capture: Atom.Atom<ReturnType<typeof selectCapture>>;
  readonly textDraft: Atom.Atom<ReturnType<typeof selectTextDraft>>;
  readonly liveStroke: Atom.Atom<ReaderSurfaceState["liveStroke"]>;
  /** Whether a stroke or an image capture is being drawn. */
  readonly drawing: Atom.Atom<boolean>;
  readonly pendingStrokes: Atom.Atom<ReaderSurfaceState["pendingStrokes"]>;
  readonly popup: Atom.Atom<PopupView>;
}

/**
 * The model over `initial`. The state is kept alive: it stands from the bind
 * to the unbind whether or not a surface watches it.
 */
export function makeReaderSurfaceModel(
  initial: ReaderSurfaceState,
): ReaderSurfaceModel {
  const state = Atom.keepAlive(Atom.make(initial));
  const derive = <A>(
    select: (state: ReaderSurfaceState) => A,
    equals?: (a: A, b: A) => boolean,
  ): Atom.Atom<A> => {
    const derived = Atom.map(state, select);
    return equals ? Atom.withEquality(derived, equals) : derived;
  };
  return {
    state,
    armed: derive(({ armed }) => armed),
    toolbar: derive(selectCreationToolbar, sameFlatList),
    capabilityAffordance: derive(selectCapabilityAffordance, sameFlat),
    capability: derive(({ capability }) => capability, sameCapability),
    editingLive: derive(({ capability }) => editingLive(capability)),
    floatingHead: derive(selectFloatingHead, sameFlat),
    selectedKey: derive(selectSelectedKey),
    selectedKeys: derive(selectSelectedKeys, sameKeys),
    adjust: derive(selectAdjust),
    capture: derive(selectCapture),
    textDraft: derive(selectTextDraft),
    liveStroke: derive(({ liveStroke }) => liveStroke),
    drawing: derive(
      (current) =>
        current.liveStroke !== null || selectCapture(current) !== null,
    ),
    pendingStrokes: derive(({ pendingStrokes }) => pendingStrokes),
    popup: derive(
      (current): PopupView => ({
        floating: current.floating,
        row:
          current.floating.kind === "create"
            ? selectCreateRow(current)
            : selectSelectedRow(current),
      }),
      (a, b) => a.floating === b.floating && sameFlatList(a.row, b.row),
    ),
  };
}

/**
 * The surface a reader's gestures write: the registry that holds the Reader
 * Surface Model, and the model.
 */
export interface ReaderSurface {
  readonly registry: ReaderSurfaceRegistry;
  readonly model: ReaderSurfaceModel;
}

/** Applies `transition` to the surface's state, and tells its watchers. */
export function update(
  { registry, model }: ReaderSurface,
  transition: Transition,
): void {
  registry.update(model.state, transition);
}

/** Applies `step` to the surface's state, and answers its result. */
export function modify<A>(
  { registry, model }: ReaderSurface,
  step: Step<A>,
): A {
  return registry.modify(model.state, step);
}

/** The surface's state as it stands now. */
export function current({
  registry,
  model,
}: ReaderSurface): ReaderSurfaceState {
  return registry.get(model.state);
}

/**
 * Writes a tool's colour to the settings-backed store and to this view. The
 * choice is a use of that colour too.
 */
export function setToolColor(
  surface: ReaderSurface,
  toolColors: ToolColorStore,
  { tool, color }: { tool: AnnotationTool; color: string },
): void {
  toolColors.set(tool, color);
  update(surface, (state) => ({ ...state, colors: toolColors.current() }));
  recordColorUse(surface, toolColors, color);
}

/**
 * Puts a colour first in the recent list every tool shares: a tool coloured,
 * a mark created, or a mark recoloured.
 */
export function recordColorUse(
  surface: ReaderSurface,
  toolColors: ToolColorStore,
  color: string,
): void {
  toolColors.use(color);
  update(surface, (state) => ({ ...state, recentColors: toolColors.recent() }));
}

/** What the per-Annotation facts are read and announced through. */
export type AnnotationFacts = Pick<
  AnnotationRepository["Service"],
  "annotationState" | "annotationChanged"
>;

/**
 * Takes a read's records, with the write state and the draft each one already
 * holds, in one update: those stood before this view could hear them
 * announced.
 */
export function ingestAnnotations(
  surface: ReaderSurface,
  records: readonly AnnotationRecord[],
  {
    annotations,
    bridge,
  }: {
    annotations: Pick<AnnotationRepository["Service"], "annotationState">;
    bridge: Pick<EffectBridge, "runSync">;
  },
): void {
  const states = records.map(
    ({ key }) =>
      [key, bridge.runSync(annotations.annotationState(key))] as const,
  );
  update(surface, (state) =>
    states.reduce(
      (next, [key, annotation]) => ingestAnnotationState(key, annotation)(next),
      ingestRecords(records)(state),
    ),
  );
}

/**
 * Takes what the repository announces about one Annotation — what a write left
 * on it, its drafts, and its deletion — into the state.
 *
 * @returns what stops the listening.
 */
export function listenAnnotationEvents(
  surface: ReaderSurface,
  annotations: AnnotationFacts,
  bridge: Pick<EffectBridge, "runSync" | "subscribe">,
): DisposableStack {
  const listening = new DisposableStack();
  listening.defer(
    bridge.subscribe(annotations.annotationChanged, (key) =>
      update(
        surface,
        ingestAnnotationState(
          key,
          bridge.runSync(annotations.annotationState(key)),
        ),
      ),
    ),
  );
  return listening;
}
