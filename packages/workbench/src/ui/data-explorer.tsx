import type { DisplayNode, TemplateEngine, TreeState } from "#/explorer/index";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { Effect } from "effect";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { useUniqueId } from "@zotlit/ui";
import { composing } from "@zotlit/ui";

import { useWorkbenchModel } from "./editor";
import { explorerSections, listPropertyLabels } from "./explorer-sections";
import type { ExplorerReader } from "./explorer-sections";
import { DisplayTree } from "./explorer-tree";
import type { DisplaySection, FieldRowState } from "./explorer-tree";
import { FieldDetails, placeFieldDetails } from "./field-details";
import { fieldForm, fieldForms, TEMPLATE_INSERTION } from "./field-insertion";
import type {
  FieldForm,
  FieldInsertionContext,
  FieldInsertOptions,
} from "./field-insertion";
import { useFieldsPanelRows } from "./fields-panel";
import { useTooltip, useWorkbenchHost } from "./host";
import type {
  WorkbenchClipboardError,
  WorkbenchMenuItem,
  WorkbenchMenuRequest,
} from "./host";
// Both hosts use this field discovery tree. The host owns clipboard, insertion,
// export, popup presentation, and the controlled filtering/expansion state.
import { useWorkbenchMessages } from "./messages";
import type { WorkbenchMessageLabel } from "./messages";
import { announceFields } from "./model";
import type { TemplateRoot } from "./model";
import { useIcon, useParts } from "./theme";

import {
  buildDisplayTree,
  buildFilteredDisplayTree,
  copyValue,
  formatPath,
  setFilter,
  toggleNode,
} from "#/explorer/index";

/**
 * How one insert goes: `keepOpen` as {@link FieldInsertOptions} has it, and
 * the `form` the reader picked in the details, the field's first otherwise.
 */
