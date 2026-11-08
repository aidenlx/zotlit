import type {
  DisplayNode,
  SnippetKind,
  TemplateEngine,
  TreeState,
} from "#/explorer/index";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { Effect } from "effect";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { useUniqueId } from "@zotlit/ui";

import { useWorkbenchModel } from "./editor";
import { fieldSnippet } from "./explorer-fields";
import type { FieldInsertionMode } from "./explorer-fields";
import { explorerSections } from "./explorer-sections";
import type { ExplorerReader } from "./explorer-sections";
import { DisplayTree } from "./explorer-tree";
import type { DisplaySection, FieldRowState } from "./explorer-tree";
import { FieldDetails, placeFieldDetails } from "./field-details";
import type { FieldInsertOptions } from "./field-details";
import { useFieldsPanelRows } from "./fields-panel";
import { useTooltip, useWorkbenchHost } from "./host";
import type {
  WorkbenchClipboardError,
  WorkbenchMenuItem,
  WorkbenchMenuRequest,
} from "./host";
import { composing } from "./ime";
// Both hosts use this field discovery tree. The host owns clipboard, insertion,
// export, popup presentation, and the controlled filtering/expansion state.
import { useWorkbenchMessages } from "./messages";
import type { WorkbenchMessageLabel } from "./messages";
import type { TemplateRoot } from "./model";
import { useIcon, useParts } from "./theme";

import {
  buildDisplayTree,
  buildFilteredDisplayTree,
  copyValue,
  formatPath,
  renderSnippet,
  setFilter,
  snippetKindsFor,
  toggleNode,
} from "#/explorer/index";

export interface ExplorerPresentation {
  top: number;
  left: number;
  field: string | null;
  focus?: boolean;
}

export interface DataExplorerProps {
  restore?: ExplorerPresentation | null;
  onRestored?: () => void;
  onPresentationChange?: (value: ExplorerPresentation) => void;
  /** Section ids the reader has closed; the host keeps them with its view state. */
  collapsedSections: ReadonlySet<string>;
  onCollapsedSectionsChange: (collapsed: ReadonlySet<string>) => void;
  navigation: TreeState;
  onNavigationChange: (navigation: TreeState) => void;
  /** The host distinguishes absent input, loading, and data failures. */
  empty?: ReactNode;
  root: TemplateRoot;
  data: Record<string, unknown> | null;
  mode?: FieldInsertionMode;
  trigger?: string;
  engine?: TemplateEngine;
  /** Evaluated when the menu opens, so the host's JavaScript setting is current. */
  engines?: () => readonly TemplateEngine[];
  disabled?: boolean;
  onInsert?: (snippet: string) => void;
  /**
   * Resolves insertion against the receiving editor at action time; `false`
   * when the editor refused the field. With `keepOpen`, Shift kept the Fields
   * Panel open for the next field, so the editor takes no focus. `kind` is
   * the form the reader chose for a list in its details; absent, the field
   * goes in its first form.
   */
  onInsertNode?: (
    node: DisplayNode,
    options: FieldInsertOptions,
  ) => boolean | void;
  copy: (text: string) => Effect.Effect<void, WorkbenchClipboardError>;
  onExploreAnnotation?: (node: DisplayNode) => void;
  canExploreAnnotation?: (node: DisplayNode) => boolean;
}

/** The name each root goes by in the Explorer's header. */
const ROOT_LABELS: Record<TemplateRoot, WorkbenchMessageLabel> = {
  note: "workbench_fields_root_note",
  annotation: "workbench_fields_root_annotation",
  filename: "workbench_fields_root_filename",
  citation: "workbench_fields_root_citation",
};

/** What each root's field search says it searches. */
const SEARCH_LABELS: Record<TemplateRoot, WorkbenchMessageLabel> = {
  note: "workbench_fields_search_note",
  annotation: "workbench_fields_search_annotation",
  filename: "workbench_fields_search_filename",
  citation: "workbench_fields_search_citation",
};

