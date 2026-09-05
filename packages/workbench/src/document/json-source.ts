// JSON layout changes preserve token spelling and map between editor and Profile offsets.
import { invertedEffects } from "@codemirror/commands";
import { ChangeSet, StateEffect } from "@codemirror/state";
import { applyEdits, createScanner, format, parse } from "jsonc-parser";
import type { ParseError, Edit } from "jsonc-parser";

// The library declares ambient const enums, which verbatimModuleSyntax cannot import.
const tokenKind = { eof: 17, whitespace: 15, lineBreak: 14 };

/** Format for display, or remove insignificant whitespace for inline YAML storage. */
export function jsonLayout(source: string, pretty: boolean) {
  let edits: Edit[];
  if (pretty) {
    edits = format(source, undefined, {
      insertSpaces: true,
      tabSize: 2,
      eol: "\n",
    });
  } else {
    const errors: ParseError[] = [];
    parse(source, errors, {
      disallowComments: true,
      allowTrailingComma: false,
    });
    const scanner = createScanner(source);
    edits = [];
    for (
      let token = scanner.scan();
      token !== tokenKind.eof;
      token = scanner.scan()
    ) {
      if (token === tokenKind.whitespace || token === tokenKind.lineBreak) {
        // Retain separators in unfinished input: `1 2` must not turn into `12`.
        const previous = edits.at(-1);
        if (
          previous &&
          previous.offset + previous.length === scanner.getTokenOffset()
        ) {
          previous.length += scanner.getTokenLength();
        } else
          edits.push({
            offset: scanner.getTokenOffset(),
            length: scanner.getTokenLength(),
            content: errors.length ? " " : "",
          });
      }
    }
  }
  return {
    text: applyEdits(source, edits),
    changes: ChangeSet.of(
      edits.map((edit) => ({
        from: edit.offset,
        to: edit.offset + edit.length,
        insert: edit.content,
      })),
      source.length,
    ),
  };
}

/** Map a caret between two whitespace layouts of the same JSON token stream. */
export function jsonPosition(source: string, target: string, position: number) {
  const compact = jsonLayout(source, false);
  const expanded = jsonLayout(target, false);
  return expanded.changes.invertedDesc.mapPos(
    compact.changes.mapPos(position, 1),
    1,
  );
}

type JsonDraft = { text: string; head: number };
export const jsonSliceEdit = StateEffect.define<{
  id: string;
  before: JsonDraft;
  after: JsonDraft;
}>();

// Formatting-only edits and exact draft selections share the master's undo history.
export const jsonSliceHistory = invertedEffects.of((transaction) =>
  transaction.effects.toReversed().flatMap((effect) =>
    effect.is(jsonSliceEdit)
      ? [
          jsonSliceEdit.of({
            id: effect.value.id,
            before: effect.value.after,
            after: effect.value.before,
          }),
        ]
      : [],
  ),
);
