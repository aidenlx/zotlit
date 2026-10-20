// Expression Completion for the Filter Expression language: what a Formula, a
// Query View filter condition or a Match condition offers at the caret. The
// fields, the namespaces and the functions come from the vocabulary the host
// passes and from the function registry of `@zotlit/item-query`, so the list
// cannot disagree with evaluation.
import { autocompletion, startCompletion } from "@codemirror/autocomplete";
import type { Completion, CompletionContext } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

import { parser } from "@zotlit/filter-expression";
import {
  GLOBAL_FUNCTIONS,
  IF_FUNCTION,
  METHOD_ENTRIES,
  PROPERTY_ENTRIES,
} from "@zotlit/item-query";
import type {
  FilterValueType,
  FunctionDefinition,
  PropertyDefinition,
  QueryDataset,
} from "@zotlit/item-query";

import type { CompletionPresentation } from "./completion";
import { bindsNames, boundNamesAt } from "./list-scope";
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
  /** Whether the view binds a Query Context, which `this` reads. */
  readonly context: boolean;
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
  /** Its static type; undefined where it is known only at execution. */
  readonly type: FilterValueType | undefined;
  /** The members a record reads, each with the type its planner gives it. */
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

/** The methods of each name, with the value type each belongs to. */
const METHODS_BY_NAME = Map.groupBy(METHOD_ENTRIES, ([, name]) => name);
const PROPERTIES_BY_NAME = Map.groupBy(PROPERTY_ENTRIES, ([, name]) => name);

/** One entry per member name, from the definitions of it that apply. */
function memberOption(
  kind: "method" | "property",
  name: string,
  definitions: readonly (FunctionDefinition | PropertyDefinition)[],
): ExpressionOption {
  const returns = [
    ...new Set(definitions.map((definition) => definition.returns ?? "any")),
  ].join(" | ");
  const [first] = definitions;
  return kind === "method"
    ? {
        label: name,
        insert: `${name}()`,
        caret: name.length + 1,
        kind,
        type: signature(name, {
          parameters: [],
          ...(definitions as FunctionDefinition[]).find(takesArguments),
          returns: returns as FunctionDefinition["returns"],
        }),
        note: first!.description,
      }
    : {
        label: name,
        insert: name,
        kind,
        type: returns,
        note: first!.description,
      };
}

const takesArguments = (definition: FunctionDefinition) =>
  definition.parameters.length > 0 ||
  (definition.optional?.length ?? 0) > 0 ||
  definition.rest !== undefined;

/**
 * What a `.` after `receiver` offers: a record's members, then the
 * properties and the methods of its type, or of every type where the type
 * is not known, as the planner's own candidate list does.
 */
function memberEntries(
  receiver: ExpressionReceiver | undefined,
): ExpressionOption[] {
  const type = receiver?.type;
  const applies = (of: FilterValueType | "any") =>
    type === undefined || of === type || of === "any";
  const members = (
    kind: "method" | "property",
    byName: ReadonlyMap<
      string,
      readonly (readonly [
        FilterValueType | "any",
        string,
        FunctionDefinition | PropertyDefinition,
      ])[]
    >,
  ) =>
    [...byName].flatMap(([name, entries]) => {
      const fitting = entries.filter(([of]) =>
        kind === "property" ? type === undefined || of === type : applies(of),
      );
      return fitting.length === 0
        ? []
        : [
            memberOption(
              kind,
              name,
              fitting.map(([, , d]) => d),
            ),
          ];
    });
  return [
    ...(receiver?.members ?? []).map(
      ({ path, label, type }): ExpressionOption => ({
        label: path,
        insert: path,
        kind: "field",
        ...(type === undefined ? {} : { type }),
        ...noteOf(path, label),
      }),
    ),
    ...members("property", PROPERTIES_BY_NAME),
    ...members("method", METHODS_BY_NAME),
  ];
}

/** The `.` access whose member name the caret is on, or right after its dot. */
function memberAccessAt(
  inner: SyntaxNode,
  pos: number,
  source: string,
): { receiver: SyntaxNode; from: number; to: number } | null {
  for (let node: SyntaxNode | null = inner; node; node = node.parent) {
    if (node.name !== "ObjectAccess") continue;
    const dot = node.getChild(".");
    const receiver = node.firstChild;
    if (!dot || !receiver || dot.to > pos) return null;
    const name = node.getChild("PropertyName");
    if (name) {
      return name.from <= pos && pos <= name.to
        ? { receiver, from: name.from, to: name.to }
        : null;
    }
    return source.slice(dot.to, pos).trim() === ""
      ? { receiver, from: pos, to: pos }
      : null;
  }
  return null;
}

