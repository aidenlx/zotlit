import type {
  ExpressionCompletionPresentation,
  ExpressionVocabulary,
} from "#/language/filter-expression-completion";
// The expression input of a Match condition and of a Formula: a small
// CodeMirror editor that colors its Filter Expression as the template panes
// color theirs.
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { linter, setDiagnostics } from "@codemirror/lint";
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

import {
  filterExpressionHighlighting,
  filterExpressionLanguage,
} from "#/language/filter-expression";
import { filterExpressionCompletion } from "#/language/filter-expression-completion";

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
    completion?: ExpressionVocabulary;
    presentation?: ExpressionCompletionPresentation;
  };
}) =>
  filterExpressionCompletion(
    () => props.current.completion,
    props.current.presentation,
  );

/** Marks the edit that brings in a new `value`, which is not the user's. */
const fromValue = Annotation.define<true>();

/** The span a Fault names in a text, in UTF-16 offsets; `to` is exclusive. */
export interface FaultSpan {
  readonly from: number;
  readonly to: number;
}

const NO_FAULTS: readonly FaultSpan[] = [];

export interface MatchExpressionInputProps {
  value: string;
  /**
   * The Faults of `value` to underline, which the owner's status line
   * reports; the field shows no tooltip over them. A new array sets them
   * again, so the owner keeps one while they stay the same.
   */
  faults?: readonly FaultSpan[];
  /** Each edit, with the window the field is in. */
  onChange: (text: string, win: Window) => void;
  onBlur?: () => void;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  placeholder?: string;
  /** The lines the field shows before it grows with its text. */
  lines?: number;
  /**
   * What Expression Completion offers as the user types, read per
   * keystroke; a field without one offers no completion.
   */
  completion?: ExpressionVocabulary;
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
  completion,
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
    completion,
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
    completion,
    presentation,
  };
  const attributes = useRef(new Compartment());
  const completer = useRef(new Compartment());
  // The vocabulary is read per keystroke, so only its arrival or its leaving
  // changes the editor.
  const completes = completion !== undefined;
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({
      effects: completer.current.reconfigure(
        completes ? completionOf(props) : [],
      ),
    });
  }, [completes]);
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
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          linter(null, { tooltipFilter: () => [] }),
          // CodeMirror's base theme is unlayered CSS, so it outranks a
          // host's layered utilities on these parts.
          EditorView.theme({
            "&.cm-focused": { outline: "none" },
            ".cm-content": { minHeight: `${lines * 1.5}em`, padding: "0" },
            ".cm-line": { padding: "0" },
            // CodeMirror still mounts an empty filtered tooltip.
            ".cm-tooltip-lint": { display: "none" },
          }),
          placeholder ? placeholderText(placeholder) : [],
          EditorView.contentAttributes.of({ spellcheck: "false" }),
          attributes.current.of(contentAttributes(props.current)),
          hostExtension ?? [],
          completer.current.of(
            props.current.completion ? completionOf(props) : [],
          ),
          EditorView.updateListener.of((update) => {
            if (
              update.docChanged &&
              !update.transactions.some((tr) => tr.annotation(fromValue))
            )
              props.current.onChange(
                update.state.doc.toString(),
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
    if (!editor || editor.state.doc.toString() === value) return;
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
