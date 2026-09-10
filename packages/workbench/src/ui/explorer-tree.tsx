// Presentational tree renderer for display-tree nodes; raises intent via callbacks only.

import type {
  DisplayNode,
  HelperNode,
  PlaceholderNode,
  ValueNode,
} from "#/explorer/index";
import { regex } from "arkregex";
import { useId, useState } from "react";

import { useTooltip } from "./host";
import { useWorkbenchMessages } from "./messages";
import { useIcon, useParts } from "./theme";
import type { WorkbenchIcon } from "./theme";

import { formatPath } from "#/explorer/index";

/** Shared Enter/Space activation for `role="button"` spans, so keyboard users get the same click behavior as a mouse. */
function activateOnEnterOrSpace<E extends React.KeyboardEvent>(
  action: (e: E) => void,
): (e: E) => void {
  return (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      action(e);
    }
  };
}

/** One section of the tree: its heading, its top-level nodes, and the names those nodes show. */
export interface DisplaySection {
  readonly id: string;
  readonly label: string;
  readonly collapsed: boolean;
  readonly nodes: readonly DisplayNode[];
  /** Reader-facing names by node key; a node without one shows its raw key. */
  readonly labels: ReadonlyMap<string, string>;
}

export interface DisplayTreeProps {
  sections: readonly DisplaySection[];
  /** Keys of nodes directly matched by the filter; null when no filter is active. */
  matchedKeys: ReadonlySet<string> | null;
  onToggle: (key: string) => void;
  /** Absent while a filter holds every matching section open. */
  onToggleSection?: (id: string) => void;
  onInsert?: (node: DisplayNode) => void;
  onTemplateMenu: (node: DisplayNode, event: React.MouseEvent) => void;
}

