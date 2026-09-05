// Template delimiter and expression bracket input shared by editor hosts.
import { EditorSelection, Prec } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

import { pairingContext } from "./pairing-context";
import {
  expressionBrackets,
  addPair,
  pairingState,
  pairingHistory,
} from "./pairing-state";
import type { SuggestionConfig } from "./suggestions";

export type PairingSource = (
  position: number,
) => Pick<SuggestionConfig, "language" | "mode" | "scope"> | null;

export function templatePairing(read: PairingSource = () => ({})): Extension {
  return [
    pairingState,
    pairingHistory,
    Prec.highest([
      // oxlint-disable-next-line max-params -- CodeMirror inputHandler signature.
      EditorView.inputHandler.of((view, from, to, text) => {
        const config = read(from);
        if (
          !config ||
          from !== to ||
          text.length !== 1 ||
          view.state.selection.ranges.length !== 1 ||
          view.state.readOnly ||
          view.compositionStarted
        )
          return false;
        const pair = view.state
          .field(pairingState)
          .find(
            (entry) =>
              (from >= entry.closeFrom &&
                from < entry.closeFrom + entry.close.length) ||
              from === entry.padding,
          );
        const target = pair && from === pair.padding ? pair.closeFrom : from;
        if (
          pair &&
          from === pair.padding &&
          from === pair.from + pair.open.length + 1 &&
          view.state.sliceDoc(pair.from + pair.open.length, pair.closeFrom) ===
            "  "
        ) {
          const marker =
            (text === "-" && (pair.open === "{{" || pair.open === "{%")) ||
            ((text === "-" || text === "_") && pair.open === "<%");
          const prefix =
            (text === "=" || text === "~") &&
            ["<%", "<%-", "<%_"].includes(pair.open);
          if (marker || prefix) {
            const open = pair.open + text;
            view.dispatch({
              changes: { from: pair.from, to: from, insert: `${open} ` },
              selection: { anchor: from + 1 },
              effects: addPair.of({
                ...pair,
                open,
                closeFrom: pair.closeFrom + 1,
                padding: from + 1,
              }),
              userEvent: "input.type",
            });
            return true;
          }
        }
        const escapedQuote =
          (text === '"' || text === "'") &&
          /(?:^|[^\\])(?:\\\\)*\\$/.test(view.state.sliceDoc(0, from));
        if (
          pair &&
          !escapedQuote &&
          view.state.sliceDoc(target, target + 1) === text
        ) {
          view.dispatch({
            selection: EditorSelection.cursor(target + 1),
            userEvent: "input.pair-close",
          });
          return true;
        }
        const open = view.state.sliceDoc(Math.max(0, from - 1), from) + text;
        const close =
          config.language === "eta"
            ? open === "<%"
              ? "%>"
              : null
            : open === "{{"
              ? "}}"
              : open === "{%"
                ? "%}"
                : null;
        const source = view.state.doc.toString();
        if (
          close &&
          config.mode !== "expression" &&
          pairingContext(source, from - 1, config) === "text"
        ) {
          view.dispatch({
            changes: { from, to, insert: `${text}  ${close}` },
            selection: EditorSelection.cursor(from + 2),
            effects: addPair.of({
              from: from - 1,
              open,
              closeFrom: from + 3,
              close,
              padding: from + 2,
            }),
            userEvent: "input.type",
          });
          return true;
        }

        const closing = expressionBrackets[text];
        if (
          !closing ||
          pairingContext(source, from, config) !== "code" ||
          (source[from] && !/[\s\])}:;,>]/.test(source[from]))
        )
          return false;
        view.dispatch({
          changes: { from, to, insert: text + closing },
          selection: { anchor: from + 1 },
          effects: addPair.of({
            from,
            open: text,
            closeFrom: from + 1,
            close: closing,
          }),
          userEvent: "input.type",
        });
        return true;
      }),
      keymap.of([
        {
          key: "Backspace",
          run(view) {
            const { main, ranges } = view.state.selection;
            if (
              !main.empty ||
              ranges.length !== 1 ||
              view.state.readOnly ||
              !read(main.head) ||
              view.compositionStarted
            )
              return false;
            const pair = view.state
              .field(pairingState)
              .find((entry) =>
                entry.open.length === 1
                  ? main.head === entry.from + 1 &&
                    entry.closeFrom === main.head
                  : main.head === entry.from + entry.open.length + 1 &&
                    entry.padding === main.head &&
                    view.state.sliceDoc(
                      entry.from + entry.open.length,
                      entry.closeFrom,
                    ) === "  ",
              );
            if (!pair) return false;
            view.dispatch({
              changes: {
                from: pair.from,
                to: pair.closeFrom + pair.close.length,
              },
              selection: { anchor: pair.from },
              userEvent: "delete.backward",
            });
            return true;
          },
        },
      ]),
    ]),
  ];
}
