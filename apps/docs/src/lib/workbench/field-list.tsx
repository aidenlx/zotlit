// The field list shows every field, with populated fields first and familiar
// names for common fields. Nested values expand in place.

import {
  ClipboardType,
  Code,
  Copy,
  FilePlus2,
  GitBranch,
  List,
  Repeat,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  copyValue,
  formatPath,
  buildDisplayTree,
  buildFilteredDisplayTree,
  initialTreeState,
  setFilter,
  snippetKindsFor,
  toggleNode,
} from "@zotlit/workbench/explorer";
import type {
  DisplayNode,
  SnippetKind,
  TreeState,
} from "@zotlit/workbench/explorer";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { m } from "@/paraglide/messages.js";

import {
  FIELD_TRIGGER,
  ROOT_LABEL,
  fieldSnippet,
  commonRows,
  fieldValueText,
  rowMatches,
} from "./fields";
import type { FieldInsertionMode, TemplateRoot } from "./fields";
import { WorkbenchHelp } from "./frame";

const SNIPPET_LABEL: Record<SnippetKind, () => string> = {
  output: m.template_data_explorer_menu_copy_output,
  "if-present": m.template_data_explorer_menu_copy_if_present,
  loop: m.template_data_explorer_menu_copy_loop,
  joined: m.template_data_explorer_menu_copy_joined,
};

const SNIPPET_ICON = {
  output: Code,
  "if-present": GitBranch,
  loop: Repeat,
  joined: List,
};

export interface FieldListProps {
  /** The root the editor's caret writes against; the list follows it. */
  root: TemplateRoot;
  mode?: FieldInsertionMode;
  disabled?: boolean;
  /** That root's Template data, or null when this paper carries none. */
  data: Record<string, unknown> | null;
  /** Puts the snippet in the note at the saved selection and returns focus. */
  onInsert: (snippet: string) => void;
}

interface RowActions {
  readonly mode: FieldInsertionMode;
  readonly disabled: boolean;
  readonly onInsert: (snippet: string) => void;
}

export function FieldList({
  root,
  data,
  onInsert,
  mode = "template",
  disabled = false,
}: FieldListProps) {
  const [tree, setTree] = useState<TreeState>(initialTreeState);

  const query = tree.filterQuery;
  const nodes = useMemo(
    () => (data ? buildDisplayTree(data, { expanded: new Set() }) : []),
    [data],
  );
  const common = useMemo(() => commonRows(root, nodes), [root, nodes]);
  const explorer = useMemo(() => {
    if (!data) return [];
    const visible = query
      ? buildFilteredDisplayTree(data, query, {
          collapsed: tree.filterCollapsed,
        }).nodes
      : buildDisplayTree(data, { expanded: tree.expanded });
    const byKey = new Map(visible.map((node) => [node.key, node]));
    const commonNodes = common.flatMap((row) => {
      const node = byKey.get(row.node.key);
      if (node) return [{ ...node, label: row.label }];
      return query && rowMatches(row, query)
        ? [{ ...row.node, label: row.label }]
        : [];
    });
    const commonKeys = new Set(commonNodes.map((node) => node.key));
    return [
      ...commonNodes,
      ...visible.filter((node) => !commonKeys.has(node.key)),
    ].toSorted(
      (a, b) =>
        Number(Boolean(fieldValueText(b))) - Number(Boolean(fieldValueText(a))),
    );
  }, [common, data, query, tree.expanded, tree.filterCollapsed]);

  const actions: RowActions = {
    mode,
    disabled,
    onInsert,
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex min-h-8 shrink-0 flex-wrap items-center gap-1.5">
        <h2 className="text-xs font-semibold">
          {m.workbench_fields_heading()}
        </h2>
        <span className="me-auto text-xs text-fd-muted-foreground">
          {ROOT_LABEL[root]()}
        </span>
        <WorkbenchHelp title={m.workbench_fields_heading()} compact>
          {disabled
            ? m.workbench_properties_insert_hint()
            : m.workbench_fields_lede()}
        </WorkbenchHelp>
      </div>
      <Input
        type="search"
        value={query}
        aria-label={m.workbench_fields_search()}
        placeholder={m.workbench_fields_search()}
        onChange={(event) =>
          setTree((current) => setFilter(current, event.target.value))
        }
        className="mb-2 min-h-8 shrink-0 px-2 py-1 sm:text-xs"
      />
      <div className="min-h-0 flex-1 scrollbar-gutter-stable overflow-auto rounded-md border border-fd-border bg-fd-card">
        {data === null ? (
          <p className="px-3 py-2 text-xs text-fd-muted-foreground">
            {m.workbench_fields_no_annotations()}
          </p>
        ) : (
          <>
            {explorer.length === 0 && (
              <p className="px-3 py-2 text-xs text-fd-muted-foreground">
                {m.workbench_fields_no_matches()}
              </p>
            )}
            <ExplorerRows
              nodes={explorer}
              depth={0}
              actions={actions}
              onToggle={(key) => setTree((current) => toggleNode(current, key))}
            />
          </>
        )}
      </div>
      <p className="mt-2 text-xs text-fd-muted-foreground">
        {m.workbench_fields_trigger_hint({ trigger: FIELD_TRIGGER })}
      </p>
    </section>
  );
}

