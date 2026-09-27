// JSON layout changes preserve token spelling and map between editor and Profile offsets.
import { invertedEffects } from "@codemirror/commands";
import { ChangeSet, StateEffect } from "@codemirror/state";
import { applyEdits, createScanner, format, parse } from "jsonc-parser";
import type { ParseError, Edit } from "jsonc-parser";
import { parseDocument } from "yaml";

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

/**
 * The JSON a rule editor shows for `source`, a `value` written `column`
 * characters into its line. JSON keeps its own spelling. A rule in another
 * YAML form shows the value it reads as, and the first edit stores that value
 * as compact JSON.
 */
export function ruleDisplay(source: string, column: number): string {
  if (!isJson(source)) {
    const value = yamlValue(source, column);
    if (value !== undefined) return JSON.stringify(value, null, 2);
  }
  return jsonLayout(source, true).text;
}

/**
 * The value `source` reads as on its own, written `column` characters into its
 * line, or `undefined` when YAML cannot read it.
 */
export function yamlValue(source: string, column: number): unknown {
  // The indent the value sits at lets a block mapping read on its own.
  const yaml = parseDocument(" ".repeat(column) + source, { uniqueKeys: true });
  return yaml.errors.length > 0 ? undefined : yaml.toJS();
}

/** Whether `source` is JSON as the rule editor writes it. */
export function isJson(source: string): boolean {
  try {
    JSON.parse(source);
    return true;
  } catch {
    return false;
  }
}

/**
 * Map a caret between two whitespace layouts of the same JSON token stream. A
 * rule written in YAML is shown as JSON with other tokens, so its caret is
 * kept inside the target text.
 */
export function jsonPosition(source: string, target: string, position: number) {
  const compact = jsonLayout(source, false);
  const expanded = jsonLayout(target, false);
  return expanded.changes.invertedDesc.mapPos(
    Math.min(compact.changes.mapPos(position, 1), expanded.text.length),
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
