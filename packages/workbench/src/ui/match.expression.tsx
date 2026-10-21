// The expression input of a Match condition and of a Formula: a small
// CodeMirror editor that colors its Filter Expression as the template panes
// color theirs, and underlines its Syntax Fault, else the Fault a run found.

import type { CompletionPresentation } from "#/language/completion";
import type { ExpressionVocabulary } from "#/language/filter-expression-completion";
import type { PlacedFault } from "#/language/span";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { setDiagnostics, setDiagnosticsEffect } from "@codemirror/lint";
import type { Diagnostic } from "@codemirror/lint";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  placeholder as placeholderText,
} from "@codemirror/view";
import { useEffect, useLayoutEffect, useRef } from "react";

import { parseExpression } from "@zotlit/filter-expression";

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

/**
 * What the field underlines in `text`: its Syntax Fault, else the run's
 * Fault while `text` is the text that run planned.
 */
function underlines(
  text: string,
  fault: PlacedFault | undefined,
): Diagnostic[] {
  const { error } = parseExpression(text);
  const span = error ? error.span : fault?.text === text ? fault.span : null;
  return span ? [{ ...span, message: "", severity: "error" }] : [];
}

export interface MatchExpressionInputProps {
  value: string;
  /**
   * Where the last run found a Fault, which the field underlines while its
   * text is the text that run planned. The field underlines its own Syntax
   * Fault first. The owner's status line reports both; the field shows no
   * tooltip over them.
   */
  fault?: PlacedFault;
  /**
   * Each edit, with the window the field is in. The owner gives a text it
   * keeps back as `value` in the render the edit causes; a `value` that
   * differs from the field's text then replaces it.
   */
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
 * padding, so the part owns both: it must show `:focus-within`. The part
 * also sets the box height: a part as tall as the host's text inputs reads
 * like one, as the editor stands at its vertical centre while the text is
 * shorter than the box.
 */
export function MatchExpressionInput({
  value,
  fault,
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
    fault,
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
    fault,
  };
  const attributes = useRef(new Compartment());
  const completer = useRef(new Compartment());
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
          // Each edit underlines its own text, so no underline is carried to
          // a text it was not found in.
          EditorState.transactionExtender.of((tr) =>
            tr.docChanged
              ? {
                  effects: setDiagnosticsEffect.of(
                    underlines(tr.newDoc.toString(), props.current.fault),
                  ),
                }
              : null,
          ),
          // CodeMirror's base theme is unlayered CSS, so it outranks a
          // host's layered utilities on these parts. The text takes the
          // part's font and line height, as a textarea takes its own, and
          // the field is `lines` of that line tall before it grows.
          EditorView.theme({
            "&.cm-focused": { outline: "none" },
            ".cm-scroller": { fontFamily: "inherit", lineHeight: "inherit" },
            ".cm-content": { minHeight: `${lines}lh`, padding: "0" },
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
  // Read as the owner's render commits, before the next key: an effect
  // waits for paint, and the user may type again before it runs, so the
  // owner's echo of a text the field sent would read as an older text and
  // undo the typing.
  useLayoutEffect(() => {
    const editor = view.current;
    if (!editor) return;
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
        underlines(editor.state.doc.toString(), fault),
      ),
    );
  }, [fault]);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({
      effects: attributes.current.reconfigure(
        contentAttributes({ label, invalid }),
      ),
    });
  }, [invalid, label]);
  // A column that centres the editor: one line stands where a text input's
  // text stands, and wrapped text grows the box.
  return (
    <div
      ref={host}
      {...part("expression")}
      {...data}
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    />
  );
}
