import { EditorView } from "@codemirror/view";

// Editor token colors use the same palette as the Workbench chrome.
import { templateHighlighting } from "@zotlit/workbench/language";

export const editorTheme = [
  templateHighlighting,
  EditorView.theme({
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
      fontSize: "1rem",
      lineHeight: "1.5",
    },
    "@media (min-width: 40rem)": {
      ".cm-scroller": { fontSize: "0.875rem" },
    },
    // The pane host draws the focus ring, so the editor's own stays off.
    "&.cm-focused": { outline: "none" },
    ".zt-template-delimiter, .zt-template-keyword, .zt-template-filter, .zt-template-operator":
      {
        color: "var(--color-fd-primary)",
      },
    ".zt-template-string, .zt-template-value": {
      color: "var(--color-fd-muted-foreground)",
    },
    ".zt-template-variable, .zt-template-property": {
      color: "var(--color-fd-foreground)",
    },
    ".zt-template-comment": {
      color: "var(--color-fd-muted-foreground)",
      fontStyle: "italic",
    },
  }),
];
