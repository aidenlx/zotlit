// Expression Completion for the Filter Expression language: what a Formula, a
// Query View filter condition or a Match condition offers at the caret. The
// fields, the namespaces and the functions come from the vocabulary the host
// passes and from the function registry of `@zotlit/item-query`, so the list
// cannot disagree with evaluation. Members after a `.` are in
// `expression-members.ts`, quoted keys in `expression-keys.ts`, and the names
// a list method binds in `list-scope.ts`.
import { autocompletion, startCompletion } from "@codemirror/autocomplete";
import type { Completion, CompletionContext } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

import {
  isIdentifierName,
  isMemberName,
  parser,
} from "@zotlit/filter-expression";
import { GLOBAL_FUNCTIONS, IF_FUNCTION } from "@zotlit/item-query";
import type { QueryDataset } from "@zotlit/item-query";

import type { CompletionPresentation } from "./completion";
import { keyCompletions } from "./expression-keys";
import { memberCompletions, namespaceAccessAt } from "./expression-members";
import {
  fieldOption,
  noteOf,
  optionTexts,
  ranked,
  signature,
} from "./expression-options";
import type {
  ExpressionCompletionResult,
  ExpressionField,
  ExpressionName,
  ExpressionOption,
  ExpressionVocabulary,
} from "./expression-options";
import { bindsNames, boundNameOptions } from "./list-scope";

export type {
  ExpressionCompletionResult,
  ExpressionField,
  ExpressionName,
  ExpressionOption,
  ExpressionReceiver,
  ExpressionVocabulary,
} from "./expression-options";

/** Tokens whose text a completion must not interrupt. */
const LITERALS = new Set(["String", "RegExp", "RealNumber", "Escape"]);

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
    insert: isMemberName(name) ? path : `${namespace}[${JSON.stringify(name)}]`,
    kind: "namespace",
    ...noteOf(path, label),
  };
}

/** Every entry of the vocabulary, in the order the list shows ties. */
function entries(vocabulary: ExpressionVocabulary): ExpressionOption[] {
  return [
    ...vocabulary.fields.map(fieldOption),
    ...vocabulary.context.map((name) => namespaced("this", { name })),
    ...vocabulary.formulas.map((formula) => namespaced("formula", formula)),
    ...(vocabulary.vault ?? []).map((name) => namespaced("vault", name)),
    ...FUNCTIONS,
  ];
}

/**
 * What the list offers with the caret at `pos` of `source`: quoted keys in
 * `vault[...]` and `custom[...]`; after the `.` of a value, its members;
 * elsewhere the names a list method binds there, fields, namespaces and
 * functions, matched by the name or the label against the typed word or
 * namespace path. `null` where the caret stands in a literal, or on no typed
 * word unless `explicit`, after a `.` or in an element expression.
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
  const caret = { inner, pos, source };
  const keys = keyCompletions(caret, vocabulary);
  if (keys !== undefined) return keys;
  for (let node: SyntaxNode | null = inner; node; node = node.parent)
    if (LITERALS.has(node.name)) return null;
  const members = memberCompletions(caret, vocabulary);
  if (members !== undefined) return members;
  const path = namespaceAccessAt(caret);
  if (path) {
    const prefix = `${path.namespace}.`;
    const options = ranked(
      entries(vocabulary).filter(
        (option) =>
          option.kind === "namespace" && option.label.startsWith(prefix),
      ),
      prefix + path.typed,
      optionTexts,
    );
    return options.length === 0
      ? null
      : { from: path.from, to: path.to, options };
  }
  // The word typed is the identifier the caret is in or at the end of.
  const word =
    inner.name === "Identifier" && inner.from < pos ? inner : undefined;
  const from = word?.from ?? pos;
  const to = word?.to ?? pos;
  const query = source.slice(from, pos);
  const bound = boundNameOptions(caret);
  if (query === "" && !explicit && bound.length === 0) return null;
  const options = ranked(
    [...bound, ...entries(vocabulary)],
    query,
    optionTexts,
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
      if (!isIdentifierName(path)) return [];
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
