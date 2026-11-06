// The Reader Surface Model: the Reader Surface State of one bound PDF view as
// a writable atom, and one derived atom for each thing a surface draws, held
// in the binding's own atom registry. Each derived atom carries the equality
// that tells a change on screen from none, so a renderer that watches it
// hears only what it draws.
import { Effect } from "effect";
import type { Scope } from "effect";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";

import { scheduleBrowserTask } from "@/lib/browser-scheduler";
import { editingLive } from "@/views/annot-view/card-controls";
import { sameKeys } from "@/views/annot-view/card-selection";

import {
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
import type { Floating, ReaderSurfaceState } from "./reader-surface-state";

/** The registry a binding holds its model in, from bind to unbind. */
export type ReaderSurfaceRegistry = AtomRegistry.AtomRegistry;

/**
 * One binding's registry, disposed when its Scope closes. Acquired before the
 * binding's writes, it closes after them, so a create that settles as the
 * view closes still writes the state it leaves.
 */
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
