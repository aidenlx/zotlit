// The slice editor: a CodeMirror view over one region of the master document,
// with no history of its own. Modelled on Obsidian's Live Preview table cells.

import { defaultKeymap, isolateHistory } from "@codemirror/commands";
import {
  Annotation,
  EditorSelection,
  Prec,
  Transaction,
} from "@codemirror/state";
import type { ChangeSpec, Extension } from "@codemirror/state";
import { ViewPlugin, keymap } from "@codemirror/view";
import type { EditorView, PluginValue, ViewUpdate } from "@codemirror/view";

import { sliceEdit } from "./controller";
import type {
  WorkbenchDocumentController,
  WorkbenchSliceId,
  WorkbenchSliceRange,
} from "./controller";

/** Marks a child transaction as the master's own refresh, so it is not echoed back. */
const fromMaster = Annotation.define<boolean>();

/**
 * Binds one editor to `id`'s region of `controller`. Child edits are forwarded
 * to the master carrying their user event, so keystrokes group into one undo
 * step; master changes replace the child document wholesale.
 */
export function workbenchSlice(
  controller: WorkbenchDocumentController,
  id: WorkbenchSliceId,
): Extension {
  return [
    // Undo belongs to the master, which holds the only history, so this
    // binding has to beat every other undo binding in the host.
    Prec.highest(
      keymap.of([
        { key: "Mod-z", preventDefault: true, run: () => controller.undo() },
        {
          key: "Mod-y",
          mac: "Mod-Shift-z",
          preventDefault: true,
          run: () => controller.redo(),
        },
      ]),
    ),
    keymap.of(defaultKeymap),
    ViewPlugin.define((view) => new SliceSync(view, controller, id)),
  ];
}

class SliceSync implements PluginValue {
  #range: WorkbenchSliceRange;
  readonly #unsubscribe: () => void;
  readonly #unregister: () => void;

  constructor(
    readonly view: EditorView,
    readonly controller: WorkbenchDocumentController,
    readonly id: WorkbenchSliceId,
  ) {
    this.#range = controller.sliceRange(id);
    this.#unsubscribe = controller.subscribe((update) => {
      if (update.docChanged) this.#pull(update.transaction);
    });
    // While this editor holds the region's live text, a master edit inside it
    // is suppressed and handed back here instead.
    this.#unregister = controller.registerSlice(id, {
      replay: (changes, userEvent) => {
        this.view.dispatch({
          changes,
          ...(userEvent === undefined ? {} : { userEvent }),
        });
      },
    });
  }

  update(update: ViewUpdate): void {
    if (update.focusChanged) {
      this.controller.setFocusedSlice(update.view.hasFocus ? this.id : null);
    }
    for (const transaction of update.transactions) {
      if (!transaction.docChanged || transaction.annotation(fromMaster)) {
        continue;
      }
      this.#push(transaction);
    }
  }

  destroy(): void {
    this.#unregister();
    this.#unsubscribe();
    this.controller.setFocusedSlice(null);
  }

  /** Child to master: the same changes, offset into the slice's region. */
  #push(transaction: Transaction): void {
    const { from } = this.#range;
    const changes: ChangeSpec[] = [];
    // oxlint-disable-next-line max-params -- CM's iterChanges callback signature.
    transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      changes.push({
        from: from + fromA,
        to: from + toA,
        insert: inserted.toString(),
      });
    });

    const grown = transaction.newDoc.length - transaction.startState.doc.length;
    const head = Math.min(
      from + transaction.state.selection.main.head,
      this.controller.state.doc.length + grown,
    );
    const userEvent = transaction.annotation(Transaction.userEvent);
    const isolation = transaction.annotation(isolateHistory);
    this.controller.dispatch({
      changes,
      selection: EditorSelection.cursor(head),
      annotations: [
        sliceEdit.of(this.id),
        ...(isolation ? [isolateHistory.of(isolation)] : []),
      ],
      ...(userEvent === undefined ? {} : { userEvent }),
    });
  }

  /**
   * Master to child. The child document is replaced whole rather than patched,
   * which is what keeps an undo landing inside the slice — or one that moves
   * the slice's own boundaries — correct. A change this slice sent leaves the
   * two documents equal, so the echo stops here.
   */
  #pull(transaction: Transaction): void {
    const previous = this.#range;
    this.#range = this.controller.sliceRange(this.id);
    const text = this.controller.sliceText(this.id);
    if (text === this.view.state.doc.toString()) return;

    const head = transaction.changes.mapPos(
      previous.from + this.view.state.selection.main.head,
    );
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: text },
      selection: EditorSelection.cursor(
        Math.min(Math.max(head - this.#range.from, 0), text.length),
      ),
      annotations: fromMaster.of(true),
    });
    // Undo and redo reach the master from anywhere — a menu, another pane — so
    // the caret comes back to the text they just changed.
    if (transaction.isUserEvent("undo") || transaction.isUserEvent("redo")) {
      this.view.focus();
    }
  }
}
