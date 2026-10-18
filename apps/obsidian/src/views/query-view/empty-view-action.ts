// "New Zotero query table" on Obsidian's empty tab, right after its own "New
// note", "New base" and "New canvas" pills. The empty view is internal: every
// leaf holds one as `_empty`, and its `onOpen` empties `actionListEl` and
// refills it each time the tab opens. Verified against Obsidian 1.14.4; the
// End-to-end Run checks the pill against Obsidian's own on each upgrade.
import { around } from "monkey-around";
import { Platform, setIcon, setTooltip } from "obsidian";
import type { App, EmptyView, PlatformInternals } from "obsidian";

import { disposable } from "@/lib/disposables";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";

const logger = getLogger(["views", "query-view", "empty-view"]);

const ACTION_CLASS = "zt-empty-state-new-query";

function isEmptyView(view: unknown): view is EmptyView {
  return (
    view instanceof Object &&
    (view as Partial<EmptyView>).getViewType?.() === "empty" &&
    ((view as Partial<EmptyView>).actionListEl?.instanceOf(HTMLElement) ??
      false) &&
    typeof (view as Partial<EmptyView>).onOpen === "function"
  );
}

/** Any leaf's own empty view, the one instance that leads to the class. */
function anyEmptyView(app: App): EmptyView | null {
  let found: EmptyView | null = null;
  app.workspace.iterateAllLeaves((leaf) => {
    if (!found && isEmptyView(leaf._empty)) found = leaf._empty;
  });
  return found;
}

export interface EmptyViewAction {
  /** Full id of the command whose hotkey the pill prints. */
  commandId: string;
  run: (event: MouseEvent | KeyboardEvent) => void;
}

function actionOf(view: EmptyView): HTMLElement | null {
  return view.actionListEl.querySelector(`.${ACTION_CLASS}`);
}

/**
 * The pill Obsidian's own "New …" pills end at: New note always, then New
 * base and New canvas while their core plugins are on.
 */
function afterNewPills(app: App, list: HTMLElement): Element | null {
  const newPills =
    1 +
    Number(Boolean(app.internalPlugins.getEnabledPluginById("bases"))) +
    Number(Boolean(app.internalPlugins.getEnabledPluginById("canvas")));
  return list.children.item(newPills);
}

/** Add the pill the way Obsidian builds its own, hotkey and all. */
function addAction(
  app: App,
  view: EmptyView,
  { commandId, run }: EmptyViewAction,
): void {
  if (actionOf(view)) return;
  const list = view.actionListEl;
  const label = m.empty_state_new_query();
  const before = afterNewPills(app, list);
  // Built in the list, so in its window's document, then moved into place.
  const button = list.createDiv({
    cls: [
      "text-icon-button",
      "tappable",
      "mod-pill",
      "empty-state-action",
      ACTION_CLASS,
    ],
    attr: { tabIndex: 0, role: "button" },
  });
  list.insertBefore(button, before);
  setIcon(button.createSpan("text-button-icon"), "list-filter");
  button.createSpan({ cls: "text-button-label", text: label });
  setTooltip(button, label);
  if ((Platform as typeof Platform & PlatformInternals).hasPhysicalKeyboard) {
    const hotkey = app.hotkeyManager.printHotkeyForCommand(commandId);
    if (hotkey)
      button.createSpan({ cls: "empty-state-hotkey", text: ` ${hotkey}` });
  }
  // Obsidian's own pills take a click, Enter and Space, but not a key an IME
  // composes with or one a handler before them already took.
  button.addEventListener("click", (event) => {
    event.preventDefault();
    run(event);
  });
  button.addEventListener("keydown", (event) => {
    if (event.isComposing || event.defaultPrevented) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    run(event);
  });
}

function eachOpenEmptyView(app: App, callback: (view: EmptyView) => void) {
  app.workspace.iterateAllLeaves((leaf) => {
    if (isEmptyView(leaf.view)) callback(leaf.view);
  });
}

/**
 * Put "New Zotero query table" on every empty tab, those open now and those opened later,
 * until disposed. Without an empty view to patch, it logs a warning and adds
 * nothing.
 */
export function installEmptyViewAction(
  app: App,
  action: EmptyViewAction,
): Disposable {
  const anyInstance = anyEmptyView(app);
  if (!anyInstance) {
    logger.warn(
      "No leaf holds an empty view; New Zotero query table is left off the empty tab",
    );
    return new DisposableStack();
  }
  const add = (view: EmptyView) => addAction(app, view, action);
  const uninstall = around(Object.getPrototypeOf(anyInstance) as EmptyView, {
    onOpen: (native) =>
      async function (this: EmptyView) {
        await native.call(this);
        // The unknown-view pane extends the empty view but overrides
        // `onOpen`; only the plain empty tab reaches here.
        add(this);
      },
  });
  eachOpenEmptyView(app, add);
  return disposable(() => {
    uninstall();
    eachOpenEmptyView(app, (view) => actionOf(view)?.remove());
  });
}
