// The web's look for Expression Completion in a Match condition: CodeMirror's
// own list, drawn as the site's popovers and the template completion rows.
import { EditorView } from "@codemirror/view";

import { expressionOption } from "@zotlit/workbench/language";
import type { CompletionPresentation } from "@zotlit/workbench/language";

function cell(className: string, text: string | undefined) {
  if (!text) return null;
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

export const webExpressionCompletion: CompletionPresentation = {
  tooltipClass: () =>
    "overflow-hidden rounded-md border border-fd-border bg-fd-popover p-1 text-fd-popover-foreground shadow-md",
  optionClass: () =>
    "flex min-h-8 cursor-default flex-col gap-0.5 rounded-sm px-2 py-1.5 text-xs",
  addToOptions: [
    {
      position: 60,
      render: (completion) =>
        cell(
          "font-mono text-xs text-fd-muted-foreground",
          expressionOption(completion)?.type,
        ),
    },
    {
      position: 70,
      render: (completion) =>
        cell(
          "whitespace-normal text-fd-muted-foreground",
          expressionOption(completion)?.note,
        ),
    },
  ],
};

/**
 * CodeMirror's base theme is unlayered CSS, so it outranks the classes above
 * on the list's box and its highlighted row.
 */
export const webExpressionList = EditorView.theme({
  ".cm-tooltip.cm-tooltip-autocomplete": {
    border: "1px solid var(--color-fd-border)",
    backgroundColor: "var(--color-fd-popover)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "inherit",
    maxHeight: "18rem",
    maxWidth: "min(28rem, calc(100vw - 2rem))",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    padding: "0.375rem 0.5rem",
    whiteSpace: "normal",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--color-fd-accent)",
    color: "var(--color-fd-accent-foreground)",
  },
  ".cm-completionLabel": { fontWeight: "500" },
});
