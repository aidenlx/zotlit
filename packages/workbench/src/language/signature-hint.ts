// What the Signature Hint of a Filter Expression editor names: the call
// around the caret, the callee's signatures and the parameter at the caret.
// The registry of `@zotlit/item-query` is the one source of the signatures,
// so the hint names what evaluation checks. The tooltip is in
// `signature-hint-tooltip.ts`.
import type { SyntaxNode } from "@lezer/common";

import { parser } from "@zotlit/filter-expression";
import {
  GLOBAL_FUNCTIONS,
  IF_FUNCTION,
  METHOD_ENTRIES,
  parameterAt,
} from "@zotlit/item-query";
import type {
  FilterValueType,
  FunctionDefinition,
  FunctionParameter,
} from "@zotlit/item-query";

/** One parameter as the hint names it. */
export interface HintParameter {
  readonly name: string;
  /** The type it takes, each type of a union joined by ` | `. */
  readonly type: string;
  /** Whether a call can omit it. */
  readonly optional: boolean;
  /** Whether it takes every further argument. */
  readonly rest: boolean;
}

/** One definition the callee can name. */
export interface HintSignature {
  /** The value type a method belongs to, `any` for every type, else null. */
  readonly receiver: FilterValueType | "any" | null;
  readonly parameters: readonly HintParameter[];
  /** The index in `parameters` of the one at the caret, or -1 past the last. */
  readonly active: number;
  /** The type of the result, or null when it varies. */
  readonly returns: FilterValueType | null;
  readonly description: string;
}

export interface SignatureHintResult {
  readonly callee: string;
  /** One per definition; several when the receiver's type is not known. */
  readonly signatures: readonly HintSignature[];
}

export interface SignatureHintOptions {
  /**
   * The static type of a method call's receiver, given the receiver's text,
   * or undefined when it is not known. Without it, a method names every
   * definition of its name.
   */
  readonly receiverType?: (text: string) => FilterValueType | undefined;
}

type Definition = Pick<
  FunctionDefinition,
  "description" | "parameters" | "optional" | "rest"
> & { readonly returns?: FunctionDefinition["returns"] };

const typeText = ({ type }: FunctionParameter): string =>
  typeof type === "string" ? type : type.join(" | ");

function signature(
  receiver: HintSignature["receiver"],
  definition: Definition,
  argument: number,
): HintSignature {
  const at = parameterAt(definition, argument);
  const parameters = [
    ...definition.parameters.map((p) => ({ p, optional: false, rest: false })),
    ...(definition.optional ?? []).map((p) => ({
      p,
      optional: true,
      rest: false,
    })),
    ...(definition.rest
      ? [{ p: definition.rest, optional: true, rest: true }]
      : []),
  ];
  return {
    receiver,
    parameters: parameters.map(({ p, optional, rest }) => ({
      name: p.name,
      type: typeText(p),
      optional,
      rest,
    })),
    active: parameters.findIndex(({ p }) => p === at),
    returns: definition.returns ?? null,
    description: definition.description,
  };
}

/** The innermost call whose argument list holds `pos`. */
function callAround(inner: SyntaxNode, pos: number): SyntaxNode | null {
  for (let node: SyntaxNode | null = inner; node; node = node.parent) {
    if (node.name !== "Call") continue;
    const open = node.getChild("(");
    const close = node.getChild(")");
    if (open && open.to <= pos && (!close || pos <= close.from)) return node;
  }
  return null;
}

/**
 * The Signature Hint at a position of a Filter Expression.
 * @param text The Filter Expression.
 * @param pos The caret's offset in `text`.
 * @returns The call whose arguments hold `pos`, each definition its callee
 *   can name, and in each the parameter the argument at `pos` fills. Null
 *   outside a call's arguments and for a name the registry does not hold.
 */
export function signatureAt(
  text: string,
  pos: number,
  { receiverType }: SignatureHintOptions = {},
): SignatureHintResult | null {
  const tree = parser.parse(text);
  const call = callAround(tree.resolveInner(pos, -1), pos);
  if (!call) return null;
  let argument = 0;
  for (let child = call.firstChild; child; child = child.nextSibling)
    if (child.name === "," && child.to <= pos) argument++;
  const callee = call.firstChild!;
  if (callee.name === "Identifier") {
    const name = text.slice(callee.from, callee.to);
    const definition = name === "if" ? IF_FUNCTION : GLOBAL_FUNCTIONS.get(name);
    return definition
      ? { callee: name, signatures: [signature(null, definition, argument)] }
      : null;
  }
  if (callee.name !== "ObjectAccess") return null;
  const name = callee.getChild("PropertyName");
  const receiver = callee.firstChild;
  if (!name || !receiver) return null;
  const method = text.slice(name.from, name.to);
  const named = METHOD_ENTRIES.filter(([, entryName]) => entryName === method);
  const type = receiverType?.(text.slice(receiver.from, receiver.to));
  // A type's own method comes before the method of every value, as the
  // evaluator looks them up.
  const own =
    named.find(([of]) => of === type) ?? named.find(([of]) => of === "any");
  const chosen = type === undefined ? named : own ? [own] : [];
  if (chosen.length === 0) return null;
  return {
    callee: method,
    signatures: chosen.map(([of, , definition]) =>
      signature(of, definition, argument),
    ),
  };
}
