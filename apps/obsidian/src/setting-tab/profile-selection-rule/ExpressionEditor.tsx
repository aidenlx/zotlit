// The expression surface: a CodeMirror editor over the Filter Expression,
// dressed as Obsidian's own formula editor (the Bases filter and formula
// inputs). CodeMirror comes from Obsidian's bundle — every `@codemirror/*`
// import is external — and `@uiw/react-codemirror` is the React binding
// over it.
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import {
  Decoration,
  EditorView,
  keymap,
  MatchDecorator,
  ViewPlugin,
} from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";

import {
  HAS_TAG_FUNCTION,
  IN_COLLECTION_DIRECTLY_FUNCTION,
  IN_COLLECTION_FUNCTION,
  ITEM_TYPE_FIELD,
} from "@/services/profile-selection/condition";

/**
 * The contract's vocabulary, coloured with the token classes Obsidian's
 * editor theme already styles (`.cm-string`, `.cm-builtin`, …), so the
 * expression reads like code in every theme without a highlighter of ours.
 */
const tokens = new MatchDecorator({
  regexp: new RegExp(
    [
      String.raw`"(?:[^"\\]|\\.)*"`,
      String.raw`\b(?:true|false)\b`,
      String.raw`\b(?:${IN_COLLECTION_DIRECTLY_FUNCTION}|${IN_COLLECTION_FUNCTION}|${HAS_TAG_FUNCTION})\b`,
      String.raw`\b${ITEM_TYPE_FIELD}\b`,
      String.raw`==|!=|&&|\|\||!`,
      String.raw`[(),]`,
    ].join("|"),
    "g",
  ),
  decoration: (match) => Decoration.mark({ class: tokenClass(match[0]) }),
});

function tokenClass(text: string): string {
  if (text.startsWith('"')) return "cm-string";
  if (text === "true" || text === "false") return "cm-keyword";
  if (text === ITEM_TYPE_FIELD) return "cm-variable";
  if (/^[(),]$/.test(text)) return "cm-bracket";
  if (/^[a-z]/i.test(text)) return "cm-builtin";
  return "cm-operator";
}

const highlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = tokens.createDeco(view);
    }
    update(update: ViewUpdate) {
      this.decorations = tokens.updateDeco(update, this.decorations);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** Undo, the standard bindings, bracket pairs, the vocabulary colours, and wrapping. */
const baseExtensions = [
  history(),
  keymap.of([...defaultKeymap, ...historyKeymap]),
  bracketMatching(),
  highlight,
  EditorView.lineWrapping,
];

export interface ExpressionEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** The id of the visible label that names the editor. */
  labelledBy: string;
  invalid: boolean;
}

export function ExpressionEditor({
  value,
  onChange,
  placeholder,
  labelledBy,
  invalid,
}: ExpressionEditorProps) {
  // The accessible name and validity live on CodeMirror's own textbox.
  const extensions = useMemo(
    () => [
      ...baseExtensions,
      EditorView.contentAttributes.of({
        "aria-labelledby": labelledBy,
        "aria-invalid": String(invalid),
      }),
    ],
    [labelledBy, invalid],
  );
  return (
    <CodeMirror
      className="formula-editor zt:min-h-[calc(var(--input-height)*2)]"
      value={value}
      onChange={onChange}
      extensions={extensions}
      placeholder={placeholder}
      // Obsidian's stylesheet is the theme, and Tab stays a focus key.
      theme="none"
      basicSetup={false}
      indentWithTab={false}
    />
  );
}