export function DataExplorer({
  restore,
  onRestored,
  onPresentationChange,
  collapsedSections,
  onCollapsedSectionsChange,
  navigation: tree,
  onNavigationChange,
  empty,
  root,
  data,
  mode = "template",
  trigger,
  engine = "liquid",
  engines,
  disabled = false,
  onInsert,
  onInsertNode,
  copy,
  onExploreAnnotation,
  canExploreAnnotation,
}: DataExplorerProps) {
  const body = useRef<HTMLDivElement>(null);
  const bodyId = useUniqueId();
  const field = useRef<string | null>(null);
  useEffect(() => {
    if (!restore || !body.current || !data) return;
    const element = body.current;
    element.scrollTop = restore.top;
    element.scrollLeft = restore.left;
    field.current = restore.field;
    if (restore.focus && restore.field) {
      const row = [
        ...element.querySelectorAll<HTMLElement>("[data-workbench-field]"),
      ].find((row) => row.dataset.workbenchField === restore.field);
      row
        ?.querySelector<HTMLElement>("button, [tabindex]")
        ?.focus({ preventScroll: true });
    }
    onRestored?.();
  }, [restore, data, onRestored]);
  const m = useWorkbenchMessages();
  const host = useWorkbenchHost();
  const model = useWorkbenchModel();
  const startCopy = useAtomSet(model.copy(useUniqueId()));
  const setFields = useAtomSet(model.fieldsPanel);
  const part = useParts("dataExplorer");
  const insertField =
    onInsertNode ??
    (onInsert
      ? (node: DisplayNode, { kind }: FieldInsertOptions) =>
          onInsert(fieldSnippet(node, mode, { engine, kind }))
      : undefined);
  // An insert closes the Fields Panel and leaves focus to the editor, at the
  // inserted text; Shift keeps the panel open for the next field.
  // It names the field it inserted to a screen reader.
  const insertNode =
    insertField &&
    ((
      node: DisplayNode,
      { keepOpen, kind }: FieldInsertOptions = { keepOpen: false },
    ) => {
      if (insertField(node, { keepOpen, kind }) === false) return;
      host.notice(
        m.workbench_fields_inserted({ field: fieldLabel(node, labels) }),
      );
      if (!keepOpen) setFields("to-editor");
    });
  const locale = host.getLocale();
  const reader = useMemo<ExplorerReader>(
    () => ({ m, root, locale }),
    [m, root, locale],
  );
  // The names top-level fields show, which the filter also searches.
  const labels = useMemo(() => {
    if (!data) return new Map<string, string>();
    const nodes = buildDisplayTree(data, { expanded: new Set() });
    return new Map(
      explorerSections(nodes, reader).flatMap((section) =>
        section.rows.map((row) => [row.node.key, row.label] as const),
      ),
    );
  }, [data, reader]);
  const panelRows = useFieldsPanelRows();
  // The Fields Panel opens a list to its items' properties, never to one
  // item's index; the standalone explorer keeps the items.
  const lists = panelRows ? "shape" : "items";
  const visible = useMemo(() => {
    if (!data) return { nodes: [], matchedKeys: null };
    if (tree.filterQuery)
      return buildFilteredDisplayTree(data, tree.filterQuery, {
        collapsed: tree.filterCollapsed,
        aliases: labels,
        lists,
      });
    return {
      nodes: buildDisplayTree(data, { expanded: tree.expanded, lists }),
      matchedKeys: null,
    };
  }, [data, tree, labels, lists]);
  const filtering = tree.filterQuery !== "";
  // A filter holds every section that still has a row open.
  const sections = useMemo<DisplaySection[]>(
    () =>
      explorerSections(visible.nodes, reader).map((section) => ({
        id: section.id,
        label: section.label,
        collapsed: !filtering && collapsedSections.has(section.id),
        nodes: section.rows.map((row) => row.node),
        labels: new Map(section.rows.map((row) => [row.node.key, row.label])),
      })),
    [visible, reader, filtering, collapsedSections],
  );
  const rows = useFieldRows({
    enabled: panelRows !== null,
    sections,
    labels,
    query: tree.filterQuery,
  });
  const detailsSurface = useRef<HTMLElement>(null);
  const [openRow, setOpenRow] = useState<HTMLElement | null>(null);
  const viewSize = useAtomValue(model.viewSize);
  // The row the open details stand level with, once it is drawn.
  useLayoutEffect(() => {
    const key = rows.open?.node.key ?? null;
    setOpenRow(key === null ? null : rowElement(body.current, key));
  }, [rows.open]);
  // The selected row stays in view as ↑/↓ move it.
  useLayoutEffect(() => {
    if (rows.selected === null) return;
    rowElement(body.current, rows.selected)?.scrollIntoView({
      block: "nearest",
    });
  }, [rows.selected]);
  // A press outside the details and outside their row closes them.
  const openKey = rows.open?.node.key ?? null;
  // Focus the details held as they closed goes back to the search.
  const searchInput = useRef<HTMLInputElement>(null);
  const shownBefore = useRef(false);
  useLayoutEffect(() => {
    const shown = openKey !== null;
    if (shown || !shownBefore.current) {
      shownBefore.current = shown;
      return;
    }
    shownBefore.current = false;
    const doc = body.current?.ownerDocument;
    if (!doc || (doc.activeElement && doc.activeElement !== doc.body)) return;
    searchInput.current?.focus({ preventScroll: true });
  }, [openKey]);
  const { close: closeDetails } = rows;
  useEffect(() => {
    if (openKey === null) return;
    const doc = body.current?.ownerDocument;
    if (!doc) return;
    const away = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      const inside = [
        detailsSurface.current,
        rowElement(body.current, openKey),
      ].some((element) => element?.contains(target));
      if (!inside) closeDetails();
    };
    doc.addEventListener("pointerdown", away, true);
    return () => doc.removeEventListener("pointerdown", away, true);
  }, [openKey, closeDetails]);
  // Escape closes the details, then clears the search, before the panel.
  useLayoutEffect(() => {
    if (!panelRows) return;
    const { escape } = panelRows;
    escape.current = () => {
      if (rows.open) {
        rows.close();
        return true;
      }
      if (tree.filterQuery === "") return false;
      onNavigationChange(setFilter(tree, ""));
      return true;
    };
    return () => {
      escape.current = () => false;
    };
  });
  const insertEntry = (
    entry: FieldEntry,
    options: FieldInsertOptions = { keepOpen: false },
  ) => {
    rows.close();
    insertNode?.(entry.node, options);
  };
  const copyEntry = (entry: FieldEntry, snippet: string) => {
    rows.close();
    startCopy({
      copy: copy(snippet),
      copied: () =>
        host.notice(m.workbench_fields_copied({ field: entry.label })),
      failed: () => host.notice(m.workbench_field_copy_failed()),
    });
  };
  /** ↑/↓ move the selection; Enter shows or hides its details; Mod+Enter inserts it. */
  const onSearchKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!panelRows || composing(event)) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      rows.move(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key !== "Enter") return;
    const entry = rows.entries.find((row) => row.node.key === rows.selected);
    if (!entry) return;
    event.preventDefault();
    if (event.metaKey || event.ctrlKey) {
      if (!disabled) insertEntry(entry);
    } else rows.toggle(entry.node.key);
  };
  // Every section shown closed reads as collapsed; the button opens them all
  // then, and closes them all otherwise. A filter holds its sections open.
  const sectionIds = sections.map((section) => section.id);
  const allCollapsed =
    sectionIds.length > 0 &&
    sectionIds.every((id) => collapsedSections.has(id));
  const sectionsLabel = allCollapsed
    ? m.workbench_explorer_expand_all()
    : m.workbench_explorer_collapse_all();
  const sectionsTooltip = useTooltip(sectionsLabel);
  const icon = useIcon();
  const toggleSection = (id: string) => {
    const next = new Set(collapsedSections);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onCollapsedSectionsChange(next);
  };
  const copyMenu = (text: string) =>
    startCopy({
      copy: copy(text),
      copied: () => host.notice(m.workbench_field_copy_done()),
      failed: () => host.notice(m.workbench_field_copy_failed()),
    });
  const menuEntries = (node: DisplayNode) => {
    const value = copyValue(node);
    const items: WorkbenchMenuItem[] = [
      {
        label: m.workbench_explorer_menu_copy_path(),
        onSelect: () => copyMenu(formatPath(node.path, "zt")),
      },
      {
        label: m.workbench_explorer_menu_copy_value(),
        disabled: value === null,
        onSelect: () => {
          if (value !== null) copyMenu(value);
        },
      },
    ];
    if (insertNode && !disabled)
      items.unshift({
        label: m.workbench_fields_put_in_note(),
        onSelect: () => insertNode(node),
      });
    const labels = {
      output: m.workbench_explorer_menu_copy_output,
      "if-present": m.workbench_explorer_menu_copy_if_present,
      loop: m.workbench_explorer_menu_copy_loop,
      joined: m.workbench_explorer_menu_copy_joined,
    };
    const languages = engines?.() ?? [engine];
    const submenus: NonNullable<WorkbenchMenuRequest["submenus"]>[number][] =
      [];
    for (const language of languages) {
      const snippets = snippetKindsFor(node).map((kind) => ({
        label: labels[kind](),
        onSelect: () => copyMenu(renderSnippet(node, language, kind)),
      }));
      if (languages.length > 1)
        submenus.push({
          label: language === "eta" ? "Eta" : "Liquid",
          items: snippets,
        });
      else items.push(...snippets);
    }
    if (onExploreAnnotation && canExploreAnnotation?.(node))
      items.push({
        label: m.workbench_explorer_menu_explore_annotation(),
        onSelect: () => onExploreAnnotation(node),
      });
    return { items, submenus };
  };
  /** The row's Menu from its own control, anchored under that control. */
  const openTemplateMenu = (node: DisplayNode, event: React.MouseEvent) => {
    host.menu({
      anchor: event.currentTarget as HTMLElement,
      ...menuEntries(node),
    });
  };
  /** The same Menu from a right-click on the row, anchored at the pointer. */
  const openFieldContextMenu = (node: DisplayNode, event: React.MouseEvent) => {
    host.menu({
      anchor: event.currentTarget as HTMLElement,
      pointerEvent: event.nativeEvent,
      ...menuEntries(node),
    });
  };
  const sectionsButton = (
    <button
      type="button"
      aria-label={sectionsLabel}
      disabled={filtering || sectionIds.length === 0}
      onClick={() =>
        onCollapsedSectionsChange(
          allCollapsed ? new Set() : new Set(sectionIds),
        )
      }
      {...sectionsTooltip}
      {...part("sections-toggle")}
    >
      {icon(allCollapsed ? "expand-all" : "collapse-all")}
    </button>
  );
  const search = m[SEARCH_LABELS[root]]();
  /** What an insert of `node` in the form `kind` puts into the note. */
  const snippetOf = (node: DisplayNode, kind?: SnippetKind) =>
    fieldSnippet(node, mode, { engine, kind });
  return (
    <section {...part("explorer")}>
      <div {...part("header")}>
        <h2 {...part("heading")}>{m.workbench_fields_heading()}</h2>
        <span {...part("root-label")}>{m[ROOT_LABELS[root]]()}</span>
      </div>
      <div {...part("search-row")}>
        <input
          ref={searchInput}
          type="search"
          value={tree.filterQuery}
          aria-label={search}
          placeholder={search}
          {...(panelRows && {
            role: "combobox",
            "aria-expanded": true,
            "aria-autocomplete": "list" as const,
            "aria-controls": bodyId,
            "aria-activedescendant":
              rows.selected === null ? undefined : rows.idOf(rows.selected),
          })}
          {...part("search")}
          onKeyDown={onSearchKey}
          onChange={(event) =>
            onNavigationChange(setFilter(tree, event.currentTarget.value))
          }
        />
      </div>
      {/* The Fields Panel's header holds the button that collapses or
          expands every section. */}
      {panelRows?.actions && createPortal(sectionsButton, panelRows.actions)}
      <div
        ref={body}
        id={bodyId}
        {...part("body")}
        onScroll={(event) =>
          onPresentationChange?.({
            top: event.currentTarget.scrollTop,
            left: event.currentTarget.scrollLeft,
            field: field.current,
          })
        }
        onFocusCapture={(event) => {
          field.current =
            (event.target as HTMLElement).closest<HTMLElement>(
              "[data-workbench-field]",
            )?.dataset.workbenchField ?? null;
          onPresentationChange?.({
            top: event.currentTarget.scrollTop,
            left: event.currentTarget.scrollLeft,
            field: field.current,
          });
        }}
      >
        {sections.length === 0 ? (
          (empty ?? (
            <p {...part("empty")}>
              {data === null
                ? m.workbench_fields_no_annotations()
                : m.workbench_fields_no_matches()}
            </p>
          ))
        ) : (
          <DisplayTree
            sections={sections}
            matchedKeys={visible.matchedKeys}
            onToggle={(key) => onNavigationChange(toggleNode(tree, key))}
            onToggleSection={filtering ? undefined : toggleSection}
            onInsert={
              insertNode && !disabled
                ? (node, keepOpen) => insertNode(node, { keepOpen })
                : undefined
            }
            onTemplateMenu={openTemplateMenu}
            onFieldContextMenu={openFieldContextMenu}
            rows={
              panelRows
                ? {
                    ...rows.state,
                    // The search keeps the keys: a press on a row, which
                    // takes no focus itself, hands it back there.
                    onRowClick: (node) => {
                      rows.state.onRowClick(node);
                      searchInput.current?.focus({ preventScroll: true });
                    },
                  }
                : undefined
            }
          />
        )}
      </div>
      {rows.open && (
        <FieldDetails
          key={rows.open.node.key}
          placement={placeFieldDetails(viewSize)}
          row={openRow}
          surface={detailsSurface}
          node={rows.open.node}
          label={rows.open.label}
          context={rows.open.context}
          snippet={(kind) => snippetOf(rows.open!.node, kind)}
          onInsert={
            insertNode && !disabled
              ? (options) => insertEntry(rows.open!, options)
              : undefined
          }
          onCopy={(kind) =>
            copyEntry(rows.open!, snippetOf(rows.open!.node, kind))
          }
          onClose={rows.close}
        />
      )}
      {trigger && (
        <p {...part("hint")}>{m.workbench_fields_trigger_hint({ trigger })}</p>
      )}
      {panelRows && (
        <p {...part("keys-hint")}>
          {m.workbench_fields_details_hint({ insert: insertShortcut() })}
        </p>
      )}
    </section>
  );
}

