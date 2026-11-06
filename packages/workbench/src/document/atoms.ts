// The Workbench document controller's facts as atoms, beside its `subscribe` listeners.
import { Option } from "effect";
import * as Atom from "effect/reactivity/Atom";

import type {
  WorkbenchDocumentController,
  WorkbenchProblem,
  WorkbenchSliceId,
} from "./controller";
import type { ManagedEntrySource, WorkbenchSliceRange } from "./manifest-patch";

export interface WorkbenchDocumentAtoms {
  /** The document's authored bytes, as {@link WorkbenchDocumentController.source}. */
  readonly source: Atom.Atom<string>;
  /** Why the draft is refused, as {@link WorkbenchDocumentController.problems}. */
  readonly problems: Atom.Atom<readonly WorkbenchProblem[]>;
  /** Every slice's region, as {@link WorkbenchDocumentController.slices}. */
  readonly slices: Atom.Atom<
    ReadonlyMap<WorkbenchSliceId, WorkbenchSliceRange>
  >;
  /**
   * The Properties rows, as {@link WorkbenchDocumentController.managedEntries}:
   * the last list that parsed while the draft does not.
   */
  readonly managedEntries: Atom.Atom<readonly ManagedEntrySource[] | null>;
  /** Whether the document takes no edit, as {@link WorkbenchDocumentController.readOnly}. */
  readonly readOnly: Atom.Atom<boolean>;
  /**
   * Counts every update, a read-only toggle and a selection included, and a
   * controller replacement. A reader of a getter that changes without the
   * text, such as `canUndo`, re-reads on it.
   */
  readonly revision: Atom.Atom<number>;
}

/**
 * The facts of the controller `current` holds. Each one changes in the
 * `subscribe` notification of the edit that changed it, and reads the new
 * instance once `current` is set to a replacement.
 * @param current The controller in use, which a host sets to the one it loads.
 */
export function workbenchDocumentAtoms(
  current: Atom.Atom<WorkbenchDocumentController>,
): WorkbenchDocumentAtoms {
  const fact = <A>(read: (controller: WorkbenchDocumentController) => A) =>
    Atom.readable((get) => {
      const controller = get(current);
      // The controller re-derives these facts only when the text changes, so a
      // selection or read-only update would publish the same value again.
      get.addFinalizer(
        controller.subscribe(({ docChanged }) => {
          if (docChanged) get.setSelf(read(controller));
        }),
      );
      return read(controller);
    });
  const revision = Atom.readable((get) => {
    const controller = get(current);
    let count = Option.getOrElse(get.self<number>(), () => -1) + 1;
    get.addFinalizer(controller.subscribe(() => get.setSelf(++count)));
    return count;
  });
  // A read-only toggle changes no text, so this fact reads every update.
  const readOnly = Atom.readable((get) => {
    const controller = get(current);
    get.addFinalizer(
      controller.subscribe(() => get.setSelf(controller.readOnly)),
    );
    return controller.readOnly;
  });
  return {
    revision,
    readOnly,
    source: fact((controller) => controller.source),
    problems: fact((controller) => controller.problems),
    slices: fact((controller) => controller.slices),
    managedEntries: fact((controller) => controller.managedEntries),
  };
}

const revisions = new WeakMap<WorkbenchDocumentController, Atom.Atom<number>>();

/**
 * Counts every update of `controller`, as `revision` does for the controller
 * in use, for a surface handed a controller of its own.
 */
export function documentRevision(
  controller: WorkbenchDocumentController,
): Atom.Atom<number> {
  let revision = revisions.get(controller);
  if (revision === undefined) {
    revision = Atom.readable((get) => {
      let count = Option.getOrElse(get.self<number>(), () => 0);
      get.addFinalizer(controller.subscribe(() => get.setSelf(++count)));
      return count;
    });
    revisions.set(controller, revision);
  }
  return revision;
}
