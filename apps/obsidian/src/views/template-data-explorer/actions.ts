// Action bindings for the Template Data Explorer, exposed to the presentational tree via context.
import { Menu } from "obsidian";
import { createContext } from "react";

import * as m from "@/lib/i18n/generated/messages";
import * as toast from "@/lib/toast";
import type { IndexedKeyCopyTarget } from "@/services/indexed-key/actions";
import { addCopyIndexedKeyMenuItem } from "@/services/indexed-key/menu";

import { copyValue, formatPath } from "./display-tree";
import type { DisplayNode } from "./display-tree";
import { renderSnippet, snippetKindsFor } from "./snippets";
import type { SnippetKind, TemplateEngine } from "./snippets";

const SNIPPET_LABEL: Record<SnippetKind, () => string> = {
  output: m.template_data_explorer_menu_copy_output,
  "if-present": m.template_data_explorer_menu_copy_if_present,
  loop: m.template_data_explorer_menu_copy_loop,
  joined: m.template_data_explorer_menu_copy_joined,
};

const SNIPPET_ICON: Record<SnippetKind, string> = {
  output: "code",
  "if-present": "git-branch",
  loop: "repeat",
  joined: "list",
};

const ENGINE_ICON: Record<TemplateEngine, string> = {
  liquid: "droplet",
  eta: "braces",
};

const ENGINE_SUBMENUS: readonly (readonly [TemplateEngine, () => string])[] = [
  ["liquid", m.template_data_explorer_submenu_liquid],
  ["eta", m.template_data_explorer_submenu_eta],
];

export interface ExplorerActions {
  onChooseItem(): void;
  onToggle(key: string): void;
  /** Copy the node's value; resolves on a successful write so the row icon can flash a confirmation. */
  onCopyValue(node: DisplayNode): Promise<void>;
  /** Open the per-row template-actions menu: copy-path plus explore-as-annotation-root when applicable. */
  onTemplateMenu(node: DisplayNode, event: React.MouseEvent): void;
  onBackToNoteRoot(): void;
  onFilter(query: string): void;
  onRefresh(): void;
  addCopyKeyMenuItem(menu: Menu): boolean;
}

export function createExplorerActions(deps: {
  onChooseItem(this: void): void;
  onToggle(this: void, key: string): void;
  onFilter(this: void, query: string): void;
  /** `null` unless `node` is a top-level `annotations[i]` entry and the tree isn't already anchored. */
  annotationKeyAt(node: DisplayNode): string | null;
  onAnchorAnnotation(key: string): void;
  onBackToNoteRoot(this: void): void;
  onRefresh(this: void): void;
  /** Whether Eta is permitted on this device; read live per menu-open so it tracks the JavaScript Templates gate. */
  isEtaEnabled(this: void): boolean;
  copyTarget(this: void): IndexedKeyCopyTarget | null;
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

    const addSnippetItem = (
      target: Menu,
      engine: TemplateEngine,
      kind: SnippetKind,
    ): void => {
      target.addItem((item) => {
        item
          .setTitle(SNIPPET_LABEL[kind]())
          .setIcon(SNIPPET_ICON[kind])
          .onClick(() => {
            void copyToClipboard(
              renderSnippet(node, engine, kind),
              m.template_data_explorer_copied_snippet(),
            );
          });
      });
    };

    // The bare `zt.…` path is engine-neutral (both engines bind data to `zt`),
    // so one copy-path serves both; the wrapped snippets below diverge by engine.
    menu.addItem((item) => {
      item
        .setTitle(m.template_data_explorer_menu_copy_path())
        .setIcon("copy")
        .onClick(() => {
          void copyToClipboard(
            formatPath(node.path, "zt"),
            m.template_data_explorer_copied_path(),
          );
        });
    });

    const kinds = snippetKindsFor(node);
    if (kinds.length > 0) {
      menu.addSeparator();
      if (deps.isEtaEnabled()) {
        // Both engines apply: split into submenus so each snippet reads unambiguously.
        for (const [engine, title] of ENGINE_SUBMENUS) {
          menu.addItem((item) => {
            item.setTitle(title()).setIcon(ENGINE_ICON[engine]);
            const sub = item.setSubmenu();
            for (const kind of kinds) addSnippetItem(sub, engine, kind);
          });
        }
      } else {
        // Liquid alone is active — its snippets sit inline, no needless submenu.
        for (const kind of kinds) addSnippetItem(menu, "liquid", kind);
      }
    }

    const annotationKey = deps.annotationKeyAt(node);
    if (annotationKey !== null) {
      menu.addSeparator();
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
    addCopyKeyMenuItem(menu) {
      return addCopyIndexedKeyMenuItem(menu, deps.copyTarget(), {
        section: "zotlit",
      });
    },
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
  addCopyKeyMenuItem: () => false,
};

export const ExplorerActionsContext =
  createContext<ExplorerActions>(NOOP_ACTIONS);
