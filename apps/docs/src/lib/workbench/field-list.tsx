// The field list: this paper's values under the names a reader knows, with the
// full Explorer tree behind "Everything else from Zotero". Both lists select a
// row the same way, and both insert the same snippet.

import { ChevronDown, Copy, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import {
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
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
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

const SNIPPET_LABEL: Record<SnippetKind, () => string> = {
  output: m.workbench_snippet_output,
  "if-present": m.workbench_snippet_if_present,
  loop: m.workbench_snippet_loop,
  joined: m.workbench_snippet_joined,
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

/** The selected row: the node it sits on, and the snippet kind it offers. */
interface RowSelection {
  readonly key: string;
  readonly kind: SnippetKind;
}

interface RowActions {
  readonly mode: FieldInsertionMode;
  readonly disabled: boolean;
  readonly selected: RowSelection | null;
  readonly onSelect: (node: DisplayNode) => void;
  readonly onKind: (kind: SnippetKind) => void;
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
  const [selected, setSelected] = useState<RowSelection | null>(null);
  const [showAll, setShowAll] = useState(false);

  const query = tree.filterQuery;
  const allOpen = showAll || query.length > 0;
  const nodes = useMemo(
    () => (data ? buildDisplayTree(data, { expanded: new Set() }) : []),
    [data],
  );
  const common = useMemo(() => commonRows(root, nodes), [root, nodes]);
  const rows = useMemo(
    () => common.filter((row) => rowMatches(row, query)),
    [common, query],
  );
  const explorer = useMemo(() => {
    if (!allOpen || !data) return [];
    if (!query) return buildDisplayTree(data, { expanded: tree.expanded });
    const options = { collapsed: tree.filterCollapsed };
    return buildFilteredDisplayTree(data, query, options).nodes;
  }, [allOpen, data, query, tree.expanded, tree.filterCollapsed]);

  // What the foot promises: the fields this paper carries beyond the rows it
  // leads with, which is what opening the tree adds. The count runs off the
  // rows the paper actually has, so a common field it carries no key for is
  // one of the fields the tree adds rather than one it repeats.
  const rest = nodes.length - common.length;

  const actions: RowActions = {
    mode,
    disabled,
    selected,
    onSelect: (node) =>
      setSelected((current) =>
        current?.key === node.key
          ? null
          : {
              key: node.key,
              kind: mode === "template" ? snippetKindsFor(node)[0]! : "output",
            },
      ),
    onKind: (kind) =>
      setSelected((current) => (current ? { ...current, kind } : null)),
    onInsert,
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-serif text-lg font-medium">
          {m.workbench_fields_heading()}
        </h2>
        <span className="text-xs text-fd-muted-foreground">
          {ROOT_LABEL[root]()}
        </span>
      </div>
      <p className="mt-2 mb-3 text-sm leading-relaxed text-fd-muted-foreground">
        {disabled
          ? m.workbench_properties_insert_hint()
          : m.workbench_fields_lede()}
      </p>
      <Input
        type="search"
        value={query}
        aria-label={m.workbench_fields_search()}
        placeholder={m.workbench_fields_search()}
        onChange={(event) =>
          setTree((current) => setFilter(current, event.target.value))
        }
        className="mb-3"
      />
      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-fd-border bg-fd-card">
        {data === null ? (
          <p className="px-3 py-2 text-xs text-fd-muted-foreground">
            {m.workbench_fields_no_highlights()}
          </p>
        ) : (
          <>
            <ul>
              {rows.map((row) => (
                <li
                  key={row.node.key}
                  className="border-b border-fd-border/60 last:border-b-0"
                >
                  <FieldRowView
                    node={row.node}
                    label={row.label}
                    value={row.value}
                    actions={actions}
                  />
                </li>
              ))}
            </ul>
            {rows.length === 0 && explorer.length === 0 && (
              <p className="px-3 py-2 text-xs text-fd-muted-foreground">
                {m.workbench_fields_no_matches()}
              </p>
            )}
            <button
              type="button"
              aria-expanded={allOpen}
              onClick={() => setShowAll((open) => !open)}
              className="flex w-full cursor-pointer items-center gap-2 border-t border-fd-border px-3 py-3 text-start text-sm text-fd-muted-foreground hover:bg-fd-muted"
            >
              <ChevronDown
                aria-hidden
                className={`size-4 shrink-0 ${allOpen ? "rotate-180" : ""}`}
              />
              <span>{m.workbench_fields_everything_else()}</span>
              {rest > 0 && <span className="ml-2 font-mono">{rest}</span>}
            </button>
            {allOpen && (
              <ExplorerRows
                nodes={explorer}
                depth={0}
                actions={actions}
                onToggle={(key) =>
                  setTree((current) => toggleNode(current, key))
                }
              />
            )}
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
      {nodes.map((node) => (
        <li key={node.key} className="border-b border-fd-border/40">
          <div className="flex items-start">
            {node.kind === "value" && node.expandable ? (
              <button
                type="button"
                aria-label={m.workbench_fields_show_contents()}
                aria-expanded={node.children !== undefined}
                onClick={() => onToggle(node.key)}
                style={indent}
                className="mt-1.5 min-h-8 min-w-6 cursor-pointer px-1 text-fd-muted-foreground"
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
  const { selected, onSelect, onKind, onInsert, mode, disabled } = actions;
  const kind = selected && selected.key === node.key ? selected.kind : null;
  const snippet = kind ? fieldSnippet(node, mode, kind) : "";
  const kinds = mode === "template" ? snippetKindsFor(node) : ["output"];
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  return (
    <div className={kind ? "bg-fd-muted/50" : ""}>
      <button
        type="button"
        aria-expanded={kind !== null}
        onClick={() => {
          onSelect(node);
          setCopyStatus(null);
        }}
        className="w-full cursor-pointer px-3 py-2.5 text-start hover:bg-fd-muted"
      >
        <span className="block text-sm font-medium">{label}</span>
        <span
          className={`mt-0.5 block text-sm break-words text-fd-muted-foreground ${kind ? "max-h-40 overflow-auto" : "line-clamp-2"}`}
        >
          {value || "—"}
        </span>
      </button>
      {kind && (
        <div className="space-y-3 px-3 pb-3">
          {kinds.length > 1 && (
            <label className="flex flex-col gap-1.5 text-sm">
              {m.workbench_field_snippet()}
              <NativeSelect
                value={kind}
                onChange={(event) => onKind(event.target.value as SnippetKind)}
                className="w-full"
              >
                {kinds.map((offered) => (
                  <NativeSelectOption key={offered} value={offered}>
                    {SNIPPET_LABEL[offered as SnippetKind]()}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => onInsert(snippet)}
            >
              <Plus aria-hidden />
              {m.workbench_fields_put_in_note()}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={m.workbench_fields_copy()}
              title={m.workbench_fields_copy()}
              onClick={() => {
                void navigator.clipboard.writeText(snippet).then(
                  () => setCopyStatus(m.workbench_field_copy_done()),
                  () => setCopyStatus(m.workbench_field_copy_failed()),
                );
              }}
            >
              <Copy aria-hidden />
            </Button>
          </div>
          <code
            dir="ltr"
            className="block font-mono text-xs break-words whitespace-pre-wrap text-fd-muted-foreground"
          >
            {snippet}
          </code>
          <p
            role="status"
            className="text-xs text-fd-muted-foreground empty:hidden"
          >
            {copyStatus}
          </p>
        </div>
      )}
    </div>
  );
}
