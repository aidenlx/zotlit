// The expression input of a Match condition and of a Formula: a small
// CodeMirror editor that colors its Filter Expression as the template panes
// color theirs.

import type { CompletionPresentation } from "#/language/completion";
import type { ExpressionVocabulary } from "#/language/filter-expression-completion";
import type { Span } from "#/language/span";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { setDiagnostics } from "@codemirror/lint";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  placeholder as placeholderText,
} from "@codemirror/view";
import { useEffect, useRef } from "react";

import {
  useExpressionCompletion,
  useExpressionExtension,
  useParts,
} from "./theme";
import { underlineOnlyLint } from "./underline-lint";

import {
  filterExpressionHighlighting,
  filterExpressionLanguage,
} from "#/language/filter-expression";
import { filterExpressionCompletion } from "#/language/filter-expression-completion";
import { signatureHint } from "#/language/signature-hint-tooltip";

/** The label and validity of the field, on its editable content. */
const contentAttributes = ({
  label,
  invalid,
}: {
  label: string | undefined;
  invalid: boolean;
}) =>
  EditorView.contentAttributes.of({
    "aria-invalid": String(invalid),
    ...(label === undefined ? {} : { "aria-label": label }),
  });

/** Expression Completion over the vocabulary the field holds now. */
const completionOf = (props: {
  readonly current: {
    vocabulary?: ExpressionVocabulary;
    presentation?: CompletionPresentation;
  };
}) =>
  filterExpressionCompletion(
    () => props.current.vocabulary,
    props.current.presentation,
  );

/** Marks the edit that brings in a new `value`, which is not the user's. */
const fromValue = Annotation.define<true>();

const NO_FAULTS: readonly Span[] = [];

export interface MatchExpressionInputProps {
  value: string;
  /**
   * The Faults of `value` to underline, which the owner's status line
   * reports; the field shows no tooltip over them. A new array sets them
   * again, so the owner keeps one while they stay the same.
   */
  faults?: readonly Span[];
  /** Each edit, with the window the field is in. */
  onChange: (text: string, win: Window) => void;
  onBlur?: () => void;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  placeholder?: string;
  /** The lines the field shows before it grows with its text. */
  lines?: number;
  /**
   * What the field can read, read per keystroke: Expression Completion
   * offers its names, and the Signature Hint types a method call's receiver
   * by it. A field without one offers no completion, and its Signature Hint
   * names every definition of a method.
   */
  vocabulary?: ExpressionVocabulary;
}

/**
 * A Filter Expression field. It takes the `expression` part of the match
 * theme where it renders, so a host that wraps it in
 * `WorkbenchThemeProvider` gets the Match editor's look; the `data-*`
 * attributes go on that part. The editor draws no focus outline and no
 * padding, so the part owns both: it must show `:focus-within`.
 */
export function MatchExpressionInput({
  value,
  faults = NO_FAULTS,
  onChange,
  onBlur,
  "aria-label": label,
  "aria-invalid": invalid = false,
  placeholder,
  lines = 1,
  vocabulary,
  ...data
}: MatchExpressionInputProps & Partial<Record<`data-${string}`, string>>) {
  const part = useParts("match");
  const hostExtension = useExpressionExtension();
  const presentation = useExpressionCompletion();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // The editor is made once; it reads what it needs then, and later props,
  // through this ref.
  const props = useRef({
    value,
    onChange,
    onBlur,
    label,
    invalid,
    placeholder,
    lines,
    hostExtension,
    vocabulary,
    presentation,
  });
  props.current = {
    value,
    onChange,
    onBlur,
    label,
    invalid,
    placeholder,
    lines,
    hostExtension,
    vocabulary,
    presentation,
  };
  const attributes = useRef(new Compartment());
  const completer = useRef(new Compartment());
  /** The texts the field sent that the owner has not given back yet. */
  const sent = useRef<string[]>([]);
  // The vocabulary is read per keystroke, so only its arrival or its leaving
  // changes the editor; the editor starts with what this holds.
  const completes = vocabulary !== undefined;
  const completing = useRef(completes);
  useEffect(() => {
    const { value, placeholder, lines, hostExtension } = props.current;
    const parent = host.current!;
    const editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          filterExpressionLanguage,
          filterExpressionHighlighting,
          signatureHint({
            receiver: (source, at) =>
              props.current.vocabulary?.receiver?.(source, at),
          }),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          underlineOnlyLint,
          // CodeMirror's base theme is unlayered CSS, so it outranks a
          // host's layered utilities on these parts.
          EditorView.theme({
            "&.cm-focused": { outline: "none" },
            ".cm-content": { minHeight: `${lines * 1.5}em`, padding: "0" },
            ".cm-line": { padding: "0" },
          }),
          placeholder ? placeholderText(placeholder) : [],
          EditorView.contentAttributes.of({ spellcheck: "false" }),
          attributes.current.of(contentAttributes(props.current)),
          hostExtension ?? [],
          completer.current.of(completing.current ? completionOf(props) : []),
          EditorView.updateListener.of((update) => {
            if (
              !update.docChanged ||
              update.transactions.some((tr) => tr.annotation(fromValue))
            )
              return;
            const text = update.state.doc.toString();
            sent.current.push(text);
            props.current.onChange(
              text,
              parent.ownerDocument.defaultView ?? window,
            );
          }),
          EditorView.domEventHandlers({
            blur: () => {
              props.current.onBlur?.();
            },
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, []);
  useEffect(() => {
    const editor = view.current;
    if (!editor || completing.current === completes) return;
    completing.current = completes;
    editor.dispatch({
      effects: completer.current.reconfigure(
        completes ? completionOf(props) : [],
      ),
    });
  }, [completes]);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    // The owner's echo of a text the field sent. An effect can run after the
    // user typed again, so the echo may be of an older text; writing it back
    // would undo the typing and put the caret at the start.
    const echoed = sent.current.lastIndexOf(value);
    if (echoed !== -1) {
      sent.current = sent.current.slice(echoed + 1);
      return;
    }
    if (editor.state.doc.toString() === value) return;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: value },
      annotations: fromValue.of(true),
    });
  }, [value]);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch(
      setDiagnostics(
        editor.state,
        faults.map(({ from, to }) => ({
          from,
          to,
          message: "",
          severity: "error",
        })),
      ),
    );
  }, [faults]);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({
      effects: attributes.current.reconfigure(
        contentAttributes({ label, invalid }),
      ),
    });
  }, [invalid, label]);
  return <div ref={host} {...part("expression")} {...data} />;
}
