// The vocabulary an expression editor's host passes, the entries Expression
// Completion offers from it, and the ranking every part of the list shares.
import type { SyntaxNode } from "@lezer/common";

import type {
  ContextRecord,
  FilterValueType,
  FunctionDefinition,
} from "@zotlit/item-query";

import { matchScore } from "./matching";
import type { Span } from "./span";

/** A field of the Query Dataset, read by its name. */
export interface ExpressionField {
  /** The name a Filter Expression reads it by. */
  readonly path: string;
  /** The label the Properties popover gives it. */
  readonly label?: string;
  /** The type a Filter Expression reads; absent where it varies. */
  readonly type?: string;
}

/** A name read under a namespace, `formula.<name>` or `vault.<name>`. */
export interface ExpressionName {
  readonly name: string;
  /** The label the Properties popover gives its Property. */
  readonly label?: string;
}

/**
 * What one expression editor can read, as its host knows it. Expression
 * Completion offers its names, and the Signature Hint types a method call's
 * receiver by it.
 */
export interface ExpressionVocabulary {
  readonly fields: readonly ExpressionField[];
  /**
   * The records the view's Query Context binds, which `this` reads: none in
   * a Query File's own tab, the Item in a note.
   */
  readonly context: readonly ContextRecord[];
  /** The Formula Properties of the Query File. */
  readonly formulas: readonly ExpressionName[];
  /** The vault properties a filter condition reads; absent in a Formula. */
  readonly vault?: readonly ExpressionName[];
  /**
   * The custom fields of the Zotero source, offered quoted inside
   * `<path>[...]`: `custom`, or `item.custom` where the dataset reads its
   * Item's custom fields.
   */
  readonly custom?: {
    readonly path: string;
    readonly names: readonly string[];
  };
  /**
   * What the value before a `.` at `at` of `source` is, as the planner reads
   * it where it stands; undefined where it does not plan. Without it, every
   * member is offered.
   */
  readonly receiver?: (
    source: string,
    at: Span,
  ) => ExpressionReceiver | undefined;
}

/** The value before a `.`, as the planner reads it. */
export interface ExpressionReceiver {
  /** Undefined where the type is known only at execution. */
  readonly type: FilterValueType | undefined;
  /** The members a filter reads on the record it is. */
  readonly members?: readonly ExpressionField[];
}

/** One entry of the list. */
export interface ExpressionOption {
  /** What the entry names and the typed text matches. */
  readonly label: string;
  /** The text accepting it writes. */
  readonly insert: string;
  /** Where the caret lands, as an offset into `insert`; its end by default. */
  readonly caret?: number;
  readonly kind:
    | "field"
    | "namespace"
    | "function"
    | "method"
    | "property"
    | "key"
    | "variable";
  /** A field's or a property's type, or a function's signature. */
  readonly type?: string;
  /** A field's label, or a function's or a member's description. */
  readonly note?: string;
}

/** The caret in a parsed source: the innermost node at `pos`. */
export interface Caret {
  readonly inner: SyntaxNode;
  readonly pos: number;
  readonly source: string;
}

export interface ExpressionCompletionResult {
  /** The range accepting an entry replaces. */
  readonly from: number;
  readonly to: number;
  readonly options: readonly ExpressionOption[];
}

/** The compact signature an entry shows: `min(…) → number`. */
export function signature(
  name: string,
  definition: Pick<FunctionDefinition, "parameters" | "optional" | "rest"> & {
    returns?: FunctionDefinition["returns"];
  },
): string {
  return `${name}(${takesArguments(definition) ? "…" : ""}) → ${definition.returns ?? "any"}`;
}

export const takesArguments = (
  definition: Pick<FunctionDefinition, "parameters" | "optional" | "rest">,
): boolean =>
  definition.parameters.length > 0 ||
  (definition.optional?.length ?? 0) > 0 ||
  definition.rest !== undefined;

/** A label that says more than the name it labels. */
export function noteOf(name: string, label: string | undefined) {
  return label === undefined || label === name ? {} : { note: label };
}

/** A field as an entry, inserted by its name. */
export const fieldOption = ({
  path,
  label,
  type,
}: ExpressionField): ExpressionOption => ({
  label: path,
  insert: path,
  kind: "field",
  ...(type === undefined ? {} : { type }),
  ...noteOf(path, label),
});

/** The texts the typed query matches: a name, and a field's or a namespace's label. */
export const optionTexts = (option: ExpressionOption): readonly string[] =>
  (option.kind === "field" || option.kind === "namespace") &&
  option.note !== undefined
    ? [option.label, option.note]
    : [option.label];

/**
 * The items any of whose `texts` match `query`, best first, ties in the
 * order given; every item for an empty `query`.
 */
export function ranked<T>(
  items: readonly T[],
  query: string,
  texts: (item: T) => readonly string[],
): T[] {
  return items
    .map((item, order) => ({
      item,
      order,
      score: query
        ? Math.min(...texts(item).map((text) => matchScore(text, query)))
        : 0,
    }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .map(({ item }) => item);
}
