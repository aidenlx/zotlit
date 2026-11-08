// Pure paste-ready template-snippet generation for Template Data Explorer nodes.

import { formatAccessorPath, isAccessorIdentifier } from "./accessor-path";
import type { TemplatePathSegment } from "./accessor-path";
import type { DisplayNode, ListPropertyNode } from "./display-tree";
import { JOIN_SEPARATOR, readList, shownTexts } from "./list-items";
import { coerceToString } from "./string-coercion";

/** What starts each item's line in the loop form: a Markdown list line. */
const LIST_LINE = "- ";

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
  // A backlink's Markdown link takes a loop to repeat; a join would list bare URLs.
  if (node.kind === "list-property")
    return node.property === BACKLINK ? ["loop"] : ["joined", "loop"];
  if (node.kind === "helper" || node.kind === "placeholder") {
    return ["output", "if-present"];
  }
  if (node.valueType === "array") {
    return readList(itemsOf(node)).readsAsText ? ["joined", "loop"] : ["loop"];
  }
  return ["output", "if-present"];
}

/**
 * The forms a list or a list property goes into the note in, joined in one
 * line and for each item, in the order {@link snippetKindsFor} offers them;
 * none for a node that is not a list.
 */
export function listSnippetKinds(node: DisplayNode): SnippetKind[] {
  return snippetKindsFor(node).filter(
    (kind) => kind === "joined" || kind === "loop",
  );
}

export function renderSnippet(
  node: DisplayNode,
  engine: TemplateEngine,
  kind: SnippetKind,
): string {
  if (node.kind === "list-property")
    return listPropertySnippet(node, engine, kind);
  const accessor = formatAccessorPath(node.path, "zt");
  const show = showOfNode(node);
  switch (kind) {
    case "output":
      return show(interpolate(engine, callForm(node, engine, accessor)));
    case "if-present":
      return guard(engine, callForm(node, engine, accessor), show);
    case "loop": {
      const item = loopVariable(node.path);
      const property = readList(itemsOf(node)).lineProperty;
      const body =
        property === undefined ? item : formatAccessorPath([property], item);
      return loop(engine, accessor, {
        item,
        body,
        show: showOf(property),
        // A line that reads a property passes over an item without it.
        guarded: property !== undefined,
      });
    }
    case "joined":
      return joined(engine, accessor);
  }
}

/**
 * A list property goes into the note for every item that has a value: its
 * values joined in one line, or one Markdown list line per item. Neither
 * form takes the list property's output or if-present kinds, so those fall
 * back to joined. An item without a value adds no separator and no line,
 * by the rule {@link hasValue} states.
 */
function listPropertySnippet(
  node: ListPropertyNode,
  engine: TemplateEngine,
  kind: SnippetKind,
): string {
  const accessor = formatAccessorPath(node.list, "zt");
  const item = loopVariable(node.list);
  const value = formatAccessorPath([node.property], item);
  if (kind === "loop")
    return loop(engine, accessor, {
      item,
      body: value,
      show: showOf(node.property),
      guarded: true,
    });
  const separator = JSON.stringify(JOIN_SEPARATOR);
  return engine === "liquid"
    ? `{{ ${accessor} | map: ${JSON.stringify(node.property)} | compact | join: ${separator} }}`
    : `<%= ${accessor}.map((${item}) => ${value}).filter((value) => value != null).join(${separator}) %>`;
}

/**
 * A `backlink` is a bare Zotero URL — for an Annotation, its durable link —
 * so its snippet is the Markdown link a note can follow, not the raw URL. It
 * names the field's own key, or the property each line of a list shows.
 */
const BACKLINK = "backlink";

/** How a value of the field `key` shows in the note: a backlink as its Markdown link. */
function showOf(
  key: TemplatePathSegment | undefined,
): (output: string) => string {
  return key === BACKLINK ? asZoteroLink : (output) => output;
}

