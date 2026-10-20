// Expression Completion for the Filter Expression language: what a Formula, a
// Query View filter condition or a Match condition offers at the caret. The
// fields, the namespaces and the functions come from the vocabulary the host
// passes and from the function registry of `@zotlit/item-query`, so the list
// cannot disagree with evaluation.
import { autocompletion } from "@codemirror/autocomplete";
import type { Completion, CompletionContext } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";

import { parser } from "@zotlit/filter-expression";
import { GLOBAL_FUNCTIONS, IF_FUNCTION } from "@zotlit/item-query";
import type { FunctionDefinition, QueryDataset } from "@zotlit/item-query";

import type { TemplateCompletionPresentation } from "./completion";
import { matchScore } from "./matching";

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

/** What one editor can read, as its host knows it. */
export interface ExpressionVocabulary {
  readonly fields: readonly ExpressionField[];
  /** Whether the view binds a Query Context, which `this` reads. */
  readonly context: boolean;
  /** The Formula Properties of the Query File. */
  readonly formulas: readonly ExpressionName[];
  /** The vault properties a filter condition reads; absent in a Formula. */
  readonly vault?: readonly ExpressionName[];
}

/** One entry of the list. */
export interface ExpressionOption {
  /** What the entry names and the typed text matches. */
  readonly label: string;
  /** The text accepting it writes. */
  readonly insert: string;
  /** Where the caret lands, as an offset into `insert`; its end by default. */
  readonly caret?: number;
  readonly kind: "field" | "namespace" | "function";
  /** A field's type, or a function's signature. */
  readonly type?: string;
  /** A field's label, or a function's description. */
  readonly note?: string;
}

export interface ExpressionCompletionResult {
  /** The range accepting an entry replaces. */
  readonly from: number;
  readonly to: number;
  readonly options: readonly ExpressionOption[];
}

const IDENTIFIER = /^[A-Za-z_$¡-￿][\w$¡-￿]*$/;
const NAME_CHAR = /[\w$¡-￿]/;
/** Tokens whose text a completion must not interrupt. */
const LITERALS = new Set(["String", "RegExp", "RealNumber", "Escape"]);
const NAMESPACES = new Set(["this", "formula", "vault"]);

/** The compact signature an entry shows: `min(…) → number`. */
function signature(
  name: string,
  definition: Pick<FunctionDefinition, "parameters" | "optional" | "rest"> & {
    returns?: FunctionDefinition["returns"];
  },
): string {
  const takes =
    definition.parameters.length > 0 ||
    (definition.optional?.length ?? 0) > 0 ||
    definition.rest !== undefined;
  return `${name}(${takes ? "…" : ""}) → ${definition.returns ?? "any"}`;
}

const FUNCTIONS: readonly ExpressionOption[] = [
  ["if", IF_FUNCTION] as const,
  ...GLOBAL_FUNCTIONS,
].map(([name, definition]) => ({
  label: name,
  insert: `${name}()`,
  caret: name.length + 1,
  kind: "function",
  type: signature(name, definition),
  note: definition.description,
}));

function namespaced(
  namespace: string,
  { name, label }: ExpressionName,
): ExpressionOption {
  const path = `${namespace}.${name}`;
  return {
    label: path,
    // A name the dot cannot reach takes bracket access.
    insert: IDENTIFIER.test(name)
      ? path
      : `${namespace}[${JSON.stringify(name)}]`,
    kind: "namespace",
    ...noteOf(path, label),
  };
}

/** A label that says more than the name it labels. */
function noteOf(name: string, label: string | undefined) {
  return label === undefined || label === name ? {} : { note: label };
}

/** Every entry of the vocabulary, in the order the list shows ties. */
function entries(vocabulary: ExpressionVocabulary): ExpressionOption[] {
  return [
    ...vocabulary.fields.map(
      ({ path, label, type }): ExpressionOption => ({
        label: path,
        insert: path,
        kind: "field",
        ...(type === undefined ? {} : { type }),
        ...noteOf(path, label),
      }),
    ),
    ...(vocabulary.context
      ? ["item", "attachment"].map((name) => namespaced("this", { name }))
      : []),
    ...vocabulary.formulas.map((formula) => namespaced("formula", formula)),
    ...(vocabulary.vault ?? []).map((name) => namespaced("vault", name)),
    ...FUNCTIONS,
  ];
}

/**
 * What the list offers with the caret at `pos` of `source`: fields,
 * namespaces and functions at an expression position, matched by the name
 * or the label against the typed word or namespace path. `null` where the
 * caret stands in a literal, after the `.` of a value other than a
 * namespace, or on no typed word unless `explicit`.
 */
