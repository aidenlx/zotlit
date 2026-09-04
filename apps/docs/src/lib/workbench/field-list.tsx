// The field list: this paper's values under the names a reader knows, with the
// full Explorer tree behind "Everything else from Zotero". Both lists select a
// row the same way, and both insert the same snippet.

import { useMemo, useState } from "react";

import {
  buildDisplayTree,
  buildFilteredDisplayTree,
  initialTreeState,
  renderSnippet,
  setFilter,
  snippetKindsFor,
  toggleNode,
} from "@zotlit/workbench/explorer";
import type {
  DisplayNode,
  SnippetKind,
  TreeState,
} from "@zotlit/workbench/explorer";

import { m } from "@/paraglide/messages.js";

import {
  FIELD_TRIGGER,
  ROOT_LABEL,
  SNIPPET_ENGINE,
  commonRows,
  fieldValueText,
  rowMatches,
} from "./fields";
import type { TemplateRoot } from "./fields";

const SNIPPET_LABEL: Record<SnippetKind, () => string> = {
  output: m.workbench_snippet_output,
  "if-present": m.workbench_snippet_if_present,
  loop: m.workbench_snippet_loop,
  joined: m.workbench_snippet_joined,
};

export interface FieldListProps {
  /** The root the editor's caret writes against; the list follows it. */
  root: TemplateRoot;
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
  readonly selected: RowSelection | null;
  readonly onSelect: (node: DisplayNode) => void;
  readonly onKind: (kind: SnippetKind) => void;
  readonly onInsert: (snippet: string) => void;
}

export function FieldList({ root, data, onInsert }: FieldListProps) {
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
    selected,
    onSelect: (node) =>
      setSelected((current) =>
        current?.key === node.key
          ? null
          : { key: node.key, kind: snippetKindsFor(node)[0]! },
      ),
    onKind: (kind) =>
      setSelected((current) => (current ? { ...current, kind } : null)),
    onInsert,
  };

  return (
    <section className="flex min-h-0 flex-col">
      <div className="flex items-baseline gap-3">
        <h2 className="font-serif text-[1.06rem] font-medium">
          {m.workbench_fields_heading()}
        </h2>
        <span className="ml-auto font-mono text-[0.6rem] font-semibold tracking-widest text-fd-muted-foreground uppercase">
          {ROOT_LABEL[root]()}
        </span>
      </div>
      <p className="mt-1 mb-2 text-xs text-fd-muted-foreground">
        {m.workbench_fields_lede()}
      </p>
      <input
        type="search"
        value={query}
        aria-label={m.workbench_fields_search()}
        placeholder={m.workbench_fields_search()}
        onChange={(event) =>
          setTree((current) => setFilter(current, event.target.value))
        }
        className="mb-2 border border-fd-border bg-fd-card px-2 py-1.5 text-sm"
      />
      <div className="min-h-0 flex-1 overflow-auto border border-fd-border bg-fd-card">
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
              className="w-full cursor-pointer border-t border-fd-border px-3 py-2 text-left text-xs text-fd-muted-foreground hover:bg-fd-accent"
            >
              {m.workbench_fields_everything_else()}
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
  const indent = { marginLeft: `${depth * 0.75}rem` };
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
                className="mt-1.5 cursor-pointer px-1 text-fd-muted-foreground"
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
  const { selected, onSelect, onKind, onInsert } = actions;
  const kind = selected && selected.key === node.key ? selected.kind : null;
  const snippet = kind ? renderSnippet(node, SNIPPET_ENGINE, kind) : "";
  const kinds = snippetKindsFor(node);

  return (
    <div className={kind ? "border-l-2 border-fd-primary" : ""}>
      <button
        type="button"
        aria-pressed={kind !== null}
        onClick={() => onSelect(node)}
        className="w-full cursor-pointer px-3 py-1.5 text-left hover:bg-fd-accent"
      >
        <span className="block text-xs font-medium">{label}</span>
        <span className="block truncate text-xs text-fd-muted-foreground">
          {value || "—"}
        </span>
      </button>
      {kind && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
          <button
            type="button"
            onClick={() => onInsert(snippet)}
            className="cursor-pointer bg-fd-primary px-2 py-1 text-xs font-medium text-fd-primary-foreground"
          >
            {m.workbench_fields_put_in_note()}
          </button>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(snippet)}
            className="cursor-pointer border border-fd-border px-2 py-1 text-xs"
          >
            {m.workbench_fields_copy()}
          </button>
          {kinds.length > 1 &&
            kinds.map((offered) => (
              <button
                key={offered}
                type="button"
                aria-pressed={offered === kind}
                onClick={() => onKind(offered)}
                className="cursor-pointer border border-fd-border px-2 py-1 text-[0.68rem] text-fd-muted-foreground aria-pressed:border-fd-primary aria-pressed:text-fd-primary"
              >
                {SNIPPET_LABEL[offered]()}
              </button>
            ))}
          <code className="block w-full font-mono text-[0.68rem] break-all text-fd-primary">
            {snippet}
          </code>
        </div>
      )}
    </div>
  );
}
