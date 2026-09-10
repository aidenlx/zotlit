import type { DisplayNode, TemplateEngine, TreeState } from "#/explorer/index";
import { useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";

import { fieldSnippet } from "./explorer-fields";
import type { FieldInsertionMode } from "./explorer-fields";
import { explorerSections } from "./explorer-sections";
import type { ExplorerReader } from "./explorer-sections";
import { DisplayTree } from "./explorer-tree";
import type { DisplaySection } from "./explorer-tree";
import { useWorkbenchHost } from "./host";
import type { WorkbenchMenuItem, WorkbenchMenuRequest } from "./host";
// Both hosts use this field discovery tree. The host owns clipboard, insertion,
// export, popup presentation, and the controlled filtering/expansion state.
import { useWorkbenchMessages } from "./messages";
import type { TemplateRoot } from "./store";
import { useParts } from "./theme";

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
  /** Resolves insertion against the receiving editor at action time. */
  onInsertNode?: (node: DisplayNode) => void;
  copy: (text: string) => Promise<void>;
  onExploreAnnotation?: (node: DisplayNode) => void;
  canExploreAnnotation?: (node: DisplayNode) => boolean;
}

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
  const part = useParts("dataExplorer");
  const insertNode =
    onInsertNode ??
    (onInsert
      ? (node: DisplayNode) => onInsert(fieldSnippet(node, mode, { engine }))
      : undefined);
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
  const visible = useMemo(() => {
    if (!data) return { nodes: [], matchedKeys: null };
    if (tree.filterQuery)
      return buildFilteredDisplayTree(data, tree.filterQuery, {
        collapsed: tree.filterCollapsed,
        aliases: labels,
      });
    return {
      nodes: buildDisplayTree(data, { expanded: tree.expanded }),
      matchedKeys: null,
    };
  }, [data, tree, labels]);
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
  const toggleSection = (id: string) => {
    const next = new Set(collapsedSections);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onCollapsedSectionsChange(next);
  };
  const copyMenu = (text: string) => {
    void copy(text).then(
      () => host.notice(m.workbench_field_copy_done()),
      () => host.notice(m.workbench_field_copy_failed()),
    );
  };
  const menu = (node: DisplayNode, event: React.MouseEvent) => {
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
    host.menu({ anchor: event.currentTarget as HTMLElement, items, submenus });
  };
  const search =
    root === "annotation"
      ? m.workbench_fields_search_annotation()
      : root === "filename"
        ? m.workbench_fields_search_filename()
        : m.workbench_fields_search_note();
  return (
    <section {...part("explorer")}>
      <div {...part("header")}>
        <h2 {...part("heading")}>{m.workbench_fields_heading()}</h2>
        <span {...part("root-label")}>
          {root === "annotation"
            ? m.workbench_fields_root_annotation()
            : root === "filename"
              ? m.workbench_fields_root_filename()
              : m.workbench_fields_root_note()}
        </span>
      </div>
      <input
        type="search"
        value={tree.filterQuery}
        aria-label={search}
        placeholder={search}
        {...part("search")}
        onChange={(event) =>
          onNavigationChange(setFilter(tree, event.currentTarget.value))
        }
      />
      <div
        ref={body}
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
            onInsert={!disabled ? insertNode : undefined}
            onTemplateMenu={menu}
          />
        )}
      </div>
      {trigger && (
        <p {...part("hint")}>{m.workbench_fields_trigger_hint({ trigger })}</p>
      )}
    </section>
  );
}
