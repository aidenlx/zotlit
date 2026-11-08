// One field's forms in the note: the kind of each form, the text an insert or
// a copy writes, and what that text gives for this item. Every surface of the
// Fields Panel — the details, Copy, Insert, Mod+Enter and the row menu — reads
// a field's text here, in the insertion context the host reads from the caret
// at the time of the action.
import type {
  DisplayNode,
  SnippetKind,
  TemplateEngine,
} from "#/explorer/index";

import {
  formatAccessorPath,
  listItemTexts,
  listSnippetKinds,
  loopVariable,
  outputText,
  renderSnippet,
  snippetKindsFor,
  snippetResult,
} from "#/explorer/index";

/**
 * What the place an insert writes to reads: template source, a Properties
 * expression, or a JSON-e Properties value.
 */
export type FieldInsertionMode = "template" | "expression" | "json-e";

/** Where an insert writes now: the document's template engine and the kind of place the caret is in. */
export interface FieldInsertionContext {
  readonly engine: TemplateEngine;
  readonly mode: FieldInsertionMode;
}

/** A Liquid template: the context of a host that names no other. */
export const TEMPLATE_INSERTION: FieldInsertionContext = {
  engine: "liquid",
  mode: "template",
};

/** One form a field goes into the note in. */
export interface FieldForm {
  readonly kind: SnippetKind;
  /** The text an insert or a copy writes. */
  readonly snippet: string;
  /** What the text gives for this item; `null` where it gives nothing. */
  readonly result: string | null;
}

/**
 * How an insert from the Fields Panel goes: `keepOpen` when Shift kept the
 * panel open for the next field, so the editor takes no focus.
 */
export interface FieldInsertOptions {
  readonly keepOpen: boolean;
}

/**
 * The forms `node` goes into the note in, at a place of `context`, the first
 * of them the one an insert uses. A list in a template offers its forms in
 * one line and for each item; any other field, and any field in a
 * Properties value, has one form.
 */
export function fieldForms(
  node: DisplayNode,
  { engine, mode }: FieldInsertionContext,
): readonly FieldForm[] {
  if (mode !== "template")
    return [
      {
        kind: "output",
        snippet: valueSnippet(node, mode),
        result: valueOf(node),
      },
    ];
  const lists = listSnippetKinds(node);
  const kinds = lists.length > 0 ? lists : [snippetKindsFor(node)[0]!];
  return kinds.map((kind) => ({
    kind,
    snippet: renderSnippet(node, engine, kind),
    result: snippetResult(node, kind),
  }));
}

/** The form of `kind` that `node` offers at a place of `context`; its first form otherwise. */
export function fieldForm(
  node: DisplayNode,
  context: FieldInsertionContext,
  kind?: SnippetKind,
): FieldForm {
  const forms = fieldForms(node, context);
  return forms.find((form) => form.kind === kind) ?? forms[0]!;
}

/** A Properties value reads the field itself: a list stays a list. */
function valueSnippet(
  node: DisplayNode,
  mode: Exclude<FieldInsertionMode, "template">,
): string {
  if (node.kind === "list-property") {
    // A frontmatter value takes the property of every item as a list.
    const list = formatAccessorPath(node.list, "zt");
    if (mode === "expression")
      return `${list} | map: ${JSON.stringify(node.property)}`;
    const item = loopVariable(node.list);
    return JSON.stringify({
      $map: { $eval: list },
      [`each(${item})`]: { $eval: formatAccessorPath([node.property], item) },
    });
  }
  const path = formatAccessorPath(node.path, "zt");
  return mode === "expression" ? path : JSON.stringify({ $eval: path });
}

/** What a Properties value holds for this item: a list's items, else the value's text. */
function valueOf(node: DisplayNode): string | null {
  const text =
    node.kind === "list-property" ||
    (node.kind === "value" && node.valueType === "array")
      ? listItemTexts(node).join(", ")
      : outputText(node);
  return text === "" ? null : text;
}
