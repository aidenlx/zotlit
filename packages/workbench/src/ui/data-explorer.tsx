import type { DisplayNode, TemplateEngine } from "#/explorer/index";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";

import { useOptionalEditor } from "./editor";
import { commonRows, fieldSnippet, rowMatches } from "./explorer-fields";
import type { FieldInsertionMode } from "./explorer-fields";
import { DisplayTree } from "./explorer-tree";
import { useWorkbenchHost } from "./host";
import type { WorkbenchMenuItem, WorkbenchMenuRequest } from "./host";
// Both hosts use this field discovery tree. The host owns clipboard, insertion,
// export, and popup presentation; this component owns filtering and expansion.
import { useWorkbenchMessages } from "./messages";
import { createWorkbenchStore } from "./store";
import type { TemplateRoot, ExplorerVariant } from "./store";
import { useParts } from "./theme";

import {
  buildDisplayTree,
  buildFilteredDisplayTree,
  copyValue,
  formatPath,
  initialTreeState,
  renderSnippet,
  setFilter,
  snippetKindsFor,
  toggleNode,
} from "#/explorer/index";

export interface DataExplorerProps {
  root: TemplateRoot;
  data: Record<string, unknown> | null;
  mode?: FieldInsertionMode;
  trigger?: string;
  engine?: TemplateEngine;
  /** Evaluated when the menu opens, so the host's JavaScript setting is current. */
  engines?: () => readonly TemplateEngine[];
  disabled?: boolean;
  onInsert?: (snippet: string) => void;
  copy: (text: string) => Promise<void>;
  onExploreAnnotation?: (node: DisplayNode) => void;
  canExploreAnnotation?: (node: DisplayNode) => boolean;
}

export function DataExplorer({
  root,
  data,
  mode = "template",
  trigger,
  engine = "liquid",
  engines,
  disabled = false,
  onInsert,
  copy,
  onExploreAnnotation,
  canExploreAnnotation,
}: DataExplorerProps) {
  const m = useWorkbenchMessages();
  const host = useWorkbenchHost();
  const part = useParts("dataExplorer");
  const editor = useOptionalEditor();
  const [fallback] = useState(createWorkbenchStore);
  const store = editor?.store ?? fallback;
  const variant = useStore(store, (state) => state.explorer);
  const setVariant = (value: ExplorerVariant) =>
    store.getState().setExplorer(value);
  useEffect(() => {
    const saved = host.persistence.read("vault", "explorer-variant");
    if (saved === "simple" || saved === "all")
      store.getState().setExplorer(saved);
  }, [host, store]);
  const [tree, setTree] = useState(initialTreeState);
  const visible = useMemo(() => {
    if (!data) return { nodes: [], matchedKeys: null };
    if (tree.filterQuery)
      return buildFilteredDisplayTree(data, tree.filterQuery, {
        collapsed: tree.filterCollapsed,
      });
    return {
      nodes: buildDisplayTree(data, { expanded: tree.expanded }),
      matchedKeys: null,
    };
  }, [data, tree]);
  // Resolve the labels on each render; the display tree above remains cached.
  const nodes = (() => {
    if (variant === "all") return visible.nodes;
    const full =
      data && tree.filterQuery
        ? buildDisplayTree(data, { expanded: tree.expanded })
        : visible.nodes;
    const common = commonRows(m, root, full);
    const labels = new Map(common.map((row) => [row.node.key, row.label]));
    const order = new Map(common.map((row, index) => [row.node.key, index]));
    const displayed = new Map(visible.nodes.map((node) => [node.key, node]));
    if (tree.filterQuery) {
      for (const row of common)
        if (rowMatches(row, tree.filterQuery))
          displayed.set(row.node.key, row.node);
    }
    return [...displayed.values()]
      .map((node) => ({ ...node, label: labels.get(node.key) ?? node.label }))
      .toSorted(
        (a, b) =>
          (order.get(a.key) ?? order.size) - (order.get(b.key) ?? order.size),
      );
  })();
  const copyNode = async (node: DisplayNode) => {
    const value = copyValue(node);
    if (value !== null) {
      try {
        await copy(value);
      } catch (error) {
        host.notice(m.workbench_field_copy_failed());
        throw error;
      }
    }
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
    if (onInsert && !disabled)
      items.unshift({
        label: m.workbench_fields_put_in_note(),
        onSelect: () => onInsert(fieldSnippet(node, mode, { engine })),
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
  return (
    <section {...part("explorer", variant)}>
      <div {...part("header")}>
        <h2 {...part("heading")}>{m.workbench_fields_heading()}</h2>
        <span {...part("root-label")}>
          {root === "annotation"
            ? m.workbench_fields_root_annotation()
            : root === "filename"
              ? m.workbench_fields_root_filename()
              : m.workbench_fields_root_note()}
        </span>
        <div
          role="group"
          aria-label={m.workbench_explorer_variant()}
          {...part("variants")}
        >
          {(["simple", "all"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={variant === value}
              {...part("variant", variant === value ? "active" : "inactive")}
              onClick={() => {
                setVariant(value);
                host.persistence.write("vault", "explorer-variant", value);
              }}
            >
              {value === "simple"
                ? m.workbench_explorer_simple()
                : m.workbench_explorer_all()}
            </button>
          ))}
        </div>
      </div>
      <input
        type="search"
        value={tree.filterQuery}
        aria-label={m.workbench_fields_search()}
        placeholder={m.workbench_fields_search()}
        {...part("search")}
        onChange={(event) =>
          setTree((current) => setFilter(current, event.currentTarget.value))
        }
      />
      <div {...part("body")}>
        {nodes.length === 0 ? (
          <p {...part("empty")}>
            {data === null
              ? m.workbench_fields_no_annotations()
              : m.workbench_fields_no_matches()}
          </p>
        ) : (
          <DisplayTree
            variant={variant}
            nodes={nodes}
            matchedKeys={visible.matchedKeys}
            onToggle={(key) => setTree((current) => toggleNode(current, key))}
            onCopyValue={copyNode}
            onInsert={
              onInsert && !disabled
                ? (node) => onInsert(fieldSnippet(node, mode, { engine }))
                : undefined
            }
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
