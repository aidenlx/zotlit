// The Signature Hint tooltip of a Filter Expression editor: above the caret
// while it stands inside a call's arguments, the signature with the
// parameter at the caret marked and the description beneath.
import { StateField } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { showTooltip } from "@codemirror/view";
import type { EditorView, Tooltip, ViewUpdate } from "@codemirror/view";

import { signatureAt } from "./signature-hint";
import type {
  HintParameter,
  HintSignature,
  SignatureHintOptions,
} from "./signature-hint";

/**
 * The public theme hook of the Signature Hint tooltip. A host styles it; the
 * web host leaves CodeMirror's own tooltip look.
 */
export const SIGNATURE_HINT_CLASS = "zt-signature-hint";

/** Appends `text` with each span in backticks as a `<code>`. */
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
  if (!main.empty) return null;
  const hint = signatureAt(state.doc.toString(), main.head, options);
  if (!hint) return null;
  return {
    pos: main.head,
    above: true,
    arrow: true,
    create: (view) => {
      const dom = renderHint(
        view.dom.ownerDocument,
        hint.callee,
        hint.signatures,
      );
      // The hint shows while the editor has focus, as CodeMirror tells it.
      const show = (shown: EditorView) => {
        dom.hidden = !shown.hasFocus;
      };
      return {
        dom,
        mount: show,
        update: (update: ViewUpdate) => {
          if (update.focusChanged) show(update.view);
        },
      };
    },
  };
}

/**
 * The Signature Hint of a Filter Expression editor. It draws above the
 * caret, so a completion list below the caret leaves it in view.
 * @param options How the hint types a method call's receiver.
 * @returns The editor extension.
 */
export function signatureHint(options: SignatureHintOptions = {}): Extension {
  return StateField.define<Tooltip | null>({
    create: (state) => hintTooltip(state, options),
    update: (value, tr) =>
      tr.docChanged || tr.selection ? hintTooltip(tr.state, options) : value,
    provide: (field) => showTooltip.from(field),
  });
}