export function DisplayTree({
  sections,
  matchedKeys,
  onToggle,
  onToggleSection,
  onInsert,
  onTemplateMenu,
}: DisplayTreeProps): React.ReactElement {
  const part = useParts("explorerTree");
  const id = useId();
  return (
    <div {...part("sections")}>
      {sections.map((section) => (
        <section
          key={section.id}
          data-workbench-section={section.id}
          {...part("section", section.collapsed ? "collapsed" : "expanded")}
        >
          <SectionHeader
            section={section}
            labelId={`${id}-${section.id}`}
            onToggle={onToggleSection && (() => onToggleSection(section.id))}
          />
          {!section.collapsed && (
            <ul
              role="tree"
              aria-labelledby={`${id}-${section.id}`}
              {...part("tree")}
            >
              {section.nodes.map((node) => (
                <TreeNode
                  key={node.key}
                  node={node}
                  label={section.labels.get(node.key)}
                  matchedKeys={matchedKeys}
                  onToggle={onToggle}
                  onInsert={onInsert}
                  onTemplateMenu={onTemplateMenu}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

/** The section's name and row count; its visible text is its accessible name. */
function SectionHeader({
  section,
  labelId,
  onToggle,
}: {
  section: DisplaySection;
  /** The id the tree beneath points at for its name. */
  labelId: string;
  onToggle?: () => void;
}) {
  const part = useParts("explorerTree");
  const icon = useIcon();
  return (
    <button
      type="button"
      aria-expanded={!section.collapsed}
      aria-disabled={onToggle ? undefined : true}
      onClick={onToggle}
      {...part("section-header")}
    >
      <span
        data-expanded={section.collapsed ? undefined : ""}
        {...part("section-chevron")}
      >
        <span {...part("chevron-icon")}>{icon("chevron-right")}</span>
      </span>
      <span id={labelId} {...part("section-label")}>
        {section.label}
      </span>{" "}
      <span {...part("section-count")}>({section.nodes.length})</span>
    </button>
  );
}

interface TreeNodeProps {
  node: DisplayNode;
  /** The reader-facing name of a top-level field; nested keys show as written. */
  label?: string;
  matchedKeys: ReadonlySet<string> | null;
  onToggle: (key: string) => void;
  onInsert?: (node: DisplayNode) => void;
  onTemplateMenu: (node: DisplayNode, event: React.MouseEvent) => void;
}

function TreeNode({
  node,
  label,
  matchedKeys,
  onToggle,
  onInsert,
  onTemplateMenu,
}: TreeNodeProps) {
  const part = useParts("explorerTree");
  const isExpanded = node.kind === "value" && node.children !== undefined;
  const isExpandable = node.kind === "value" && node.expandable;
  const isMatched = matchedKeys?.has(node.key) ?? false;

  return (
    <li
      role="treeitem"
      data-workbench-field={node.key}
      aria-expanded={isExpandable ? isExpanded : undefined}
    >
      <div
        {...part("row", isMatched ? "matched" : undefined)}
        onContextMenu={(event) => {
          event.preventDefault();
          onTemplateMenu(node, event);
        }}
      >
        {isExpandable ? (
          <Chevron expanded={isExpanded} onClick={() => onToggle(node.key)} />
        ) : (
          <span {...part("spacer")} />
        )}
        {/* The host lays the key and the value out as a wrapping row: one line while both fit, the value on its own line beneath the key when it does not. The space between them survives in text content only. */}
        <div {...part("contents")}>
          <NodeRow node={node} label={label} />
        </div>
        <ActionCluster
          node={node}
          onInsert={onInsert}
          onTemplateMenu={onTemplateMenu}
        />
      </div>
      {node.kind === "value" && node.children && (
        <ul role="group" {...part("group")}>
          {node.children.map((child) => (
            <TreeNode
              key={child.key}
              node={child}
              matchedKeys={matchedKeys}
              onToggle={onToggle}
              onInsert={onInsert}
              onTemplateMenu={onTemplateMenu}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function Chevron({
  expanded,
  onClick,
}: {
  expanded: boolean;
  onClick: () => void;
}) {
  const m = useWorkbenchMessages();
  const part = useParts("explorerTree");
  const icon = useIcon();
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={m.workbench_explorer_toggle_node()}
      onClick={onClick}
      onKeyDown={activateOnEnterOrSpace(() => onClick())}
      data-expanded={expanded ? "" : undefined}
      {...part("chevron")}
    >
      <span {...part("chevron-icon")}>{icon("chevron-right")}</span>
    </span>
  );
}

/** The row's two actions: insert, and the menu that holds everything else. The host reveals them on hover or focus. */
function ActionCluster({
  node,
  onInsert,
  onTemplateMenu,
}: {
  node: DisplayNode;
  onInsert?: (node: DisplayNode) => void;
  onTemplateMenu: (node: DisplayNode, event: React.MouseEvent) => void;
}) {
  const m = useWorkbenchMessages();
  const part = useParts("explorerTree");
  return (
    <div {...part("actions")}>
      {onInsert && (
        <ClusterButton
          icon="add"
          label={m.workbench_fields_put_in_note()}
          onClick={() => onInsert(node)}
        />
      )}
      <ClusterButton
        icon="more"
        label={m.workbench_explorer_row_actions()}
        onClick={(e) => onTemplateMenu(node, e)}
      />
    </div>
  );
}

function ClusterButton({
  icon,
  label,
  onClick,
}: {
  icon: WorkbenchIcon;
  label: string;
  onClick: (event: React.MouseEvent) => void;
}) {
  const part = useParts("explorerTree");
  const drawIcon = useIcon();
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={label}
      {...useTooltip(label)}
      onClick={onClick}
      onKeyDown={activateOnEnterOrSpace((e) => e.currentTarget.click())}
      {...part("action")}
    >
      {drawIcon(icon)}
    </span>
  );
}

function NodeRow({ node, label }: { node: DisplayNode; label?: string }) {
  switch (node.kind) {
    case "value":
      return <ValueRow node={node} label={label} />;
    case "helper":
      return <HelperRow node={node} label={label} />;
    case "placeholder":
      return <PlaceholderRow node={node} label={label} />;
  }
}

/**
 * The property name, or the array index, or the reader-facing name of a
 * top-level field. A named key keeps its raw path in the tooltip.
 */
function KeyLabel({ node, label }: { node: DisplayNode; label?: string }) {
  const part = useParts("explorerTree");
  const tooltip = useTooltip(formatPath(node.path, "zt"));
  if (label === undefined) return <span {...part("key")}>{node.label}</span>;
  return (
    <span {...tooltip} {...part("key", "labeled")}>
      {label}
    </span>
  );
}

function ValueRow({ node, label }: { node: ValueNode; label?: string }) {
  const part = useParts("explorerTree");
  return (
    <>
      <KeyLabel node={node} label={label} />{" "}
      <span {...part("value")}>
        <ValueContent node={node} labeled={label !== undefined} />
      </span>
    </>
  );
}

/**
 * A named field counts a list in prose parentheses and lets an object speak
 * through its preview alone; a raw key keeps the structural `[n]` / `{n}` hint.
 */
function ValueContent({
  node,
  labeled = false,
}: {
  node: ValueNode;
  labeled?: boolean;
}) {
  const part = useParts("explorerTree");
  if (node.valueType === "array" || node.valueType === "object") {
    const hint = labeled
      ? node.valueType === "array"
        ? `(${node.size})`
        : null
      : node.valueType === "array"
        ? `[${node.size}]`
        : `{${node.size}}`;
    return (
      <>
        {hint !== null && <span {...part("hint")}>{hint}</span>}
        {node.children === undefined && node.preview !== undefined && (
          <>
            {hint !== null && " "}
            <span {...part("placeholder")}>{node.preview}</span>
          </>
        )}
      </>
    );
  }
  if (node.valueType === "getter") return <span {...part("hint")}>…</span>;
  return <ScalarValue node={node} />;
}

function ScalarValue({ node }: { node: ValueNode }) {
  const part = useParts("explorerTree");
  switch (node.valueType) {
    case "string":
      return <StringValue value={node.value as string} />;
    case "number":
      return <span {...part("number")}>{String(node.value)}</span>;
    case "boolean":
      return <span {...part("boolean")}>{String(node.value)}</span>;
    case "null":
      return <span {...part("null")}>null</span>;
    case "undefined":
      return <span {...part("undefined")}>undefined</span>;
    case "opaque":
      return (
        <span {...part("opaque")}>
          {
            // oxlint-disable-next-line no-base-to-string -- opaque carries its own toString (Temporal/Date).
            String(node.value)
          }
        </span>
      );
    default:
      return null;
  }
}

function HelperRow({ node, label }: { node: HelperNode; label?: string }) {
  const part = useParts("explorerTree");
  return (
    <>
      <KeyLabel node={node} label={label} />{" "}
      <span {...part("value")}>
        <span {...part("hint")}>{node.signatureHint}</span>{" "}
        {node.evaluated === null ? (
          <span {...part("null")}>null</span>
        ) : (
          <StringValue value={node.evaluated} />
        )}
      </span>
    </>
  );
}

function PlaceholderRow({
  node,
  label,
}: {
  node: PlaceholderNode;
  label?: string;
}) {
  const part = useParts("explorerTree");
  return (
    <>
      <KeyLabel node={node} label={label} />{" "}
      <span {...part("value")}>
        <span {...part("placeholder")}>{node.reason}</span>
      </span>
    </>
  );
}

/** `[text](url)` — captures read below, so it keeps the typed `regex(...)` form. */
const MARKDOWN_LINK_RE = regex(
  "^\\s*\\[(?<text>[^\\]]*)\\]\\((?<url>[^)]+)\\)\\s*$",
);
/** A bare protocol URL; or a `#rgb`/`#rrggbb`(`aa`) color code — both `.test()`-only, so plain literals. */
const LINKABLE_URL_RE = /^(?:https?|file|zotero|obsidian):\S*$/i;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Longer values collapse to their first line until expanded, so one field can't push its siblings off-screen. */
const STRING_PREVIEW_LIMIT = 140;

function StringValue({ value }: { value: string }) {
  const part = useParts("explorerTree");
  const trimmed = value.trim();

  const markdown = MARKDOWN_LINK_RE.exec(value);
  if (markdown && LINKABLE_URL_RE.test(markdown.groups.url)) {
    return (
      <LinkValue
        href={markdown.groups.url}
        label={markdown.groups.text || markdown.groups.url}
      />
    );
  }

  if (LINKABLE_URL_RE.test(trimmed)) {
    return <LinkValue href={trimmed} label={trimmed} />;
  }

  if (HEX_COLOR_RE.test(trimmed)) {
    return (
      <span {...part("color")}>
        <span {...part("color-swatch")} style={{ backgroundColor: trimmed }} />
        {value}
      </span>
    );
  }

  return <LongText value={value} />;
}

function LinkValue({ href, label }: { href: string; label: string }) {
  const part = useParts("explorerTree");
  return (
    <a
      href={href}
      {...useTooltip(href)}
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      {...part("link")}
    >
      {label}
    </a>
  );
}

function LongText({ value }: { value: string }) {
  const m = useWorkbenchMessages();
  const part = useParts("explorerTree");
  const [expanded, setExpanded] = useState(false);
  const isLong = value.length > STRING_PREVIEW_LIMIT || value.includes("\n");

  if (!isLong) {
    return <span {...part("string")}>{value}</span>;
  }

  const firstLine = value.split("\n", 1)[0]!;
  const clipped =
    firstLine.length > STRING_PREVIEW_LIMIT
      ? firstLine.slice(0, STRING_PREVIEW_LIMIT)
      : firstLine;
  const preview = clipped.length < value.length ? `${clipped}…` : clipped;

  const toggle = () => setExpanded((prev) => !prev);
  return (
    <span {...part("string")}>
      <span {...part("long-text", expanded ? "expanded" : undefined)}>
        {expanded ? value : preview}
      </span>{" "}
      <span
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={toggle}
        onKeyDown={activateOnEnterOrSpace(() => toggle())}
        {...part("long-toggle")}
      >
        {expanded
          ? m.workbench_explorer_show_less()
          : m.workbench_explorer_show_more()}
      </span>
    </span>
  );
}
