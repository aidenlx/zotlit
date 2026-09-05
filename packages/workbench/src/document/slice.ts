// The slice editor: a CodeMirror view over one region of the master document,
// with no history of its own. Modelled on Obsidian's Live Preview table cells.

import { defaultKeymap, isolateHistory } from "@codemirror/commands";
import {
  Annotation,
  EditorSelection,
  ChangeSet,
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
import { jsonLayout, jsonPosition, jsonSliceEdit } from "./json-source";

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
  json = false,
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
    ViewPlugin.define((view) => new SliceSync(view, controller, { id, json })),
  ];
}

class SliceSync implements PluginValue {
  #range: WorkbenchSliceRange;
  #pushing = false;
  readonly id: WorkbenchSliceId;
  readonly json: boolean;
  readonly #unsubscribe: () => void;
  readonly #unregister: () => void;

  constructor(
    readonly view: EditorView,
    readonly controller: WorkbenchDocumentController,
    { id, json }: { id: WorkbenchSliceId; json: boolean },
  ) {
    this.id = id;
    this.json = json;
    this.#range = controller.sliceRange(id);
    this.#unsubscribe = controller.subscribe((update) => {
      if (
        update.docChanged ||
        update.transaction.effects.some((effect) => effect.is(jsonSliceEdit))
      )
        this.#pull(update.transaction);
    });
    // While this editor holds the region's live text, a master edit inside it
    // is suppressed and handed back here instead.
    this.#unregister = controller.registerSlice(id, {
      replay: (changes, userEvent) => {
        const mapped: ChangeSpec[] = [];
        const source = controller.sliceText(id);
        if (json) {
          ChangeSet.of(changes, source.length).iterChanges(
            // oxlint-disable-next-line max-params -- CM's iterChanges callback signature.
            (from, to, _fromB, _toB, inserted) => {
              mapped.push({
                from: jsonPosition(
                  source,
                  this.view.state.doc.toString(),
                  from,
                ),
                to: jsonPosition(source, this.view.state.doc.toString(), to),
                insert: inserted.toString(),
              });
            },
          );
        }
        this.view.dispatch({
          changes: json ? mapped : changes,
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

  /** Forward edits in source coordinates; JSON layout stays in the child. */
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

    let head = transaction.state.selection.main.head;
    const effects = [];
    let grown = transaction.newDoc.length - transaction.startState.doc.length;
    if (this.json) {
      const source = this.controller.sliceText(this.id);
      const display = transaction.newDoc.toString();
      const compact = jsonLayout(display, false);
      let left = 0;
      while (
        left < source.length &&
        left < compact.text.length &&
        source[left] === compact.text[left]
      )
        left++;
      let right = source.length;
      let end = compact.text.length;
      while (
        right > left &&
        end > left &&
        source[right - 1] === compact.text[end - 1]
      ) {
        right--;
        end--;
      }
      changes.length = 0;
      if (left !== right || left !== end)
        changes.push({
          from: from + left,
          to: from + right,
          insert: compact.text.slice(left, end),
        });
      effects.push(
        jsonSliceEdit.of({
          id: this.id,
          before: {
            text: transaction.startState.doc.toString(),
            head: transaction.startState.selection.main.head,
          },
          after: { text: display, head },
        }),
      );
      head = compact.changes.mapPos(head, 1);
      grown = compact.text.length - source.length;
    }
    head = Math.min(from + head, this.controller.state.doc.length + grown);
    const userEvent = transaction.annotation(Transaction.userEvent);
    const isolation = transaction.annotation(isolateHistory);
    this.#pushing = true;
    try {
      this.controller.dispatch({
        changes,
        effects,
        selection: EditorSelection.cursor(head),
        annotations: [
          sliceEdit.of(this.id),
          ...(isolation ? [isolateHistory.of(isolation)] : []),
        ],
        ...(userEvent === undefined ? {} : { userEvent }),
      });
    } finally {
      this.#pushing = false;
    }
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
    if (this.json && this.#pushing) return;
    const source = this.controller.sliceText(this.id);
    const draft = this.json
      ? transaction.effects.findLast(
          (effect) => effect.is(jsonSliceEdit) && effect.value.id === this.id,
        )?.value.after
      : undefined;
    const text =
      draft?.text ?? (this.json ? jsonLayout(source, true).text : source);
    if (text === this.view.state.doc.toString() && !draft) return;
    const oldHead = this.json
      ? jsonPosition(
          this.view.state.doc.toString(),
          transaction.startState.sliceDoc(previous.from, previous.to),
          this.view.state.selection.main.head,
        )
      : this.view.state.selection.main.head;
    const masterHead = Math.min(
      Math.max(
        transaction.changes.mapPos(previous.from + oldHead) - this.#range.from,
        0,
      ),
      source.length,
    );
    const head =
      draft?.head ??
      (this.json ? jsonPosition(source, text, masterHead) : masterHead);
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: text },
      selection: EditorSelection.cursor(
        Math.min(Math.max(head, 0), text.length),
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
