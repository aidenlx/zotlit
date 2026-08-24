import { Menu } from "obsidian";
import type {
  Setting,
  SettingDefinitionItem,
  SettingDefinitionPage,
} from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { libraryLabel, selectorLabel } from "@/services/library-scope/label";
import {
  compareSelectors,
  DEFAULT_LIBRARY_SCOPE,
  MY_LIBRARY_SCOPE,
  selectorKey,
} from "@/services/library-scope/scope";
import type {
  AvailableLibrary,
  LibraryScope,
  LibrarySelector,
} from "@/services/library-scope/scope";

import type { SettingsKey, SettingTabContext } from "./context";

/** One selected Library as the list renders it. */
interface SelectedEntry {
  selector: LibrarySelector;
  label: string;
  /** This database holds no Library for the selector; it stays selected. */
  unavailable: boolean;
}

/** The Library sub-page: the library-scope rows, on their own navigable page. */
export function libraryPage(
  ctx: SettingTabContext,
): SettingDefinitionPage<SettingsKey> {
  return {
    type: "page",
    name: m.settings_page_library(),
    desc: m.settings_page_library_desc(),
    items: libraryScopeItems(ctx),
  };
}

/**
 * Library scope rows: the All / Selected choice and, under Selected, the
 * editable list of stable selectors.
 *
 * Every control here reads the *effective* scope — the runtime My Library
 * fallback while the saved value is broken — so what the user edits is what
 * ZotLit is using. The first valid edit replaces the broken value on disk and
 * clears both the inline warning and the one-off notice.
 *
 * While the Zotero database is unreadable the scope cannot be resolved, so the
 * controls disable and the saved value is left alone. That is distinct from a
 * resolvable scope with no available Library, which stays editable.
 */
function libraryScopeItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  const scope = ctx.libraryScope.effective;
  const editable = isEditable(ctx);
  const entries = selectedEntries(ctx, scope);

  return [
    {
      name: m.settings_library_scope_name(),
      desc: describeScope(ctx),
      render: (setting) => renderModeRow(setting, ctx, scope),
    },
    {
      type: "list",
      heading: m.settings_library_scope_selected(),
      visible: () => scope.mode === "selected",
      // The final selected Library has no delete affordance at all: Selected
      // Libraries is never allowed to become empty.
      onDelete:
        editable && entries.length > 1
          ? (index) => removeSelector(ctx, scope, index)
          : undefined,
      addItem: editable
        ? {
            name: m.settings_library_scope_add(),
            action: (el) => openAddMenu(el, ctx, scope),
          }
        : undefined,
      items: entries.map((entry) => ({
        name: entry.label,
        desc: entry.unavailable
          ? m.settings_library_scope_unavailable()
          : undefined,
        searchable: false,
      })),
    },
  ];
}

/**
 * Whether the controls accept an edit. An unreadable database lists no Library,
 * so the rows disable and the saved value is left exactly as it is.
 */
function isEditable(ctx: SettingTabContext): boolean {
  return ctx.libraryScope.current !== null;
}

function describeScope(ctx: SettingTabContext): DocumentFragment {
  const desc = createFragment();
  desc.append(m.settings_library_scope_desc());
  const warning = ctx.libraryScope.invalid
    ? m.settings_library_scope_invalid()
    : ctx.libraryScope.current === null
      ? m.settings_library_scope_db_unavailable()
      : null;
  if (warning) {
    desc.append(createEl("br"));
    const warningEl = createSpan({ cls: "mod-warning", text: warning });
    desc.append(warningEl);
  }
  return desc;
}

function renderModeRow(
  setting: Setting,
  ctx: SettingTabContext,
  scope: LibraryScope,
): void {
  setting.addDropdown((dropdown) => {
    dropdown
      .addOption("all", m.settings_library_scope_all())
      .addOption("selected", m.settings_library_scope_selected())
      .setValue(scope.mode)
      .setDisabled(!isEditable(ctx))
      .onChange((value) => {
        // Selected starts at My Library; All discards the prior selection.
        saveScope(
          ctx,
          value === "all" ? DEFAULT_LIBRARY_SCOPE : MY_LIBRARY_SCOPE,
        );
      });
  });
}

/**
 * The saved selectors paired with their live names. An unavailable selector
 * keeps its place and shows its group id, since no name is persisted for it.
 */
function selectedEntries(
  ctx: SettingTabContext,
  scope: LibraryScope,
): SelectedEntry[] {
  if (scope.mode !== "selected") return [];
  const resolved = ctx.libraryScope.current;
  const byKey = new Map(
    resolved?.available.map((library) => [
      selectorKey(library.selector),
      library,
    ]),
  );
  return scope.libraries.map((selector) => {
    const library = byKey.get(selectorKey(selector));
    return {
      selector,
      label: library ? libraryLabel(library) : selectorLabel(selector),
      // An unreadable database knows of no missing Library, only of none.
      unavailable: resolved !== null && library === undefined,
    };
  });
}

/** Every Library of the active database that this selection does not name. */
function addableLibraries(
  ctx: SettingTabContext,
  scope: LibraryScope,
): AvailableLibrary[] {
  if (scope.mode !== "selected") return [];
  const selected = new Set(scope.libraries.map(selectorKey));
  return ctx.libraryScope.libraries.filter(
    (library) => !selected.has(selectorKey(library.selector)),
  );
}

function openAddMenu(
  el: HTMLElement,
  ctx: SettingTabContext,
  scope: LibraryScope,
): void {
  const candidates = addableLibraries(ctx, scope);
  const menu = new Menu();
  if (candidates.length === 0) {
    menu.addItem((item) =>
      item.setTitle(m.settings_library_scope_add_none()).setDisabled(true),
    );
  }
  for (const library of candidates) {
    menu.addItem((item) =>
      item
        .setTitle(libraryLabel(library))
        .onClick(() => addSelector(ctx, scope, library.selector)),
    );
  }
  const rect = el.getBoundingClientRect();
  menu.showAtPosition({ x: rect.left, y: rect.bottom });
}

function addSelector(
  ctx: SettingTabContext,
  scope: LibraryScope,
  selector: LibrarySelector,
): void {
  if (scope.mode !== "selected") return;
  saveScope(ctx, {
    mode: "selected",
    libraries: [...scope.libraries, selector].sort(compareSelectors),
  });
}

function removeSelector(
  ctx: SettingTabContext,
  scope: LibraryScope,
  index: number,
): void {
  if (scope.mode !== "selected") return;
  const libraries = scope.libraries.filter((_, at) => at !== index);
  if (libraries.length === 0) return;
  saveScope(ctx, { mode: "selected", libraries });
}

/** Persist and rebuild the tab, so the list rows follow the new selection. */
function saveScope(ctx: SettingTabContext, scope: LibraryScope): void {
  ctx.settings.update({ "zotero.library-scope": scope });
  ctx.requestUpdate();
}
