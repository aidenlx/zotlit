// The Signature Hint tooltip of a Filter Expression editor: above the caret
// while it stands inside a call's arguments, the signature with the
// parameter at the caret marked and the description beneath.
import { StateEffect, StateField } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { showTooltip } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import type { Tooltip, ViewUpdate } from "@codemirror/view";

import { fieldPopup } from "./field-popup";
import { appendProse } from "./prose";
import { signatureAt } from "./signature-hint";
import type { HintSignature, SignatureHintOptions } from "./signature-hint";

/**
 * The public theme hook of the Signature Hint tooltip. A host styles it; the
 * web host leaves CodeMirror's own tooltip look.
 */
export const SIGNATURE_HINT_CLASS = "zt-signature-hint";

/** Closes the hint until the text or the caret changes. */
const dismiss = StateEffect.define<null>();

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
      const { text } = parameter;
      if (at === active)
        label.appendChild(doc.createElement("mark")).textContent = text;
      else label.append(text);
    });
    label.append(`) → ${returns}`);
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
  const hint = StateField.define<Tooltip | null>({
    create: (state) => hintTooltip(state, options),
    update: (value, tr) =>
      tr.effects.some((effect) => effect.is(dismiss))
        ? null
        : tr.docChanged || tr.selection
          ? hintTooltip(tr.state, options)
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