/**
 * The key of a bracket access the caret is in or right after the `[` of:
 * the path before the `[`, the range the quoted key fills, what is typed of
 * it, and whether the `]` is still to write.
 */
function bracketKeyAt(
  inner: SyntaxNode,
  pos: number,
  source: string,
): {
  path: string;
  from: number;
  to: number;
  query: string;
  closed: boolean;
} | null {
  for (let node: SyntaxNode | null = inner; node; node = node.parent) {
    if (node.name !== "ArrayAccess") continue;
    const open = node.getChild("[");
    const close = node.getChild("]");
    const object = node.firstChild;
    if (!open || !object || open.to > pos || (close && close.from < pos))
      return null;
    const path = source.slice(object.from, object.to).replaceAll(/\s+/g, "");
    const key = open.nextSibling;
    if (key?.name === "String" && key.from < pos) {
      const quote = source[key.from]!;
      const quoted = key.to - key.from > 1 && source[key.to - 1] === quote;
      return {
        path,
        from: key.from,
        to: quoted && pos < key.to ? key.to : Math.max(pos, key.to),
        query: source.slice(key.from + 1, Math.min(pos, key.to)),
        closed: close !== null,
      };
    }
    return source.slice(open.to, pos).trim() === ""
      ? {
          path,
          from: pos,
          to: pos,
          query: "",
          closed: close !== null,
        }
      : null;
  }
  return null;
}

/** The entries matching `query`, best first, ties in the order given. */
function ranked(
  entries: readonly ExpressionOption[],
  query: string,
): ExpressionOption[] {
  return entries
    .map((option, order) => ({
      option,
      order,
      score: query
        ? Math.min(
            matchScore(option.label, query),
            (option.kind !== "field" && option.kind !== "namespace") ||
              option.note === undefined
              ? Infinity
              : matchScore(option.note, query),
          )
        : 0,
    }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .map(({ option }) => option);
}

/**
 * What the list offers with the caret at `pos` of `source`: fields,
 * namespaces and functions at an expression position, matched by the name
 * or the label against the typed word or namespace path; after the `.` of a
 * value, its members. `null` where the caret stands in a literal, or on no
 * typed word unless `explicit` or after a `.`.
 */
export function expressionCompletions(
  source: string,
  pos: number,
  {
    vocabulary,
    explicit = false,
  }: { vocabulary: ExpressionVocabulary; explicit?: boolean },
): ExpressionCompletionResult | null {
  const inner = parser.parse(source).resolveInner(pos, -1);
  const key = bracketKeyAt(inner, pos, source);
  // Another bracket access takes an expression.
  const names =
    key?.path === "vault"
      ? vocabulary.vault?.map(({ name }) => name)
      : key && key.path === vocabulary.custom?.path
        ? vocabulary.custom.names
        : undefined;
  if (key && names) {
    const options = names
      .map((name, order) => ({
        name,
        order,
        score: key.query ? matchScore(name, key.query) : 0,
      }))
      .filter(({ score }) => Number.isFinite(score))
      .sort((a, b) => a.score - b.score || a.order - b.order)
      .map(({ name }): ExpressionOption => {
        const quoted = JSON.stringify(name);
        return {
          label: quoted,
          insert: key.closed ? quoted : `${quoted}]`,
          kind: "key",
        };
      });
    return options.length === 0
      ? null
      : { from: key.from, to: key.to, options };
  }
  for (let node: SyntaxNode | null = inner; node; node = node.parent)
    if (LITERALS.has(node.name)) return null;
  const access = memberAccessAt(inner, pos, source);
  const { receiver } = access ?? {};
  if (
    access &&
    receiver &&
    !(
      receiver.name === "Identifier" &&
      NAMESPACES.has(source.slice(receiver.from, receiver.to))
    )
  ) {
    const options = ranked(
      memberEntries(
        vocabulary.receiver?.(source, {
          from: receiver.from,
          to: receiver.to,
        }),
      ),
      source.slice(access.from, pos),
    );
    return options.length === 0
      ? null
      : { from: access.from, to: access.to, options };
  }
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
  }
  const bound = query.includes(".") ? [] : boundNamesAt(inner, pos, source);
  // The list opens at the start of an element expression to name what the
  // method binds.
  if (query === "" && !explicit && bound.length === 0) return null;
  const options = ranked(
    [
      ...bound.map(
        (name): ExpressionOption => ({
          label: name,
          insert: name,
          kind: "variable",
        }),
      ),
      ...entries(vocabulary),
    ],
    query,
  );
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
          // The caret now stands where the method binds its names.
          if (option.kind === "method" && bindsNames(option.label))
            startCompletion(view);
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
  presentation: CompletionPresentation = {},
): Extension {
  return autocompletion({
    override: [(context) => completionAt(context, read)],
    icons: false,
    ...presentation,
  });
}