interface ExplorerRowsProps {
  readonly nodes: readonly DisplayNode[];
  readonly depth: number;
  readonly actions: RowActions;
  readonly onToggle: (key: string) => void;
}

function ExplorerRows({ nodes, depth, actions, onToggle }: ExplorerRowsProps) {
  const indent = { marginInlineStart: `${depth * 0.75}rem` };
  return (
    <ul>
      {nodes.map((node, index) => (
        <li key={node.key} className="border-b border-fd-border/40">
          {depth === 0 &&
            !fieldValueText(node) &&
            (index === 0 || Boolean(fieldValueText(nodes[index - 1]!))) && (
              <h3 className="border-y border-fd-border bg-fd-muted px-4 py-2 text-xs font-medium text-fd-foreground">
                {m.workbench_fields_without_data()}
              </h3>
            )}
          <div className="flex items-start">
            {node.kind === "value" && node.expandable ? (
              <button
                type="button"
                aria-label={m.workbench_fields_show_contents()}
                aria-expanded={node.children !== undefined}
                onClick={() => onToggle(node.key)}
                style={indent}
                className="mt-1 min-h-6 min-w-4 cursor-pointer text-fd-muted-foreground"
              >
                <span aria-hidden>{node.children ? "▾" : "▸"}</span>
              </button>
            ) : (
              <span aria-hidden style={indent} className="w-4 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <FieldRowView
                node={node}
                label={node.label}
                value={fieldValueText(node)}
                actions={actions}
              />
            </div>
          </div>
          {node.kind === "value" && node.children && (
            <ExplorerRows
              nodes={node.children}
              depth={depth + 1}
              actions={actions}
              onToggle={onToggle}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

interface FieldRowViewProps {
  readonly node: DisplayNode;
  readonly label: string;
  readonly value: string;
  readonly actions: RowActions;
}

function FieldRowView({ node, label, value, actions }: FieldRowViewProps) {
  const { onInsert, mode, disabled } = actions;
  const snippet = fieldSnippet(node, mode, "output");
  const path = formatPath(node.path, "zt");
  const kinds =
    mode === "template" ? snippetKindsFor(node) : (["output"] as const);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const rawValue = copyValue(node);
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(
      () => setCopyStatus(m.workbench_field_copy_done()),
      () => setCopyStatus(m.workbench_field_copy_failed()),
    );
  };

  return (
    <div className="group @container relative px-2 py-1.5 hover:bg-fd-muted/50">
      <div className="flex min-h-6 items-center gap-1">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span
            title={label}
            className="min-w-0 truncate text-sm leading-tight font-medium"
          >
            {label}
          </span>
          <code
            title={path}
            dir="ltr"
            className="hidden min-w-0 truncate font-mono text-xs font-normal text-fd-muted-foreground @[280px]:block"
          >
            {path}
          </code>
        </div>
        <div className="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            disabled={disabled}
            aria-label={m.workbench_fields_put_in_note()}
            title={m.workbench_fields_put_in_note()}
            onClick={() => onInsert(snippet)}
          >
            <FilePlus2 aria-hidden className="size-3.5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon" className="size-6" />}
              aria-label={m.template_data_explorer_row_actions()}
              title={m.template_data_explorer_row_actions()}
            >
              <Code aria-hidden className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuItem
                className="min-h-7 gap-2 px-2 py-1 text-xs"
                onClick={() => copy(formatPath(node.path, "zt"))}
              >
                <Copy aria-hidden />
                {m.template_data_explorer_menu_copy_path()}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="min-h-7 gap-2 px-2 py-1 text-xs"
                disabled={!value || rawValue === null}
                onClick={() => {
                  if (value && rawValue !== null) copy(rawValue);
                }}
              >
                <ClipboardType aria-hidden />
                {m.template_data_explorer_menu_copy_value()}
              </DropdownMenuItem>
              <div
                role="separator"
                className="my-1 border-t border-fd-border"
              />
              {kinds.map((kind) => {
                const Icon = SNIPPET_ICON[kind];
                return (
                  <DropdownMenuItem
                    key={kind}
                    className="min-h-7 gap-2 px-2 py-1 text-xs"
                    onClick={() => copy(fieldSnippet(node, mode, kind))}
                  >
                    <Icon aria-hidden />
                    {SNIPPET_LABEL[kind]()}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {value && (
        <p
          title={value}
          className="truncate text-xs leading-normal text-fd-muted-foreground"
        >
          {value}
        </p>
      )}
      <span role="status" className="sr-only">
        {copyStatus}
      </span>
    </div>
  );
}
