// Action bindings for the Template Data Explorer, exposed to the presentational tree via context.
import type { Menu } from "obsidian";
import { createContext } from "react";

import * as m from "@/lib/i18n/generated/messages";
import type { IndexedKeyCopyTarget } from "@/services/indexed-key/actions";
import { addCopyIndexedKeyMenuItem } from "@/services/indexed-key/menu";

export interface ExplorerActions {
  onChooseItem(): void;
  onBackToNoteRoot(): void;
  onRefresh(): void;
  addCopyKeyMenuItem(menu: Menu): boolean;
  addExportMenuItem(menu: Menu): void;
}

export function createExplorerActions(deps: {
  onChooseItem(this: void): void;
  onBackToNoteRoot(this: void): void;
  onRefresh(this: void): void;
  copyTarget(this: void): IndexedKeyCopyTarget | null;
  canExport(this: void): boolean;
  onExport(this: void): void;
  exportLabel?(): string;
}): ExplorerActions {
  return {
    onChooseItem: deps.onChooseItem,
    onBackToNoteRoot: deps.onBackToNoteRoot,
    onRefresh: deps.onRefresh,
    addCopyKeyMenuItem(menu) {
      return addCopyIndexedKeyMenuItem(menu, deps.copyTarget(), {
        section: "zotlit",
      });
    },
    addExportMenuItem(menu) {
      // The pane's other states already show their own call to action, so the
      // entry stays absent rather than present-and-dead.
      if (!deps.canExport()) return;
      menu.addItem((item) => {
        item
          .setSection("zotlit")
          .setTitle(
            deps.exportLabel?.() ?? m.template_data_explorer_menu_export_json(),
          )
          .setIcon("file-json")
          .onClick(() => deps.onExport());
      });
    },
  };
}

const NOOP_ACTIONS: ExplorerActions = {
  onChooseItem: () => {},
  onBackToNoteRoot: () => {},
  onRefresh: () => {},
  addCopyKeyMenuItem: () => false,
  addExportMenuItem: () => {},
};

export const ExplorerActionsContext =
  createContext<ExplorerActions>(NOOP_ACTIONS);