/** How a node's own value shows in the note, by the key of the field it is. */
function showOfNode(node: DisplayNode): (output: string) => string {
  return showOf(node.kind === "value" ? node.path.at(-1) : undefined);
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

/**
 * One Markdown list line per item: each pass starts a new line with `- ` and
 * the item's `body`, as `show` writes it. `guarded` passes over an item whose
 * `body` has no value, so it leaves no empty line.
 */
function loop(
  engine: TemplateEngine,
  accessor: string,
  {
    item,
    body,
    show,
    guarded = false,
  }: {
    item: string;
    body: string;
    show: (output: string) => string;
    guarded?: boolean;
  },
): string {
  if (engine === "liquid") {
    const line = `\n${LIST_LINE}${show(`{{ ${body} }}`)}`;
    const each = guarded ? `{% if ${body} != nil %}${line}{% endif %}` : line;
    return `{% for ${item} in ${accessor} %}${each}{% endfor %}`;
  }
  const line = `\n${LIST_LINE}${show(`<%= ${body} %>`)}`;
  const each = guarded ? `<% if (${body} != null) { %>${line}<% } %>` : line;
  return `<% for (const ${item} of ${accessor}) { %>${each}<% } %>`;
}

/** The items of a list node; none for any other node. */
function itemsOf(node: DisplayNode): readonly unknown[] {
  return node.kind === "value" && Array.isArray(node.value) ? node.value : [];
}

function joined(engine: TemplateEngine, accessor: string): string {
  return engine === "liquid"
    ? `{{ ${accessor} | join: ${JSON.stringify(JOIN_SEPARATOR)} }}`
    : `<%= ${accessor}.join(${JSON.stringify(JOIN_SEPARATOR)}) %>`;
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

/**
 * What the snippet of `kind` writes into the note for the node's own value,
 * by the same rules the snippet is written with: a list joined in one line
 * or one Markdown list line per item, and a backlink as its Markdown link.
 * `null` where the value gives the note nothing. It reads the value and does
 * not render the template.
 */
export function snippetResult(
  node: DisplayNode,
  kind: SnippetKind,
): string | null {
  const text =
    kind === "loop"
      ? listItemTexts(node)
          .map((item) => `${LIST_LINE}${showOf(lineKey(node))(item)}`)
          .join("\n")
      : // A list property takes no output form: it joins, as its snippet does.
        kind === "joined" || node.kind === "list-property"
        ? listItemTexts(node).join(JOIN_SEPARATOR)
        : outputResult(node);
  return text === "" ? null : text;
}

/**
 * The text a node's own value prints as in a note: a helper's rendering, a
 * placeholder's reason, nothing for a value that is null, undefined or not
 * evaluated, and the value as a string otherwise.
 */
export function outputText(
  node: Exclude<DisplayNode, ListPropertyNode>,
): string {
  if (node.kind === "placeholder") return node.reason;
  if (node.kind === "helper") return node.evaluated ?? "";
  switch (node.valueType) {
    case "getter":
    case "null":
    case "undefined":
      return "";
    default:
      return coerceToString(node.value);
  }
}

function outputResult(node: Exclude<DisplayNode, ListPropertyNode>): string {
  const text = outputText(node);
  return text === "" ? text : showOfNode(node)(text);
}

/** The key each line of a list shows: the list property, or the property the list's lines read. */
function lineKey(node: DisplayNode): string | undefined {
  return node.kind === "list-property"
    ? node.property
    : readList(itemsOf(node)).lineProperty;
}

/**
 * Each item of a list, or of a list property, as one line of the loop shows
 * it: the loop's body for that item. An item the loop passes over is left
 * out. None for a node that is not a list.
 */
export function listItemTexts(node: DisplayNode): readonly string[] {
  return shownTexts(listItemValues(node));
}

/**
 * Every item of a list property as text, `null` for an item without a
 * value; each line of a list otherwise. The details list them all.
 */
export function listItemValues(node: DisplayNode): readonly (string | null)[] {
  if (node.kind === "list-property") return node.values;
  return readList(itemsOf(node)).lines;
}
