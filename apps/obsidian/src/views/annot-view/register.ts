import "./style.css";
import type { App, Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import type { ViewRegistryHandle } from "@/lib/view-atoms";

import type { AnnotActions } from "./actions";
import type { AnnotViewModel } from "./model";
import type { AnnotState } from "./state";
import { ANNOT_VIEW_TYPE, AnnotationView } from "./view";
import type { AnnotViewDeps } from "./view";
import type { AnnotViewState } from "./view-state";

type AnnotViewPlugin = Pick<
  Plugin,
  "registerView" | "addCommand" | "addRibbonIcon" | "app"
>;

/**
 * The real services satisfy {@link AnnotViewDeps} as they are — every member is
 * a structural `Pick` — so registration takes the same bundle the view does.
 */
export function registerAnnotView(
  plugin: AnnotViewPlugin,
  deps: AnnotViewDeps,
): void {
  plugin.registerView(
    ANNOT_VIEW_TYPE,
    (leaf) => new AnnotationView(leaf, deps),
  );

  const open = () => {
    void activateAnnotView(plugin.app);
  };

  plugin.addCommand({
    id: "open-annot-view",
    name: m.command_open_annot_view_name(),
    callback: open,
  });
  plugin.addRibbonIcon("highlighter", m.command_open_annot_view_name(), open);

  addFollowModeCommands(plugin, deps.registry, () => targetView(plugin.app));
}

/**
 * Opens the Annotation View and brings one Annotation's card forward — the Mark
 * Popup's reveal verb, and a notice's reveal.
 *
 * @see https://github.com/aidenlx/zotlit/issues/1148
 */
export async function revealAnnotationInView(
  plugin: AnnotViewPlugin,
  annotationKey: string,
): Promise<void> {
  await activateAnnotView(plugin.app);
  targetView(plugin.app)?.revealAnnotation(annotationKey);
}

/**
 * Opens the Annotation View pinned to one Item, from a gesture on that Item
 * in another view: the Library View's Reading Card.
 *
 * @param itemKey the Item's Indexed Key.
 */
export async function showItemInAnnotView(
  app: App,
  itemKey: string,
): Promise<void> {
  await activateAnnotView(app);
  targetView(app)?.pinItem(itemKey);
}

/**
 * Whether an Annotation View on screen already holds one Annotation's card.
 *
 * What it answers is whether the user can already see the card — so a Write
 * Conflict raises its notice only where nothing shows the two values it put
 * side by side.
 *
 * @param annotationKey the Annotation's Indexed Key.
 */
export function annotationCardShown(app: App, annotationKey: string): boolean {
  return app.workspace
    .getLeavesOfType(ANNOT_VIEW_TYPE)
    .some(
      (leaf) =>
        leaf.view instanceof AnnotationView &&
        leaf.view.snapshot.annotations?.some(
          (record) => record.key === annotationKey,
        ) === true,
    );
}

/**
 * What the five Follow Mode commands need of the view they act on: its model,
 * whose Follow Mode state the registry holds, the Item on screen it publishes,
 * and the gestures it publishes. The gestures are the ones its React tree and
 * its pane menu call, so a command is one more caller of them rather than a
 * set of delegates built for commands alone.
 */
export interface FollowModeCommandTarget {
  readonly model: Pick<AnnotViewModel, "state">;
  readonly snapshot: Pick<AnnotState, "pinnable">;
  readonly gestures: Pick<
    AnnotActions,
    "onSetFollowMode" | "onPinCurrentItem" | "onPinItem" | "onUnpin"
  > | null;
}

/**
 * The five gestures that change an Annotation View's Follow Mode from the
 * command palette. Each one applies to the view `findView` names, and drops out
 * of the palette when that view is absent or the gesture cannot apply — so a
 * command never silently does nothing.
 *
 * @see apps/obsidian/docs/adr/0041-the-annotation-view-changes-its-follow-mode-only-on-a-user-gesture.md
 */
export function addFollowModeCommands(
  plugin: Pick<AnnotViewPlugin, "addCommand">,
  registry: ViewRegistryHandle,
  findView: () => FollowModeCommandTarget | null,
): void {
  type Gestures = NonNullable<FollowModeCommandTarget["gestures"]>;
  const command = ({
    id,
    name,
    applies,
    run,
  }: {
    id: string;
    name: string;
    /** Whether the palette offers it against the view's Follow Mode state. */
    applies: (
      state: AnnotViewState & FollowModeCommandTarget["snapshot"],
    ) => boolean;
    run: (gestures: Gestures) => void;
  }): void => {
    plugin.addCommand({
      id,
      name,
      checkCallback(checking) {
        const view = findView();
        if (!view?.gestures) return false;
        const state = {
          ...registry.get(view.model.state),
          pinnable: view.snapshot.pinnable,
        };
        if (!applies(state)) return false;
        if (!checking) run(view.gestures);
        return true;
      },
    });
  };

  command({
    id: "annot-view-follow-active-tab",
    name: m.command_annot_view_follow_active_tab_name(),
    applies: (state) => state.followMode !== "active-tab",
    run: (gestures) => gestures.onSetFollowMode("active-tab"),
  });
  command({
    id: "annot-view-follow-zotero-reader",
    name: m.command_annot_view_follow_zotero_reader_name(),
    applies: (state) => state.followMode !== "zotero-reader",
    run: (gestures) => gestures.onSetFollowMode("zotero-reader"),
  });
  command({
    id: "annot-view-pin-current-item",
    name: m.command_annot_view_pin_current_item_name(),
    applies: (state) =>
      state.followMode !== "pinned" && state.pinnable !== null,
    run: (gestures) => gestures.onPinCurrentItem(),
  });
  command({
    id: "annot-view-pin-item",
    name: m.command_annot_view_pin_item_name(),
    applies: () => true,
    run: (gestures) => gestures.onPinItem(),
  });
  command({
    id: "annot-view-unpin",
    name: m.command_annot_view_unpin_name(),
    applies: (state) => state.followMode === "pinned",
    run: (gestures) => gestures.onUnpin(),
  });
}

/**
 * The Annotation View a command acts on: the focused one, else the first open.
 * A vault with several keeps a mode per instance, and the focused one is the
 * instance the gesture belongs to.
 */
function targetView(app: App): AnnotationView | null {
  const active = app.workspace.getActiveViewOfType(AnnotationView);
  if (active) return active;
  const [leaf] = app.workspace.getLeavesOfType(ANNOT_VIEW_TYPE);
  const view = leaf?.view;
  return view instanceof AnnotationView ? view : null;
}

/**
 * Bring the Annotation View forward in the sidebar, opening one on the right
 * when the vault has none. A vault whose right sidebar is gone keeps none.
 */
export async function activateAnnotView(app: App): Promise<void> {
  const { workspace } = app;
  let leaf = workspace.getLeavesOfType(ANNOT_VIEW_TYPE)[0];
  if (!leaf) {
    const right = workspace.getRightLeaf(false);
    if (!right) return;
    leaf = right;
    await leaf.setViewState({ type: ANNOT_VIEW_TYPE, active: true });
  }
  void workspace.revealLeaf(leaf);
}
