// Presentational tree renderer for display-tree nodes; raises intent via callbacks only.

import { regex } from "arkregex";
import type { IconName } from "obsidian";
import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/obsidian/icon";
import * as m from "@/lib/i18n/generated/messages";
import { tooltipAttrs } from "@/lib/utils";

import { copyValue } from "./display-tree";
import type {
  DisplayNode,
  DisplayValueType,
  HelperNode,
  PlaceholderNode,
  ValueNode,
} from "./display-tree";

/** Per-primitive value tone; keys stay `text-foreground`, so a key never shares a value's styling. */
const VALUE_TONE: Record<DisplayValueType, string> = {
  string: "zt:text-green",
  number: "zt:text-blue",
  boolean: "zt:text-purple",
  null: "zt:text-faint zt:italic",
  undefined: "zt:text-faint zt:italic",
  opaque: "zt:text-cyan",
  getter: "zt:text-faint",
  array: "zt:text-faint",
  object: "zt:text-faint",
};

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
  nodes: readonly DisplayNode[];
  /** Keys of nodes directly matched by the filter; null when no filter is active. */
  matchedKeys: ReadonlySet<string> | null;
  onToggle: (key: string) => void;
  /** Copies the node's value; resolves on success so the row can flash a confirmation. */
  onCopyValue: (node: DisplayNode) => Promise<void>;
  onTemplateMenu: (node: DisplayNode, event: React.MouseEvent) => void;
}

export function DisplayTree({
  nodes,
  matchedKeys,
  onToggle,
  onCopyValue,
  onTemplateMenu,
}: DisplayTreeProps): React.ReactElement {
  return (
    <ul role="tree" className="zt:font-mono zt:text-xs zt:leading-relaxed">
      {nodes.map((node) => (
        <TreeNode
          key={node.key}
          node={node}
          matchedKeys={matchedKeys}
          onToggle={onToggle}
          onCopyValue={onCopyValue}
          onTemplateMenu={onTemplateMenu}
        />
      ))}
    </ul>
  );
}

interface TreeNodeProps {
  node: DisplayNode;
  matchedKeys: ReadonlySet<string> | null;
  onToggle: (key: string) => void;
  onCopyValue: (node: DisplayNode) => Promise<void>;
  onTemplateMenu: (node: DisplayNode, event: React.MouseEvent) => void;
}

