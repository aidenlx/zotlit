// CodeMirror completion adapter over the shared Template field resolver.

import { autocompletion } from "@codemirror/autocomplete";
import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import { isolateHistory } from "@codemirror/commands";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { regex } from "arkregex";

import { pairingContext } from "./pairing-context";
import { expressionBrackets, addPair, pairingState } from "./pairing-state";
import { completionEdit, suggestions } from "./suggestions";
import type {
  CompletionEdit,
  Suggestion,
  SuggestionConfig,
  SuggestionResult,
} from "./suggestions";

/** Apply one shared edit through CodeMirror and isolate it in the document history. */
export function applyTemplateCompletion(
  view: EditorView,
  result: SuggestionResult,
  option: Suggestion,
): boolean {
  const edit = completionEdit(view.state.doc.toString(), result, option);
  const effects = snippetPairs(edit, result, option);
  const previous = view.state
    .field(pairingState, false)
    ?.find((pair) => pair.from === result.range.from);
  const close = previous?.close ?? (result.language === "eta" ? "%>" : "}}");
  if (
    !result.expression &&
    result.range.kind === "output" &&
    edit.insert.endsWith(close) &&
    (!result.range.closed || previous)
  ) {
    const from = result.range.from;
    const closeFrom = edit.from + edit.insert.length - close.length;
    const source = view.state.doc.toString();
    let openTo = from + 2;
    if (source[openTo] === "-" || source[openTo] === "_") openTo++;
    if (
      result.language === "eta" &&
      (source[openTo] === "=" || source[openTo] === "~")
    )
      openTo++;
    effects.push(
      addPair.of({
        from,
        open: source.slice(from, openTo),
        closeFrom,
        close,
        padding: edit.insert.at(-3) === " " ? closeFrom - 1 : undefined,
      }),
    );
  }
  view.dispatch({
    effects,
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    selection: { anchor: edit.anchor },
    annotations: isolateHistory.of("full"),
    userEvent: "input.complete",
  });
  return edit.continue;
}

/**
 * The contract one pane completes against right now: its root, the partials the
 * host has registered, and the Item the values come from. It is read per
 * keystroke, so a pane that follows the caret into another root needs no new
 * editor.
 */
export type SuggestionSource = (position: number) => SuggestionConfig | null;

/** CodeMirror completion over the pane's current contract and source scope. */
export function templateCompletion(read: SuggestionSource): Extension {
  return autocompletion({
    override: [(context) => completionAt(context, read)],
    icons: false,
  });
}

function completionAt(
  context: CompletionContext,
  read: SuggestionSource,
): CompletionResult | null {
  const config = read(context.pos);
  if (!config) return null;
  const result = suggestions(context.state.doc.toString(), context.pos, config);
  if (!result || result.options.length === 0) return null;
  return {
    from: result.from,
    to: result.to,
    options: result.options.map((suggestion) => ({
      ...option(suggestion),
      apply: (view) => {
        applyTemplateCompletion(view, result, suggestion);
      },
    })),
    filter: false,
  };
}

function option(suggestion: Suggestion): Completion {
  return {
    label: suggestion.label,
    apply: suggestion.insert,
    type: suggestion.category,
    ...(suggestion.type === undefined ? {} : { detail: suggestion.type }),
    info: suggestion.syntax
      ? [suggestion.detail, suggestion.syntax, suggestion.example]
          .filter(Boolean)
          .join("\n\n")
      : suggestion.detail,
  };
}

/** Snippets supply new syntax; partial names and field replacements supply text. */
function snippetPairs(
  edit: CompletionEdit,
  result: SuggestionResult,
  option: Suggestion,
) {
  const effects = [];
  if (option.from === result.range.from) {
    const delimiters = regex(
      "(?<open>\\{[{%]-?|<%[-_]?[=~]?)(?<body>[\\s\\S]*?)(?<close>-?%}|-?}}|[-_]?%>)",
      "g",
    );
    let match;
    while ((match = delimiters.exec(edit.insert))) {
      const from = edit.from + match.index;
      const { open, body, close } = match.groups;
      const closeFrom = from + open.length + body.length;
      effects.push(
        addPair.of({
          from,
          open,
          closeFrom,
          close,
          padding: body.endsWith(" ") ? closeFrom - 1 : undefined,
        }),
      );
    }
  }
  if (option.category === "loop" || option.category === "annotation-helper") {
    const source = result.expression
      ? edit.insert
      : option.category === "annotation-helper"
        ? `<% ${edit.insert}`
        : edit.insert;
    const prefix = source.length - edit.insert.length;
    const stack: { from: number; open: string; close: string }[] = [];

    for (let index = 0; index < edit.insert.length; index++) {
      const char = edit.insert[index]!;
      if (
        pairingContext(source, index + prefix, {
          language: result.language,
          mode: result.expression ? "expression" : undefined,
        }) !== "code"
      )
        continue;
      if (
        effects.some(
          ({ value: pair }) =>
            (index + edit.from >= pair.from &&
              index + edit.from < pair.from + pair.open.length) ||
            (index + edit.from >= pair.closeFrom &&
              index + edit.from < pair.closeFrom + pair.close.length),
        )
      )
        continue;
      const close = expressionBrackets[char];
      if (char === "'" || char === '"') {
        const from = index;
        while (++index < edit.insert.length) {
          if (edit.insert[index] === "\\") index++;
          else if (edit.insert[index] === char) break;
        }
        if (index < edit.insert.length)
          effects.push(
            addPair.of({
              from: edit.from + from,
              open: char,
              closeFrom: edit.from + index,
              close: char,
            }),
          );
      } else if (close)
        stack.push({ from: edit.from + index, open: char, close });
      else if (stack.at(-1)?.close === char) {
        effects.push(
          addPair.of({ ...stack.pop()!, closeFrom: edit.from + index }),
        );
      }
    }
  }
  return effects;
}
