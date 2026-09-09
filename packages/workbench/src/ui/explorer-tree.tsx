// Presentational tree renderer for display-tree nodes; raises intent via callbacks only.

import type {
  DisplayNode,
  HelperNode,
  PlaceholderNode,
  ValueNode,
} from "#/explorer/index";
import { regex } from "arkregex";
import { useEffect, useRef, useState } from "react";

import { useTooltip } from "./host";
import { useWorkbenchMessages } from "./messages";
import type { ExplorerVariant } from "./store";
import { useIcon, useParts } from "./theme";
import type { WorkbenchIcon } from "./theme";

import { copyValue, formatPath } from "#/explorer/index";

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

export interface DisplayTreeProps {
  variant?: ExplorerVariant;
  nodes: readonly DisplayNode[];
  /** Keys of nodes directly matched by the filter; null when no filter is active. */
  matchedKeys: ReadonlySet<string> | null;
  onToggle: (key: string) => void;
  /** Copies the node's value; resolves on success so the row can flash a confirmation. */
  onCopyValue: (node: DisplayNode) => Promise<void>;
  onInsert?: (node: DisplayNode) => void;
  onTemplateMenu: (node: DisplayNode, event: React.MouseEvent) => void;
}

export function DisplayTree({
  variant = "all",
  nodes,
  matchedKeys,
  onToggle,
  onCopyValue,
  onInsert,
  onTemplateMenu,
}: DisplayTreeProps): React.ReactElement {
  const part = useParts("explorerTree");
  return (
    <ul role="tree" {...part("tree", variant)}>
      {nodes.map((node) => (
        <TreeNode
          key={node.key}
          variant={variant}
          node={node}
          matchedKeys={matchedKeys}
          onToggle={onToggle}
          onCopyValue={onCopyValue}
          onInsert={onInsert}
          onTemplateMenu={onTemplateMenu}
        />
      ))}
    </ul>
  );
}

interface TreeNodeProps {
  variant: ExplorerVariant;
  node: DisplayNode;
  matchedKeys: ReadonlySet<string> | null;
  onToggle: (key: string) => void;
  onCopyValue: (node: DisplayNode) => Promise<void>;
  onInsert?: (node: DisplayNode) => void;
  onTemplateMenu: (node: DisplayNode, event: React.MouseEvent) => void;
}