interface FieldInsertRequest {
  readonly keepOpen?: boolean;
  readonly form?: FieldForm;
}

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
  trigger?: string;
  /**
   * Where an insert writes now, read as the details draw and at the time of
   * each insert or copy; a Liquid template by default.
   */
  insertion?: () => FieldInsertionContext;
  /** Evaluated when the menu opens, so the host's JavaScript setting is current. */
  engines?: () => readonly TemplateEngine[];
  disabled?: boolean;
  /**
   * Writes a field's text at the receiving editor's insertion target;
   * `false` when the editor refused it.
   */
  onInsert?: (text: string, options: FieldInsertOptions) => boolean | void;
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
  trigger,
  insertion = () => TEMPLATE_INSERTION,
  engines,
  disabled = false,
  onInsert,
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
  const setStatus = useAtomSet(model.fieldsStatus);
  /** Says `text` in a notice, and to a screen reader in the panels' live region. */
  const announce = (text: string) => {
    host.notice(text);
    setStatus(announceFields(text));
  };
  const part = useParts("dataExplorer");
  // An insert writes the field in its first form, or the form the reader
  // picked in its details, as the place the caret is in reads it. It closes
  // the Fields Panel and leaves focus to the editor, at the inserted text;
  // Shift keeps the panel open for the next field. It names the field it
  // inserted to a screen reader.
  const insertNode =
    onInsert &&
    ((
      node: DisplayNode,
      {
        keepOpen = false,
        form = fieldForm(node, insertion()),
      }: FieldInsertRequest = {},
    ) => {
      if (onInsert(form.snippet, { keepOpen }) === false) return;
      announce(
        m.workbench_fields_inserted({ field: fieldLabel(node, labels) }),
      );
      if (!keepOpen) setFields("to-editor");
    });
  const locale = host.getLocale();
  const reader = useMemo<ExplorerReader>(
    () => ({ m, root, locale }),
    [m, root, locale],
  );
  // The names top-level fields and the properties of list items show,
  // which the filter also searches.
  const labels = useMemo(() => {
    if (!data) return new Map<string, string>();
    const nodes = buildDisplayTree(data, { expanded: new Set() });
    return new Map([
      ...explorerSections(nodes, reader).flatMap((section) =>
        section.rows.map((row) => [row.node.key, row.label] as const),
      ),
      ...listPropertyLabels(nodes, reader),
    ]);
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
  /** Whether an insert can write now: the host takes fields and the editor has a place for one. */
  const canInsert = insertNode !== undefined && !disabled;
  // A filter holds every section that still has a row open.
  const sections = useMemo<DisplaySection[]>(
    () =>
      explorerSections(visible.nodes, reader).map((section) => ({
        id: section.id,
        label: section.label,
        collapsed: !filtering && collapsedSections.has(section.id),
        nodes: section.rows.map((row) => row.node),
        labels,
      })),
    [visible, reader, filtering, collapsedSections, labels],
  );
  const rows = useFieldRows({
    enabled: panelRows !== null,
    sections,
    labels,
    query: tree.filterQuery,
  });
  // A search that matches nothing says so to a screen reader in the panel,
  // for as long as it matches nothing: the sentence goes once the search
  // matches again or is cleared.
  const noMatches =
    panelRows !== null && data !== null && filtering && sections.length === 0;
  useEffect(() => {
    const text = m.workbench_fields_no_matches();
    if (noMatches) setStatus(announceFields(text));
    else setStatus((last) => (last?.text === text ? null : last));
  }, [noMatches, setStatus, m]);
  const detailsSurface = useRef<HTMLElement>(null);
  const [openRow, setOpenRow] = useState<HTMLElement | null>(null);
  const viewSize = useAtomValue(model.viewSize);
  // The row the open details stand level with, once it is drawn.
  useLayoutEffect(() => {
    const key = rows.open?.node.key ?? null;
    setOpenRow(key === null ? null : rowElement(body.current, key));
  }, [rows.open]);
  // The selected row stays in view as ↑/↓ move it, clear of its section's
  // sticky heading. Only a move scrolls: a selection a collapse hid and an
  // expand shows again stays where the list draws it.
  const { reveal } = rows;
  useLayoutEffect(() => {
    if (reveal === null || !body.current) return;
    const row = rowElement(body.current, reveal.key);
    if (row) revealRow(body.current, row);
  }, [reveal]);
  // A collapse or an expand keeps the heading or row the reader pressed at
  // the height it stood in the list, so the list moves around it: a stuck
  // section heading stays in view as its section closes beneath it.
  const held = useRef<{ element: HTMLElement; top: number } | null>(null);
  const holdInPlace = (element: HTMLElement | null | undefined) => {
    held.current =
      element && body.current
        ? { element, top: offsetIn(body.current, element) }
        : null;
  };
  useLayoutEffect(() => {
    const hold = held.current;
    held.current = null;
    if (!hold || !body.current || !hold.element.isConnected) return;
    body.current.scrollTop += offsetIn(body.current, hold.element) - hold.top;
  }, [sections]);
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
  const insertEntry = (entry: FieldEntry, request?: FieldInsertRequest) => {
    rows.close();
    insertNode?.(entry.node, request);
  };
  const copyEntry = (entry: FieldEntry, form: FieldForm) => {
    rows.close();
    startCopy({
      copy: copy(form.snippet),
      copied: () => announce(m.workbench_fields_copied({ field: entry.label })),
      failed: () => announce(m.workbench_field_copy_failed()),
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
      if (canInsert) insertEntry(entry);
      else announce(m.workbench_fields_choose_place());
      // Details Enter opens take focus, so the keys reach their controls.
    } else rows.toggle(entry.node.key, { focus: true });
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
    holdInPlace(sectionHeading(body.current, id));
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
    // The menu copies what an insert at the caret writes. A template offers
    // each engine the reader may write in; a Properties value reads the
    // field itself, in no engine.
    const context = insertion();
    const languages =
      context.mode === "template"
        ? (engines?.() ?? [context.engine])
        : [context.engine];
    const submenus: NonNullable<WorkbenchMenuRequest["submenus"]>[number][] =
      [];
    for (const language of languages) {
      const snippets = fieldForms(
        node,
        { ...context, engine: language },
        { every: true },
      ).map((form) => ({
        label: labels[form.kind](),
        onSelect: () => copyMenu(form.snippet),
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
      onClick={() => {
        // The section at the top of the list stays there.
        holdInPlace(topSectionHeading(body.current));
        onCollapsedSectionsChange(
          allCollapsed ? new Set() : new Set(sectionIds),
        );
      }}
      {...sectionsTooltip}
      {...part("sections-toggle")}
    >
      {icon(allCollapsed ? "expand-all" : "collapse-all")}
    </button>
  );
  const search = m[SEARCH_LABELS[root]]();
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
            onToggle={(key) => {
              holdInPlace(rowElement(body.current, key));
              onNavigationChange(toggleNode(tree, key));
            }}
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
          forms={fieldForms(rows.open.node, insertion())}
          takeFocus={rows.focusDetails}
          onInsert={
            insertNode && !disabled
              ? (form, { keepOpen }) =>
                  insertEntry(rows.open!, { keepOpen, form })
              : undefined
          }
          onCopy={(form) => copyEntry(rows.open!, form)}
          onClose={rows.close}
          onTabOut={() => searchInput.current?.focus({ preventScroll: true })}
        />
      )}
      {trigger && (
        <p {...part("hint")}>{m.workbench_fields_trigger_hint({ trigger })}</p>
      )}
      {panelRows && (
        <p {...part("keys-hint")}>
          {canInsert
            ? m.workbench_fields_details_hint({
                insert:
                  host.fieldsAction?.insertShortcut ??
                  m.workbench_fields_insert_key(),
              })
            : // With no place to insert, the hint promises no insert and says why.
              m.workbench_fields_details_hint_no_place({
                hint: m.workbench_fields_details_hint_view(),
                reason: m.workbench_fields_choose_place(),
              })}
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
    focus: false,
    /** The row the last ↑/↓ moved to, which the list scrolls into view. */
    reveal: null as { readonly key: string } | null,
  });
  let { selected, open } = state;
  if (state.query !== query) {
    selected = null;
    open = null;
    setState({ query, selected, open, focus: false, reveal: null });
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
  /** Shows or hides the details of `key`; with `focus`, the details take focus as they open. */
  const toggle = (key: string, { focus = false }: { focus?: boolean } = {}) =>
    setState((last) => ({
      ...last,
      selected: key,
      open: last.open === key ? null : key,
      focus,
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
    const key = entries[next]!.node.key;
    setState((last) => ({ ...last, selected: key, reveal: { key } }));
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
    /** Whether the open details take focus as they draw: Enter opened them. */
    focusDetails: state.focus,
    reveal: state.reveal,
    idOf,
    close,
    toggle,
    move,
    state: rowState,
  };
}

/**
 * Scrolls `body` the least that shows `row` whole, below the sticky heading
 * of the section it stands in, which would otherwise cover it.
 */
function revealRow(body: HTMLElement, row: HTMLElement): void {
  const heading = row
    .closest("[data-workbench-section]")
    ?.querySelector<HTMLElement>(":scope > [data-part=section-heading]");
  const view = body.getBoundingClientRect();
  const box = row.getBoundingClientRect();
  const top = view.top + (heading?.offsetHeight ?? 0);
  if (box.top < top) body.scrollTop -= top - box.top;
  else if (box.bottom > view.bottom) body.scrollTop += box.bottom - view.bottom;
}

/** How far `element` stands below the top of the list `body` shows. */
function offsetIn(body: HTMLElement, element: HTMLElement): number {
  return element.getBoundingClientRect().top - body.getBoundingClientRect().top;
}

/** The heading of the section `id` in `body`. */
function sectionHeading(
  body: HTMLElement | null,
  id: string,
): HTMLElement | null {
  const section = [
    ...(body?.querySelectorAll<HTMLElement>("[data-workbench-section]") ?? []),
  ].find((element) => element.dataset.workbenchSection === id);
  return (
    section?.querySelector<HTMLElement>(
      ":scope > [data-part=section-heading]",
    ) ?? null
  );
}

/** The heading of the section the top of the list `body` shows. */
function topSectionHeading(body: HTMLElement | null): HTMLElement | null {
  if (!body) return null;
  const top = body.getBoundingClientRect().top;
  const section = [
    ...body.querySelectorAll<HTMLElement>("[data-workbench-section]"),
  ].find((element) => element.getBoundingClientRect().bottom > top);
  return (
    section?.querySelector<HTMLElement>(
      ":scope > [data-part=section-heading]",
    ) ?? null
  );
}

/** The element of the row for `key` in `body`. */
function rowElement(body: HTMLElement | null, key: string): HTMLElement | null {
  const item = [
    ...(body?.querySelectorAll<HTMLElement>("[data-workbench-field]") ?? []),
  ].find((element) => element.dataset.workbenchField === key);
  return item?.querySelector<HTMLElement>(":scope > [data-part=row]") ?? null;
}