/** One row the reader can select in the Fields Panel, as its row names it. */
interface FieldEntry {
  readonly node: DisplayNode;
  readonly label: string;
  /** Its section, and the field it belongs to. */
  readonly context: string;
}

/**
 * The name a field goes by on every surface of the Fields Panel: its row, its
 * details, and what an insert or a copy announces. A top-level field has its
 * reader-facing name in `labels`; a nested one shows its key.
 */
export function fieldLabel(
  node: DisplayNode,
  labels: ReadonlyMap<string, string>,
): string {
  return labels.get(node.key) ?? node.label;
}

/** Every row the sections show, in order, with the names its details show. */
function fieldEntries(
  sections: readonly DisplaySection[],
  labels: ReadonlyMap<string, string>,
): FieldEntry[] {
  const entries: FieldEntry[] = [];
  const visit = (nodes: readonly DisplayNode[], context: string) => {
    for (const node of nodes) {
      const label = fieldLabel(node, labels);
      entries.push({ node, label, context });
      if (node.kind === "value" && node.children)
        visit(node.children, `${context} · ${label}`);
    }
  };
  for (const section of sections)
    if (!section.collapsed) visit(section.nodes, section.label);
  return entries;
}

/**
 * The selected row and the row whose details stand open in the Fields Panel.
 * A new search starts both over; a row the sections no longer show has
 * neither.
 */
