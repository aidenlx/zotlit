// Pure paste-ready template-snippet generation for Template Data Explorer nodes.

import { type DisplayNode, formatPath } from "./display-tree";

export type TemplateEngine = "liquid" | "eta";

/** Output = interpolate; if-present = guard surrounding content on truthiness; loop/joined = array forms. */
export type SnippetKind = "output" | "if-present" | "loop" | "joined";

/** Snippet kinds offered for a node, gated by its kind: arrays get loop (+ joined when their elements stringify meaningfully); everything else gets output + if-present. */
export function snippetKindsFor(node: DisplayNode): SnippetKind[] {
  if (node.kind === "helper" || node.kind === "placeholder") {
    return ["output", "if-present"];
  }
  if (node.valueType === "array") {
    return arrayJoinable(node.value) ? ["loop", "joined"] : ["loop"];
  }
  return ["output", "if-present"];
}

export function renderSnippet(
  node: DisplayNode,
  engine: TemplateEngine,
  kind: SnippetKind,
): string {
  const accessor = formatPath(node.path, "zt");
  switch (kind) {
    case "output":
      return interpolate(engine, callForm(node, engine, accessor));
    case "if-present":
      return guard(engine, callForm(node, engine, accessor));
    case "loop":
      return loop(engine, accessor, loopVar(node));
    case "joined":
      return joined(engine, accessor);
  }
}

/** Eta calls a link helper explicitly (`zt.fileLink()`); Liquid auto-invokes zero-arg properties, so the bare accessor is the call. */
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

function guard(engine: TemplateEngine, expr: string): string {
  return engine === "liquid"
    ? `{% if ${expr} %}{{ ${expr} }}{% endif %}`
    : `<% if (${expr}) { %><%= ${expr} %><% } %>`;
}

function loop(engine: TemplateEngine, accessor: string, item: string): string {
  return engine === "liquid"
    ? `{% for ${item} in ${accessor} %}{{ ${item} }}{% endfor %}`
    : `<% for (const ${item} of ${accessor}) { %><%= ${item} %><% } %>`;
}

function joined(engine: TemplateEngine, accessor: string): string {
  return engine === "liquid"
    ? `{{ ${accessor} | join: ", " }}`
    : `<%= ${accessor}.join(", ") %>`;
}

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Element name for a loop/join: the array's key with a trailing "s" stripped (tags→tag, lines→line), falling back to "item" for an index/bracket-key/non-plural segment. */
function loopVar(node: DisplayNode): string {
  const last = node.path.at(-1);
  if (
    typeof last === "string" &&
    IDENTIFIER_RE.test(last) &&
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
