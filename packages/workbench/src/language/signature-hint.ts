// The Signature Hint of a Filter Expression editor: while the caret is inside
// a call's arguments, the callee's signature with the parameter at the caret
// marked and its description beneath. The registry of `@zotlit/item-query`
// is the one source of the signatures, so the hint names what evaluation
// checks.
import { StateEffect, StateField } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView, showTooltip } from "@codemirror/view";
import type { Tooltip } from "@codemirror/view";
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
 * The public theme hook of the Signature Hint tooltip. A host styles it; the
 * web host leaves CodeMirror's own tooltip look.
 */
export const SIGNATURE_HINT_CLASS = "zt-signature-hint";

/** Whether the editor has focus: the hint shows only while it does. */
const focused = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => {
    for (const effect of tr.effects)
      if (effect.is(setFocused)) return effect.value;
    return value;
  },
});

const setFocused = StateEffect.define<boolean>();

/** Appends `text` with each `code` span in backticks as a `<code>`. */
function appendProse(parent: HTMLElement, text: string) {
  const doc = parent.ownerDocument;
  text.split("`").forEach((part, at) => {
    if (part === "") return;
    if (at % 2 === 0) parent.append(part);
    else parent.appendChild(doc.createElement("code")).textContent = part;
  });
}

const parameterText = ({ name, type, optional, rest }: HintParameter) =>
  `${rest ? "..." : ""}${name}${optional && !rest ? "?" : ""}: ${type}`;

function renderHint(
  doc: Document,
  callee: string,
  signatures: readonly HintSignature[],
): HTMLElement {
  const dom = doc.createElement("div");
  dom.className = SIGNATURE_HINT_CLASS;
  for (const { parameters, active, returns, description } of signatures) {
    const block = dom.appendChild(doc.createElement("div"));
    const label = block.appendChild(doc.createElement("code"));
    label.append(`${callee}(`);
    parameters.forEach((parameter, at) => {
      if (at > 0) label.append(", ");
      const text = parameterText(parameter);
      if (at === active)
        label.appendChild(doc.createElement("mark")).textContent = text;
      else label.append(text);
    });
    label.append(returns ? `) → ${returns}` : ")");
    appendProse(block.appendChild(doc.createElement("div")), description);
  }
  return dom;
}

function hintTooltip(
  state: EditorState,
  options: SignatureHintOptions,
): Tooltip | null {
  const { main } = state.selection;
  if (!state.field(focused) || !main.empty) return null;
  const hint = signatureAt(state.doc.toString(), main.head, options);
  if (!hint) return null;
  return {
    pos: main.head,
    above: true,
    arrow: true,
    create: (view) => ({
      dom: renderHint(view.dom.ownerDocument, hint.callee, hint.signatures),
    }),
  };
}

/**
 * The Signature Hint of a Filter Expression editor: a tooltip above the
 * caret while it stands inside a call's arguments and the editor has focus.
 * It draws above the caret, so a completion list below the caret leaves it
 * in view.
 */
export function signatureHint(options: SignatureHintOptions = {}): Extension {
  const hint = StateField.define<Tooltip | null>({
    create: (state) => hintTooltip(state, options),
    update: (value, tr) =>
      tr.docChanged ||
      tr.selection ||
      tr.startState.field(focused) !== tr.state.field(focused)
        ? hintTooltip(tr.state, options)
        : value,
    provide: (field) => showTooltip.from(field),
  });
  return [
    focused,
    hint,
    EditorView.focusChangeEffect.of((_state, focus) => setFocused.of(focus)),
  ];
}

/**
 * The Signature Hint at `pos` in the Filter Expression `text`: the call whose
 * arguments hold `pos`, each definition its callee can name, and in each the
 * parameter the argument at `pos` fills. Null outside a call's arguments and
 * for a name the registry does not hold.
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
