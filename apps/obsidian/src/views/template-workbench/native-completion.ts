// The typing popup of every editor the plugin hosts, Template Completion and
// Expression Completion alike, in Obsidian's own suggestion skin.
import type { CompletionPresentation } from "@zotlit/workbench/language";

/** One entry of CodeMirror's list, as the presentation receives it. */
type Completion = Parameters<
  NonNullable<CompletionPresentation["optionClass"]>
>[0];

/** The cells a row adds under its label. */
export interface CompletionCells {
  /** A type or a call signature, on a line of its own. */
  readonly type?: string;
  /** A description, as Obsidian's suggestion note. */
  readonly note?: string;
}

/**
 * The popup wears Obsidian's own suggestion classes, the way Obsidian skins
 * CodeMirror's completion for a Bases formula. Types get their own line so
 * unions and function signatures keep the same reading order.
 * @param cells The cells of one row, from the entry its completion was made
 *   from.
 */
export function nativeCompletion(
  cells: (completion: Completion) => CompletionCells | undefined,
): CompletionPresentation {
  return {
    tooltipClass: () => "suggestion-container zt-template-completion",
    optionClass: () => "suggestion-item mod-complex",
    addToOptions: [
      {
        position: 60,
        render(completion) {
          const type = cells(completion)?.type;
          if (!type) return null;
          return createDiv({ cls: "zt-template-completion-type", text: type });
        },
      },
      {
        position: 70,
        render(completion) {
          const note = cells(completion)?.note;
          return note
            ? createDiv({ cls: "suggestion-note", text: note })
            : null;
        },
      },
    ],
  };
}
