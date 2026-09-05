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

import { completionEdit, suggestions } from "./suggestions";
import type {
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
  view.dispatch({
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
    info: suggestion.detail,
  };
}
