// The typing completion and hover a Template editor offers off the generated
// contract, over the same `suggestions()` the value-first field list resolves
// paths with.

import { autocompletion } from "@codemirror/autocomplete";
import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { hoverTooltip } from "@codemirror/view";

import { hoverHint, suggestions } from "./suggestions";
import type { Suggestion, SuggestionConfig } from "./suggestions";

/**
 * The contract one pane completes against right now: its root, the partials the
 * host has registered, and the Item the values come from. It is read per
 * keystroke, so a pane that follows the caret into another root needs no new
 * editor.
 */
export type SuggestionSource = () => SuggestionConfig | null;

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
    hoverTooltip((view, position) => {
      const config = read();
      if (!config) return null;
      const hint = hoverHint(view.state.doc.toString(), position, config);
      const option = hint?.options[0];
      if (!hint || !option) return null;
      return { pos: hint.from, end: hint.to, create: () => explain(option) };
    }),
  ];
}

function completionAt(
  context: CompletionContext,
  read: SuggestionSource,
): CompletionResult | null {
  const config = read();
  if (!config) return null;
  const result = suggestions(context.state.doc.toString(), context.pos, config);
  if (!result || result.options.length === 0) return null;
  return {
    from: result.from,
    to: result.to,
    options: result.options.map(option),
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
