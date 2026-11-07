// Pure paste-ready template-snippet generation for Template Data Explorer nodes.

import { formatAccessorPath, isAccessorIdentifier } from "./accessor-path";
import type { DisplayNode, ListPropertyNode } from "./display-tree";

export type TemplateEngine = "liquid" | "eta";

/** Output = interpolate; if-present = guard surrounding content on truthiness; loop/joined = array forms. */
export type SnippetKind = "output" | "if-present" | "loop" | "joined";

/**
 * Snippet kinds offered for a node, gated by its kind: arrays get joined (when
 * their elements stringify meaningfully), then loop; a list property gets
 * joined, then loop; everything else gets output + if-present. The first kind
 * is the one an insert uses. No list form names one item's index.
 */
export function snippetKindsFor(node: DisplayNode): SnippetKind[] {
  if (node.kind === "list-property") return ["joined", "loop"];
  if (node.kind === "helper" || node.kind === "placeholder") {
    return ["output", "if-present"];
  }
  if (node.valueType === "array") {
    return arrayJoinable(node.value) ? ["joined", "loop"] : ["loop"];
  }
  return ["output", "if-present"];
}

export function renderSnippet(
  node: DisplayNode,
  engine: TemplateEngine,
  kind: SnippetKind,
): string {
  if (node.kind === "list-property")
    return listPropertySnippet(node, engine, kind);
  const accessor = formatAccessorPath(node.path, "zt");
  const show = isBacklink(node) ? asZoteroLink : (output: string) => output;
  switch (kind) {
    case "output":
      return show(interpolate(engine, callForm(node, engine, accessor)));
    case "if-present":
      return guard(engine, callForm(node, engine, accessor), show);
    case "loop": {
      const item = loopVariable(node.path);
      const value = node.kind === "value" ? node.value : undefined;
      const property = arrayJoinable(value) ? undefined : firstProperty(value);
      const body =
        property === undefined ? item : formatAccessorPath([property], item);
      return loop(engine, accessor, { item, body });
    }
    case "joined":
      return joined(engine, accessor);
  }
}

/**
 * A list property goes into the note for every item: its values joined in one
 * line, or one Markdown list line per item. Neither form takes the list
 * property's output or if-present kinds, so those fall back to joined.
 */
function listPropertySnippet(
  node: ListPropertyNode,
  engine: TemplateEngine,
  kind: SnippetKind,
): string {
  const accessor = formatAccessorPath(node.list, "zt");
  const item = loopVariable(node.list);
  const value = formatAccessorPath([node.property], item);
  if (kind === "loop") return loop(engine, accessor, { item, body: value });
  return engine === "liquid"
    ? `{{ ${accessor} | map: ${JSON.stringify(node.property)} | join: ", " }}`
    : `<%= ${accessor}.map((${item}) => ${value}).join(", ") %>`;
}

/**
 * A `backlink` is a bare Zotero URL — for an Annotation, its durable link —
 * so its snippet is the Markdown link a note can follow, not the raw URL.
 */
function isBacklink(node: DisplayNode): boolean {
  return node.kind === "value" && node.path.at(-1) === "backlink";
}

function asZoteroLink(output: string): string {
  return `[Zotero](${output})`;
}

/** Eta calls a link helper explicitly (`zt.noteLink()`); Liquid auto-invokes zero-arg properties, so the bare accessor is the call. */
function callForm(
  node: DisplayNode,
  engine: TemplateEngine,
  accessor: string,
): string {
  const isHelper = node.kind === "helper" || node.kind === "placeholder";
  return engine === "eta" && isHelper ? `${accessor}()` : accessor;
}

function interpolate(engine: TemplateEngine, expr: string): string {
  return engine === "liquid" ? `{{ ${expr} }}` : `<%= ${expr} %>`;
}

function guard(
  engine: TemplateEngine,
  expr: string,
  show: (output: string) => string,
): string {
  const output = show(interpolate(engine, expr));
  return engine === "liquid"
    ? `{% if ${expr} %}${output}{% endif %}`
    : `<% if (${expr}) { %>${output}<% } %>`;
}

/** One Markdown list line per item: each pass starts a new line with `- ` and the item's `body`. */
function loop(
  engine: TemplateEngine,
  accessor: string,
  { item, body }: { item: string; body: string },
): string {
  return engine === "liquid"
    ? `{% for ${item} in ${accessor} %}\n- {{ ${body} }}{% endfor %}`
    : `<% for (const ${item} of ${accessor}) { %>\n- <%= ${body} %><% } %>`;
}

/** The first key, in the display tree's order, of the first record in a list: what a loop line shows for items with no text of their own. */
function firstProperty(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const item: unknown = value.find(
    (entry: unknown) => entry !== null && typeof entry === "object",
  );
  if (item === undefined) return undefined;
  return Object.keys(item as object).sort((a, b) => a.localeCompare(b))[0];
}

function joined(engine: TemplateEngine, accessor: string): string {
  return engine === "liquid"
    ? `{{ ${accessor} | join: ", " }}`
    : `<%= ${accessor}.join(", ") %>`;
}

/** Element name for a loop/join: the array's key with a trailing "s" stripped (tags→tag, lines→line), falling back to "item" for an index/bracket-key/non-plural segment. */
export function loopVariable(path: DisplayNode["path"]): string {
  const last = path.at(-1);
  if (
    typeof last === "string" &&
    isAccessorIdentifier(last) &&
    last.length > 1 &&
    last.endsWith("s")
  ) {
    return last.slice(0, -1);
  }
  return "item";
}

/** Joins to a meaningful string when elements are primitive or carry their own `toString` (creators, tags, collections); a plain-object array would only yield `[object Object]`. Empty arrays are permissive — their element shape is unknown. */
function arrayJoinable(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return true;
  const first: unknown = value[0];
  if (first === null || first === undefined) return false;
  if (typeof first !== "object") return true;
  return Object.hasOwn(first, "toString");
}
