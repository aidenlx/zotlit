// Expression Completion after the `.` of a value: a record's members, then
// the properties and the methods of the receiver's type, as the planner of
// `@zotlit/item-query` types the receiver where it stands.
import type { SyntaxNode } from "@lezer/common";

import { METHOD_ENTRIES, PROPERTY_ENTRIES } from "@zotlit/item-query";
import type {
  FilterValueType,
  FunctionDefinition,
  PropertyDefinition,
} from "@zotlit/item-query";

import {
  fieldOption,
  optionTexts,
  ranked,
  signature,
  takesArguments,
} from "./expression-options";
import type {
  Caret,
  ExpressionCompletionResult,
  ExpressionOption,
  ExpressionReceiver,
  ExpressionVocabulary,
} from "./expression-options";

type Entry = readonly [
  FilterValueType | "any",
  string,
  FunctionDefinition | PropertyDefinition,
];

const METHODS_BY_NAME = Map.groupBy<string, Entry>(
  METHOD_ENTRIES,
  ([, name]) => name,
);
const PROPERTIES_BY_NAME = Map.groupBy<string, Entry>(
  PROPERTY_ENTRIES,
  ([, name]) => name,
);
const NAMESPACES = new Set(["this", "formula", "vault"]);

/** One entry per member name, from the definitions of it that apply. */
function memberOption(
  kind: "method" | "property",
  name: string,
  definitions: readonly (FunctionDefinition | PropertyDefinition)[],
): ExpressionOption {
  const returns = [
    ...new Set(definitions.map((definition) => definition.returns ?? "any")),
  ].join(" | ");
  const note = definitions[0]!.description;
  if (kind === "property")
    return { label: name, insert: name, kind, type: returns, note };
  return {
    label: name,
    insert: `${name}()`,
    caret: name.length + 1,
    kind,
    type: signature(name, {
      parameters: [],
      ...(definitions as FunctionDefinition[]).find(takesArguments),
      returns: returns as FunctionDefinition["returns"],
    }),
    note,
  };
}

/**
 * What a `.` after `receiver` offers. A property belongs to its own type and
 * a method also to every value; an unknown type offers every one, as the
 * planner's own candidate list does.
 */
function memberEntries(
  receiver: ExpressionReceiver | undefined,
): ExpressionOption[] {
  const type = receiver?.type;
  const fitting = (
    kind: "method" | "property",
    byName: ReadonlyMap<string, readonly Entry[]>,
  ) =>
    [...byName].flatMap(([name, entries]) => {
      const applying = entries.filter(
        ([of]) =>
          type === undefined ||
          of === type ||
          (kind === "method" && of === "any"),
      );
      return applying.length === 0
        ? []
        : [
            memberOption(
              kind,
              name,
              applying.map(([, , d]) => d),
            ),
          ];
    });
  return [
    ...(receiver?.members ?? []).map(fieldOption),
    ...fitting("property", PROPERTIES_BY_NAME),
    ...fitting("method", METHODS_BY_NAME),
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
    if (name)
      return name.from <= pos && pos <= name.to
        ? { receiver, from: name.from, to: name.to }
        : null;
    return source.slice(dot.to, pos).trim() === ""
      ? { receiver, from: pos, to: pos }
      : null;
  }
  return null;
}

/**
 * The namespace path the caret is in, `formula.<name>` or `this.<name>`,
 * read from the parse tree, so spaces may stand around its dot.
 */
export function namespaceAccessAt({ inner, pos, source }: Caret): {
  namespace: string;
  typed: string;
  from: number;
  to: number;
} | null {
  const access = memberAccessAt(inner, pos, source);
  if (!access) return null;
  const { receiver } = access;
  const namespace = source.slice(receiver.from, receiver.to);
  if (!isNamespace(receiver, namespace)) return null;
  return {
    namespace,
    typed: source.slice(access.from, pos),
    from: receiver.from,
    to: access.to,
  };
}

const isNamespace = (receiver: SyntaxNode, text: string) =>
  receiver.name === "Identifier" && NAMESPACES.has(text);

/**
 * The members offered with the caret after a `.` at `pos`.
 * @returns Undefined where the caret is not after the `.` of a value; a
 *   namespace path is the expression completion's.
 */
export function memberCompletions(
  { inner, pos, source }: Caret,
  vocabulary: ExpressionVocabulary,
): ExpressionCompletionResult | null | undefined {
  const access = memberAccessAt(inner, pos, source);
  if (!access) return undefined;
  const { receiver } = access;
  const text = source.slice(receiver.from, receiver.to);
  if (isNamespace(receiver, text)) return undefined;
  const options = ranked(
    memberEntries(
      vocabulary.receiver?.(source, { from: receiver.from, to: receiver.to }),
    ),
    source.slice(access.from, pos),
    optionTexts,
  );
  return options.length === 0
    ? null
    : { from: access.from, to: access.to, options };
}
