// Runs editor transactions without mounting CodeMirror's rendered view.
import { EditorState, Transaction } from "@codemirror/state";
import type { EditorStateConfig, TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";

export function stateEditor(config: EditorStateConfig): EditorView {
  let state = EditorState.create(config);
  let connected = true;
  const dom = {
    get isConnected() {
      return connected;
    },
    ownerDocument: document,
    remove() {
      connected = false;
    },
  };
  return {
    get state() {
      return state;
    },
    dom,
    posAtCoords: () => null,
    dispatch(input: Transaction | TransactionSpec) {
      const transaction =
        input instanceof Transaction ? input : state.update(input);
      state = transaction.state;
      for (const listener of state.facet(EditorView.updateListener))
        listener({ state } as ViewUpdate);
    },
    destroy() {
      connected = false;
    },
  } as unknown as EditorView;
}
