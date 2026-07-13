// Action bindings for the Template Data Explorer, exposed to the presentational tree via context.
import { Menu } from "obsidian";
import { createContext } from "react";

import * as toast from "@/lib/toast";
import * as m from "@/paraglide/messages";

import { copyValue, formatPath, type DisplayNode } from "./display-tree";

export interface ExplorerActions {
  onChooseItem(): void;
  onToggle(key: string): void;
  /** Copy the node's value; resolves on a successful write so the row icon can flash a confirmation. */
  onCopyValue(node: DisplayNode): Promise<void>;
  /** Open the per-row template-actions menu: copy-path (Liquid, and Eta when enabled) plus explore-as-annotation-root when applicable. */
  onTemplateMenu(node: DisplayNode, event: React.MouseEvent): void;
  onBackToNoteRoot(): void;
  onFilter(query: string): void;
  onRefresh(): void;
}

export function createExplorerActions(deps: {
  onChooseItem(this: void): void;
  onToggle(this: void, key: string): void;
  onFilter(this: void, query: string): void;
  isEtaEnabled(): boolean;
  /** `null` unless `node` is a top-level `annotations[i]` entry and the tree isn't already anchored. */
  annotationKeyAt(node: DisplayNode): string | null;
  onAnchorAnnotation(key: string): void;
  onBackToNoteRoot(this: void): void;
  onRefresh(this: void): void;
}): ExplorerActions {
  const copyToClipboard = (
    text: string,
    successMessage: string,
  ): Promise<void> => {
    const done = navigator.clipboard.writeText(text);
    void toast.promise(done, {
      success: successMessage,
      error: m.template_data_explorer_copy_failed(),
    });
    return done;
  };

  const onCopyValue = (node: DisplayNode): Promise<void> => {
    const value = copyValue(node);
    if (value === null) return Promise.resolve();
    return copyToClipboard(value, m.template_data_explorer_copied_value());
  };

  const onTemplateMenu = (node: DisplayNode, event: React.MouseEvent): void => {
    const menu = new Menu();

    const addCopyPathItem = (title: string, rootAlias: string): void => {
      menu.addItem((item) => {
        item
          .setTitle(title)
          .setIcon("copy")
          .onClick(() => {
            void copyToClipboard(
              formatPath(node.path, rootAlias),
              m.template_data_explorer_copied_path(),
            );
          });
      });
    };

    if (deps.isEtaEnabled()) {
      addCopyPathItem(m.template_data_explorer_menu_copy_liquid_path(), "zt");
      addCopyPathItem(m.template_data_explorer_menu_copy_eta_path(), "it");
    } else {
      addCopyPathItem(m.template_data_explorer_menu_copy_path(), "zt");
    }

    const annotationKey = deps.annotationKeyAt(node);
    if (annotationKey !== null) {
      menu.addItem((item) => {
        item
          .setTitle(m.template_data_explorer_menu_explore_annotation())
          .setIcon("anchor")
          .onClick(() => {
            deps.onAnchorAnnotation(annotationKey);
          });
      });
    }

    menu.showAtMouseEvent(event.nativeEvent);
  };

  return {
    onChooseItem: deps.onChooseItem,
    onToggle: deps.onToggle,
    onCopyValue,
    onTemplateMenu,
    onBackToNoteRoot: deps.onBackToNoteRoot,
    onFilter: deps.onFilter,
    onRefresh: deps.onRefresh,
  };
}

const NOOP_ACTIONS: ExplorerActions = {
  onChooseItem: () => {},
  onToggle: () => {},
  onCopyValue: () => Promise.resolve(),
  onTemplateMenu: () => {},
  onBackToNoteRoot: () => {},
  onFilter: () => {},
  onRefresh: () => {},
};

export const ExplorerActionsContext =
  createContext<ExplorerActions>(NOOP_ACTIONS);