function TreeNode({
  variant,
  node,
  matchedKeys,
  onToggle,
  onCopyValue,
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
      <div {...part("row", isMatched ? "matched" : undefined)}>
        {isExpandable ? (
          <Chevron expanded={isExpanded} onClick={() => onToggle(node.key)} />
        ) : (
          <span {...part("spacer")} />
        )}
        {/* Key + hint + value flow as inline text, so a long value starts after its key and wraps beneath — never orphaning the key on its own line. */}
        <div {...part("contents")}>
          {variant === "simple" ? (
            <SimpleNodeRow node={node} />
          ) : (
            <NodeRow node={node} />
          )}
        </div>
        <ActionCluster
          node={node}
          onCopyValue={onCopyValue}
          onInsert={onInsert}
          onTemplateMenu={onTemplateMenu}
        />
      </div>
      {node.kind === "value" && node.children && (
        <ul role="group" {...part("group")}>
          {node.children.map((child) => (
            <TreeNode
              key={child.key}
              variant={variant}
              node={child}
              matchedKeys={matchedKeys}
              onToggle={onToggle}
              onCopyValue={onCopyValue}
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

/** Hover/focus-revealed row actions, floated top-right over the row so it never steals value width. */
function ActionCluster({
  node,
  onCopyValue,
  onInsert,
  onTemplateMenu,
}: {
  node: DisplayNode;
  onCopyValue: (node: DisplayNode) => Promise<void>;
  onInsert?: (node: DisplayNode) => void;
  onTemplateMenu: (node: DisplayNode, event: React.MouseEvent) => void;
}) {
  const m = useWorkbenchMessages();
  const part = useParts("explorerTree");
  const hasValue = copyValue(node) !== null;
  const [copied, setCopied] = useState(false);
  const revertTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (revertTimer.current !== null)
        window.clearTimeout(revertTimer.current);
    },
    [],
  );

  const flashCopied = () => {
    void onCopyValue(node).then(
      () => {
        setCopied(true);
        if (revertTimer.current !== null)
          window.clearTimeout(revertTimer.current);
        revertTimer.current = window.setTimeout(() => setCopied(false), 1000);
      },
      () => {},
    );
  };

  return (
    <div {...part("actions")}>
      {onInsert && (
        <ClusterButton
          icon="add"
          label={m.workbench_fields_put_in_note()}
          onClick={() => onInsert(node)}
        />
      )}
      {hasValue && (
        <ClusterButton
          icon={copied ? "confirm" : "copy"}
          label={m.workbench_explorer_menu_copy_value()}
          onClick={flashCopied}
        />
      )}
      <ClusterButton
        icon="advanced"
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

function NodeRow({ node }: { node: DisplayNode }) {
  switch (node.kind) {
    case "value":
      return <ValueRow node={node} />;
    case "helper":
      return <HelperRow node={node} />;
    case "placeholder":
      return <PlaceholderRow node={node} />;
  }
}

/** The property name (or array index). Always `text-foreground`, distinct from every value tone. */
function KeyLabel({ children }: { children: React.ReactNode }) {
  const part = useParts("explorerTree");
  return <span {...part("key")}>{children}</span>;
}

function ValueRow({ node }: { node: ValueNode }) {
  return (
    <>
      <KeyLabel>{node.label}</KeyLabel> <ValueContent node={node} />
    </>
  );
}

function ValueContent({ node }: { node: ValueNode }) {
  const part = useParts("explorerTree");
  if (node.valueType === "array" || node.valueType === "object") {
    const hint =
      node.valueType === "array" ? `[${node.size}]` : `{${node.size}}`;
    return (
      <>
        <span {...part("hint")}>{hint}</span>
        {node.children === undefined && node.preview !== undefined && (
          <>
            {" "}
            <span {...part("placeholder")}>{node.preview}</span>
          </>
        )}
      </>
    );
  }
  if (node.valueType === "getter") return <span {...part("hint")}>…</span>;
  return <ScalarValue node={node} />;
}

function SimpleNodeRow({ node }: { node: DisplayNode }) {
  const part = useParts("explorerTree");
  const path = formatPath(node.path, "zt");
  const tooltip = useTooltip(path);
  const container =
    node.kind === "value" &&
    (node.valueType === "array" || node.valueType === "object")
      ? node
      : null;
  if (container && !container.preview) {
    return (
      <div {...part("simple-row")} {...tooltip}>
        <div {...part("simple-heading")}>
          <KeyLabel>{node.label}</KeyLabel>
          {container.valueType === "array" && (
            <>
              {" "}
              <span {...part("hint")}>({container.size})</span>
            </>
          )}
        </div>
      </div>
    );
  }
  return (
    <div {...part("simple-row")}>
      <div {...part("simple-heading")} {...tooltip}>
        <KeyLabel>{node.label}</KeyLabel>
        <code {...part("path")} {...tooltip}>
          {path}
        </code>
      </div>
      <div {...part("simple-value")}>
        {container ? (
          <StringValue value={container.preview!} />
        ) : node.kind === "value" ? (
          <ValueContent node={node} />
        ) : node.kind === "helper" ? (
          node.evaluated === null ? (
            <span {...part("null")}>null</span>
          ) : (
            <StringValue value={node.evaluated} />
          )
        ) : (
          <span {...part("placeholder")}>{node.reason}</span>
        )}
      </div>
    </div>
  );
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

function HelperRow({ node }: { node: HelperNode }) {
  const part = useParts("explorerTree");
  return (
    <>
      <KeyLabel>{node.label}</KeyLabel>{" "}
      <span {...part("hint")}>{node.signatureHint}</span>{" "}
      {node.evaluated === null ? (
        <span {...part("null")}>null</span>
      ) : (
        <StringValue value={node.evaluated} />
      )}
    </>
  );
}

function PlaceholderRow({ node }: { node: PlaceholderNode }) {
  const part = useParts("explorerTree");
  return (
    <>
      <KeyLabel>{node.label}</KeyLabel>{" "}
      <span {...part("placeholder")}>{node.reason}</span>
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