function useFieldRows({
  enabled,
  sections,
  labels,
  query,
}: {
  enabled: boolean;
  sections: readonly DisplaySection[];
  labels: ReadonlyMap<string, string>;
  query: string;
}) {
  const prefix = useUniqueId();
  const [state, setState] = useState({
    query,
    selected: null as string | null,
    open: null as string | null,
  });
  let { selected, open } = state;
  if (state.query !== query) {
    selected = null;
    open = null;
    setState({ query, selected, open });
  }
  const entries = useMemo(
    () => (enabled ? fieldEntries(sections, labels) : []),
    [enabled, sections, labels],
  );
  const index = new Map(entries.map((entry, at) => [entry.node.key, at]));
  if (selected !== null && !index.has(selected)) selected = null;
  const openEntry =
    open === null ? null : (entries[index.get(open) ?? -1] ?? null);
  const idOf = (key: string) => `${prefix}-row-${index.get(key) ?? -1}`;
  const [close] = useState(
    () => () => setState((last) => ({ ...last, open: null })),
  );
  const toggle = (key: string) =>
    setState((last) => ({
      ...last,
      selected: key,
      open: last.open === key ? null : key,
    }));
  const move = (step: 1 | -1) => {
    if (entries.length === 0) return;
    const at = selected === null ? -1 : index.get(selected)!;
    const next =
      at < 0
        ? step > 0
          ? 0
          : entries.length - 1
        : Math.min(entries.length - 1, Math.max(0, at + step));
    setState((last) => ({ ...last, selected: entries[next]!.node.key }));
  };
  const rowState: FieldRowState = {
    selected,
    open: openEntry?.node.key ?? null,
    idOf,
    onRowClick: (node) => toggle(node.key),
  };
  return {
    entries,
    selected,
    open: openEntry,
    idOf,
    close,
    toggle,
    move,
    state: rowState,
  };
}

/** The element of the row for `key` in `body`. */
function rowElement(body: HTMLElement | null, key: string): HTMLElement | null {
  const item = [
    ...(body?.querySelectorAll<HTMLElement>("[data-workbench-field]") ?? []),
  ].find((element) => element.dataset.workbenchField === key);
  return item?.querySelector<HTMLElement>(":scope > [data-part=row]") ?? null;
}

/** The shortcut that inserts the selected field, as the platform names it. */
function insertShortcut(): string {
  return /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? "Command+Enter"
    : "Ctrl+Enter";
}
