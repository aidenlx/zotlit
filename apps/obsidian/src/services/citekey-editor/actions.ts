// Palette commands that open the citekey under the cursor, mirroring
// Obsidian's native open-link-under-cursor set: in place, in a new tab, to
// the right, and in a new window.

import type { Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import type { NavigationPane } from "@/services/citekey-navigation";

import { citekeyAtPos } from "./extension";
import type { CitekeyEditor } from "./service";

const logger = getLogger("citekey-editor");

export interface CitekeyEditorActionDeps {
  citekeyEditor: Pick<CitekeyEditor, "navigationEnabled" | "openCitekey">;
}

export function addCitekeyEditorActions(
  plugin: Pick<Plugin, "addCommand">,
  deps: CitekeyEditorActionDeps,
): void {
  addOpenCitekeyCommand(plugin, deps, {
    id: "open-citekey",
    name: m.command_open_citekey_name(),
    pane: false,
  });
  addOpenCitekeyCommand(plugin, deps, {
    id: "open-citekey-new-tab",
    name: m.command_open_citekey_new_tab_name(),
    pane: "tab",
  });
  // The plugin is `isDesktopOnly`, so split and popout panes always exist.
  addOpenCitekeyCommand(plugin, deps, {
    id: "open-citekey-right",
    name: m.command_open_citekey_right_name(),
    pane: "split",
  });
  addOpenCitekeyCommand(plugin, deps, {
    id: "open-citekey-window",
    name: m.command_open_citekey_window_name(),
    pane: "window",
  });
}

function addOpenCitekeyCommand(
  plugin: Pick<Plugin, "addCommand">,
  deps: CitekeyEditorActionDeps,
  command: { id: string; name: string; pane: NavigationPane },
): void {
  plugin.addCommand({
    id: command.id,
    name: command.name,
    editorCheckCallback(checking, editor) {
      if (!deps.citekeyEditor.navigationEnabled) return false;
      const { state } = editor.cm;
      const citekey = citekeyAtPos(state, state.selection.main.head);
      if (!citekey) return false;
      if (checking) return true;
      logger.debug("Citekey command opens note", {
        citekey,
        command: command.id,
        pane: command.pane,
      });
      void deps.citekeyEditor.openCitekey(citekey, command.pane);
      return true;
    },
  });
}
