import { EditorView } from "@codemirror/view";

// Editor token colors use the same palette as the Workbench chrome.
import { templateHighlighting } from "@zotlit/workbench/language";

export const editorTheme = [
  templateHighlighting,
  EditorView.theme({
    ".tok-keyword, .tok-functionName, .tok-operator, .zt-liquid-delimiter, .zt-eta-delimiter":
      {
        color: "var(--color-fd-primary)",
      },
    ".tok-string, .tok-number, .tok-bool": {
      color: "var(--color-fd-muted-foreground)",
    },
    ".tok-variableName, .tok-propertyName": {
      color: "var(--color-fd-foreground)",
    },
    ".tok-comment": {
      color: "var(--color-fd-muted-foreground)",
      fontStyle: "italic",
    },
    ".tok-heading": { fontWeight: "600", color: "var(--color-fd-primary)" },
    ".tok-strong": { fontWeight: "600" },
    ".tok-emphasis": { fontStyle: "italic" },
    ".tok-link, .tok-url": { textDecoration: "underline" },
  }),
];