export function expressionCompletions(
  source: string,
  pos: number,
  {
    vocabulary,
    explicit = false,
  }: { vocabulary: ExpressionVocabulary; explicit?: boolean },
): ExpressionCompletionResult | null {
  for (
    let node: ReturnType<
      ReturnType<typeof parser.parse>["resolveInner"]
    > | null = parser.parse(source).resolveInner(pos, -1);
    node;
    node = node.parent
  )
    if (LITERALS.has(node.name)) return null;
  let from = pos;
  while (from > 0 && NAME_CHAR.test(source[from - 1]!)) from--;
  let to = pos;
  while (to < source.length && NAME_CHAR.test(source[to]!)) to++;
  // The typed path runs back over `name.` segments to its root.
  while (source[from - 1] === ".") {
    let start = from - 1;
    while (start > 0 && NAME_CHAR.test(source[start - 1]!)) start--;
    if (start === from - 1) break;
    from = start;
  }
  const query = source.slice(from, pos);
  if (/^\d/.test(query)) return null;
  if (query.includes(".")) {
    const root = query.slice(0, query.indexOf("."));
    // The members of a value are the member completion's.
    if (!NAMESPACES.has(root) || source[from - 1] === ".") return null;
  } else if (query === "" && !explicit) return null;
  const options = entries(vocabulary)
    .map((option, order) => ({
      option,
      order,
      score: query
        ? Math.min(
            matchScore(option.label, query),
            option.kind === "function" || option.note === undefined
              ? Infinity
              : matchScore(option.note, query),
          )
        : 0,
    }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .map(({ option }) => option);
  return options.length === 0 ? null : { from, to, options };
}

/**
 * The fields of `dataset` a Filter Expression reads by name, each with the
 * type its planner gives it and the label `label` gives its path.
 */
export function datasetExpressionFields(
  dataset: Pick<QueryDataset, "names" | "planFilter">,
  label: (path: string) => string | undefined = () => undefined,
): ExpressionField[] {
  let typed = typedFields.get(dataset);
  if (!typed) {
    typed = dataset.names.flatMap((path): ExpressionField[] => {
      if (!IDENTIFIER.test(path)) return [];
      const plan = dataset.planFilter(path);
      if ("kind" in plan) return [];
      const type = plan.root.valueType;
      if (type === "null") return [];
      return [{ path, ...(type === "unknown" ? {} : { type }) }];
    });
    typedFields.set(dataset, typed);
  }
  return typed.map((field) => {
    const named = label(field.path);
    return named === undefined ? field : { ...field, label: named };
  });
}

/** The planned fields of each dataset, which a descriptor never changes. */
const typedFields = new WeakMap<object, ExpressionField[]>();

const optionOf = new WeakMap<Completion, ExpressionOption>();

/** The entry a completion was made from, for a host that draws its own cells. */
export function expressionOption(
  completion: Completion,
): ExpressionOption | undefined {
  return optionOf.get(completion);
}

/** How a host draws the list and its rows. */
export type ExpressionCompletionPresentation = TemplateCompletionPresentation;

type ApplyCompletion = Extract<Completion["apply"], Function>;

function completionAt(
  context: CompletionContext,
  read: () => ExpressionVocabulary | null | undefined,
) {
  const vocabulary = read();
  if (!vocabulary) return null;
  const result = expressionCompletions(
    context.state.doc.toString(),
    context.pos,
    { vocabulary, explicit: context.explicit },
  );
  if (!result) return null;
  return {
    from: result.from,
    to: result.to,
    filter: false,
    options: result.options.map((option) => {
      const completion: Completion = {
        label: option.label,
        type: option.kind,
        // CodeMirror hands the range it mapped through any edit since.
        apply: (...[view, , from, to]: Parameters<ApplyCompletion>) => {
          view.dispatch({
            changes: { from, to, insert: option.insert },
            selection: {
              anchor: from + (option.caret ?? option.insert.length),
            },
            userEvent: "input.complete",
          });
        },
      };
      optionOf.set(completion, option);
      return completion;
    }),
  };
}

/**
 * Expression Completion over the vocabulary `read` gives, read per keystroke
 * so a Formula added since the editor opened is offered; a `null` vocabulary
 * offers nothing. The list opens on typing, `.` included.
 */
export function filterExpressionCompletion(
  read: () => ExpressionVocabulary | null | undefined,
  presentation: ExpressionCompletionPresentation = {},
): Extension {
  return autocompletion({
    override: [(context) => completionAt(context, read)],
    icons: false,
    ...presentation,
  });
}
