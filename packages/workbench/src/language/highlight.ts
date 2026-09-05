// Semantic token classes let each editor host supply its own theme.
import { syntaxHighlighting } from "@codemirror/language";
import { classHighlighter } from "@lezer/highlight";

export const templateHighlighting = syntaxHighlighting(classHighlighter);