function TreeNode({
  node,
  matchedKeys,
  onToggle,
  onCopyValue,
  onTemplateMenu,
}: TreeNodeProps) {
  const isExpanded = node.kind === "value" && node.children !== undefined;
  const isExpandable = node.kind === "value" && node.expandable;
  const isMatched = matchedKeys?.has(node.key) ?? false;

  return (
    <li role="treeitem" aria-expanded={isExpandable ? isExpanded : undefined}>
      <div
        className={`zt:group zt:rounded zt:relative zt:flex zt:min-w-0 zt:items-start zt:gap-x-1 zt:px-0.5 zt:hover:bg-muted${isMatched ? " zt:bg-(--text-highlight-bg)" : ""}`}
      >
        {isExpandable ? (
          <Chevron expanded={isExpanded} onClick={() => onToggle(node.key)} />
        ) : (
          <span className="zt:mt-[3px] zt:size-3 zt:shrink-0" />
        )}
        {/* Key + hint + value flow as inline text, so a long value starts after its key and wraps beneath — never orphaning the key on its own line. */}
        <div className="zt:min-w-0 zt:flex-1 zt:select-text">
          <NodeRow node={node} />
        </div>
        <ActionCluster
          node={node}
          onCopyValue={onCopyValue}
          onTemplateMenu={onTemplateMenu}
        />
      </div>
      {node.kind === "value" && node.children && (
        <ul
          role="group"
          className="zt:ml-3 zt:border-l zt:border-(--nav-indentation-guide-color) zt:pl-2"
        >
          {node.children.map((child) => (
            <TreeNode
              key={child.key}
              node={child}
              matchedKeys={matchedKeys}
              onToggle={onToggle}
              onCopyValue={onCopyValue}
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
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={m.template_data_explorer_toggle_node()}
      onClick={onClick}
      onKeyDown={activateOnEnterOrSpace(() => onClick())}
      data-expanded={expanded ? "" : undefined}
      className="zt:mt-[3px] zt:flex zt:size-3 zt:shrink-0 zt:cursor-pointer zt:items-center zt:justify-center zt:text-(--nav-collapse-icon-color) zt:transition-transform zt:duration-100 zt:ease-out zt:hover:text-foreground zt:data-[expanded]:rotate-90"
    >
      <svg viewBox="0 0 24 24" className="zt:size-3">
        <polyline
          points="9 6 15 12 9 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/** Hover/focus-revealed row actions, floated top-right over the row so it never steals value width. */
function ActionCluster({
  node,
  onCopyValue,
  onTemplateMenu,
}: {
  node: DisplayNode;
  onCopyValue: (node: DisplayNode) => Promise<void>;
  onTemplateMenu: (node: DisplayNode, event: React.MouseEvent) => void;
}) {
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
    void onCopyValue(node).then(() => {
      setCopied(true);
      if (revertTimer.current !== null)
        window.clearTimeout(revertTimer.current);
      revertTimer.current = window.setTimeout(() => setCopied(false), 1000);
    });
  };

  return (
    <div className="zt:absolute zt:top-0.5 zt:right-0 zt:flex zt:items-center zt:gap-0.5 zt:bg-linear-to-l zt:from-background zt:from-60% zt:to-transparent zt:pl-6 zt:opacity-0 zt:group-hover:opacity-100 zt:focus-within:opacity-100">
      {hasValue && (
        <ClusterButton
          icon={copied ? "check" : "clipboard-type"}
          label={m.template_data_explorer_menu_copy_value()}
          onClick={flashCopied}
        />
      )}
      <ClusterButton
        icon="code"
        label={m.template_data_explorer_row_actions()}
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
  icon: IconName;
  label: string;
  onClick: (event: React.MouseEvent) => void;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      {...tooltipAttrs(label)}
      onClick={onClick}
      onKeyDown={activateOnEnterOrSpace((e) => e.currentTarget.click())}
      className="zt:rounded-xs zt:flex zt:size-4 zt:cursor-pointer zt:items-center zt:justify-center zt:text-muted-foreground zt:hover:bg-muted zt:hover:text-foreground"
    >
      <Icon name={icon} size={13} />
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
  return <span className="zt:text-foreground">{children}</span>;
}

function ValueRow({ node }: { node: ValueNode }) {
  if (node.valueType === "array" || node.valueType === "object") {
    const hint =
      node.valueType === "array" ? `[${node.size}]` : `{${node.size}}`;
    const showPreview =
      node.children === undefined && node.preview !== undefined;
    return (
      <>
        <KeyLabel>{node.label}</KeyLabel>{" "}
        <span className="zt:text-faint">{hint}</span>
        {showPreview && (
          <>
            {" "}
            <span className="zt:text-faint zt:italic">{node.preview}</span>
          </>
        )}
      </>
    );
  }

  if (node.valueType === "getter") {
    return (
      <>
        <KeyLabel>{node.label}</KeyLabel>{" "}
        <span className="zt:text-faint">…</span>
      </>
    );
  }

  return (
    <>
      <KeyLabel>{node.label}</KeyLabel> <ScalarValue node={node} />
    </>
  );
}

function ScalarValue({ node }: { node: ValueNode }) {
  switch (node.valueType) {
    case "string":
      return <StringValue value={node.value as string} />;
    case "number":
      return <span className={VALUE_TONE.number}>{String(node.value)}</span>;
    case "boolean":
      return <span className={VALUE_TONE.boolean}>{String(node.value)}</span>;
    case "null":
      return <span className={VALUE_TONE.null}>null</span>;
    case "undefined":
      return <span className={VALUE_TONE.undefined}>undefined</span>;
    case "opaque":
      return (
        <span className={`zt:break-words ${VALUE_TONE.opaque}`}>
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
  return (
    <>
      <KeyLabel>{node.label}</KeyLabel>{" "}
      <span className="zt:text-faint">{node.signatureHint}</span>{" "}
      {node.evaluated === null ? (
        <span className={VALUE_TONE.null}>null</span>
      ) : (
        <StringValue value={node.evaluated} />
      )}
    </>
  );
}

function PlaceholderRow({ node }: { node: PlaceholderNode }) {
  return (
    <>
      <KeyLabel>{node.label}</KeyLabel>{" "}
      <span className="zt:text-faint zt:italic">{node.reason}</span>
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
  const trimmed = value.trim();

  const markdown = MARKDOWN_LINK_RE.exec(value);
  if (markdown) {
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
      <span
        className={`zt:inline-flex zt:min-w-0 zt:items-center zt:gap-1 ${VALUE_TONE.string}`}
      >
        <span
          className="zt:rounded-xs zt:size-3 zt:shrink-0 zt:border zt:border-border"
          style={{ backgroundColor: trimmed }}
        />
        {value}
      </span>
    );
  }

  return <LongText value={value} />;
}

function LinkValue({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      {...tooltipAttrs(href)}
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="zt:break-all zt:text-link zt:underline zt:decoration-dotted zt:hover:decoration-solid"
    >
      {label}
    </a>
  );
}

function LongText({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = value.length > STRING_PREVIEW_LIMIT || value.includes("\n");

  if (!isLong) {
    return <span className={VALUE_TONE.string}>{value}</span>;
  }

  const firstLine = value.split("\n", 1)[0]!;
  const clipped =
    firstLine.length > STRING_PREVIEW_LIMIT
      ? firstLine.slice(0, STRING_PREVIEW_LIMIT)
      : firstLine;
  const preview = clipped.length < value.length ? `${clipped}…` : clipped;

  const toggle = () => setExpanded((prev) => !prev);
  return (
    <span className={`zt:min-w-0 ${VALUE_TONE.string}`}>
      <span className={expanded ? "zt:break-words zt:whitespace-pre-wrap" : ""}>
        {expanded ? value : preview}
      </span>{" "}
      <span
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={toggle}
        onKeyDown={activateOnEnterOrSpace(() => toggle())}
        className="zt:rounded-xs zt:ml-0.5 zt:cursor-pointer zt:px-1 zt:text-muted-foreground zt:underline zt:decoration-dotted zt:underline-offset-2 zt:select-none zt:hover:bg-muted zt:hover:text-foreground"
      >
        {expanded
          ? m.template_data_explorer_show_less()
          : m.template_data_explorer_show_more()}
      </span>
    </span>
  );
}
