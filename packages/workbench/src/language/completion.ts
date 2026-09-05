// The typing completion and hover a Template editor offers off the generated
// contract, over the same `suggestions()` the value-first field list resolves
// paths with.

import { autocompletion } from "@codemirror/autocomplete";
import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import { isolateHistory } from "@codemirror/commands";
import type { Extension } from "@codemirror/state";
import { hoverTooltip } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";

import { completionEdit, hoverHint, suggestions } from "./suggestions";
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

/**
 * Completion and hover over `read()`'s contract. Both answer from one
 * resolution, so what the popup offers and what the pointer explains cannot
 * disagree.
 */
export function templateCompletion(read: SuggestionSource): Extension {
  return [
    autocompletion({
      override: [(context) => completionAt(context, read)],
      icons: false,
    }),
    templateHover(read),
  ];
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

/** The hovered option as its own small box: what it is, then what it means. */
function explain(suggestion: Suggestion): { dom: HTMLElement } {
  const dom = document.createElement("div");
  dom.className = "cm-tooltip-template-hint";
  const heading = dom.appendChild(document.createElement("strong"));
  heading.textContent =
    suggestion.type === undefined
      ? suggestion.label
      : `${suggestion.label}: ${suggestion.type}`;
  const detail = dom.appendChild(document.createElement("div"));
  detail.textContent = suggestion.detail;
  if (suggestion.example !== undefined) {
    const example = dom.appendChild(document.createElement("code"));
    example.textContent = suggestion.example;
  }
  return { dom };
}

/** Hover explanations use the same contract and source scope as completion. */
export function templateHover(read: SuggestionSource): Extension {
  return hoverTooltip((view, position) => {
    const config = read(position);
    if (!config) return null;
    const hint = hoverHint(view.state.doc.toString(), position, config);
    const option = hint?.options[0];
    if (!hint || !option) return null;
    return { pos: hint.from, end: hint.to, create: () => explain(option) };
  });
}
