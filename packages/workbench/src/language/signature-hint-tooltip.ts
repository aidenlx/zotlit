// The Signature Hint tooltip of a Filter Expression editor: above the bracket
// of the call whose arguments hold the caret, the signature with the
// parameter at the caret marked and the description beneath. The hint stands
// still as the caret crosses the arguments: CodeMirror keeps one tooltip while
// its `create` stays the same, and only the mark changes.
import { StateEffect, StateField } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { showTooltip } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import type { Tooltip, TooltipView, ViewUpdate } from "@codemirror/view";

import { fieldPopup } from "./field-popup";
import { appendProse } from "./prose";
import { signatureAt } from "./signature-hint";
import type {
  HintSignature,
  SignatureHintOptions,
  SignatureHintResult,
} from "./signature-hint";

/**
 * The public theme hook of the Signature Hint tooltip. A host styles it; the
 * web host leaves CodeMirror's own tooltip look.
 */
export const SIGNATURE_HINT_CLASS = "zt-signature-hint";

/** Closes the hint until the text or the caret changes. */
const dismiss = StateEffect.define<null>();

/** The tooltip CodeMirror places, with the hint it shows. */
interface HintTooltip extends Tooltip {
  readonly hint: SignatureHintResult;
}

function renderSignature(
  doc: Document,
  callee: string,
  { parameters, active, returns, description }: HintSignature,
): HTMLElement {
  const block = doc.createElement("div");
  const label = block.appendChild(doc.createElement("code"));
  label.append(`${callee}(`);
  parameters.forEach((parameter, at) => {
    if (at > 0) label.append(", ");
    const { text } = parameter;
    if (at === active)
      label.appendChild(doc.createElement("mark")).textContent = text;
    else label.append(text);
  });
  label.append(`) → ${returns}`);
  appendProse(block.appendChild(doc.createElement("div")), description);
  return block;
}

/**
 * The Signature Hint of a Filter Expression editor. It draws above the
 * call's opening bracket, so a completion list below the caret leaves it in
 * view.
 * @param options How the hint types a method call's receiver.
 * @returns The editor extension.
 */
export function signatureHint(options: SignatureHintOptions = {}): Extension {
  const create = (view: EditorView): TooltipView => {
    const doc = view.dom.ownerDocument;
    const dom = doc.createElement("div");
    dom.className = SIGNATURE_HINT_CLASS;
    let blocks: readonly HTMLElement[] = [];
    const render = ({ callee, signatures }: SignatureHintResult) => {
      for (const block of blocks) block.remove();
      blocks = signatures.map((each) => renderSignature(doc, callee, each));
      // Before the arrow, which CodeMirror adds to the tooltip.
      dom.prepend(...blocks);
    };
    render(view.state.field(hint)!.hint);
    // The hint shows while the editor has focus, as CodeMirror tells it.
    const show = (shown: EditorView) => {
      dom.hidden = !shown.hasFocus;
    };
    return {
      dom,
      mount: show,
      update: (update: ViewUpdate) => {
        if (update.focusChanged) show(update.view);
        const current = update.state.field(hint);
        if (current && current !== update.startState.field(hint))
          render(current.hint);
      },
    };
  };
  const hintTooltip = (state: EditorState): HintTooltip | null => {
    const { main } = state.selection;
    if (!main.empty) return null;
    const found = signatureAt(state.doc.toString(), main.head, options);
    return (
      found && {
        pos: found.open,
        above: true,
        arrow: true,
        create,
        hint: found,
      }
    );
  };
  const hint = StateField.define<HintTooltip | null>({
    create: hintTooltip,
    update: (value, tr) =>
      tr.effects.some((effect) => effect.is(dismiss))
        ? null
        : tr.docChanged || tr.selection
          ? hintTooltip(tr.state)
          : value,
    provide: (field) => showTooltip.from(field),
  });
  return [
    hint,
    // Escape closes the hint; a completion list standing with it closes first.
    fieldPopup.of((view) =>
      view.state.field(hint)
        ? {
            close: (shown: EditorView) => {
              shown.dispatch({ effects: dismiss.of(null) });
              return true;
            },
          }
        : null,
    ),
  ];
}
