// The expression row's control: a CodeMirror editor over one Filter
// Expression, filling the row's statement box on Obsidian's public tokens.
// CodeMirror comes from Obsidian's bundle — every `@codemirror/*` import is
// external — and `@uiw/react-codemirror` is the React binding over it.
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

import { cn } from "@/lib/utils";
import {
  HAS_TAG_FUNCTION,
  IN_COLLECTION_DIRECTLY_FUNCTION,
  IN_COLLECTION_FUNCTION,
  ITEM_TYPE_FIELD,
} from "@/services/profile-selection/condition";

import "./style.css";

/**
 * The contract's vocabulary, marked with the token classes `style.css`
 * colours, so the expression reads like code without a language of its own.
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
  if (text.startsWith('"')) return "zt-expr-string";
  if (text === "true" || text === "false") return "zt-expr-keyword";
  if (text === ITEM_TYPE_FIELD) return "zt-expr-field";
  if (/^[(),]$/.test(text)) return "zt-expr-punctuation";
  if (/^[a-z]/i.test(text)) return "zt-expr-function";
  return "zt-expr-operator";
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
  /** The accessible name of the editor. */
  label: string;
  invalid: boolean;
  className?: string;
}

export function ExpressionEditor({
  value,
  onChange,
  placeholder,
  label,
  invalid,
  className,
}: ExpressionEditorProps) {
  // The accessible name and validity live on CodeMirror's own textbox.
  const extensions = useMemo(
    () => [
      ...baseExtensions,
      EditorView.contentAttributes.of({
        "aria-label": label,
        "aria-invalid": String(invalid),
      }),
    ],
    [label, invalid],
  );
  return (
    <CodeMirror
      className={cn(
        "zt-expression-editor",
        // The statement box around it owns the border, radius and focus ring;
        // the editor fills that box on the same surface as its controls.
        "zt:flex zt:min-h-(--input-height) zt:items-center zt:bg-input",
        className,
      )}
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
