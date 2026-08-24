import { regex } from "arkregex";
import { EditorSuggest, Keymap } from "obsidian";
import type {
  Editor,
  EditorPosition,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  TFile,
} from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import { renderSuggestion as renderSearchHit } from "@/services/item-lookup/render-hit";
import { DEFAULT_LIMIT } from "@/services/item-lookup/service";
import type { SearchHit } from "@/services/item-lookup/service";
import { InertTemplateError } from "@/services/template/errors";

import type { CitationSuggestDeps } from "./register";

const TRIGGER = regex("[\\[【]@([^\\]】]*)$");
// Bare `@` at a word boundary: line start, or preceded by whitespace or one of
// the openers `( [ { （ 【 「 " '`. Query runs to the cursor, stopping at the
// first whitespace or closing bracket.
const AT_TRIGGER = regex("(?:^|[\\s(\\[{（【「\"'])@([^\\s\\]】]*)$");

export class CitationEditorSuggest extends EditorSuggest<SearchHit> {
  readonly #deps: CitationSuggestDeps;
  /** Set in {@link onTrigger}: query ended with `/`, so render `cite2`. */
  #secondary = false;

  constructor(deps: CitationSuggestDeps) {
    super(deps.app);
    this.#deps = deps;
    this.limit = DEFAULT_LIMIT;
    this.setInstructions([
      { command: "↑↓", purpose: m.instruction_navigate() },
      { command: "↵", purpose: m.instruction_insert_citation() },
      { command: "/ ↵", purpose: m.instruction_insert_secondary_citation() },
      { command: "⇧↵", purpose: m.instruction_insert_secondary_citation() },
      { command: "esc", purpose: m.instruction_dismiss() },
    ]);
    this.scope.register(["Shift"], "Enter", (evt) => {
      this.suggestions.useSelectedItem(evt);
      return false;
    });
  }

  override onTrigger(
    cursor: EditorPosition,
    editor: Editor,
    _file: TFile | null,
  ): EditorSuggestTriggerInfo | null {
    if (this.#deps.settings.current?.["citation.editor-suggester"] === false) {
      return null;
    }

    const line = editor.getLine(cursor.line);
    const atTrigger =
      this.#deps.settings.current?.["citation.at-trigger"] ?? false;
    const trigger = resolveCitationTrigger(line, cursor.ch, atTrigger);
    if (!trigger) return null;

    this.#secondary = trigger.secondary;

    return {
      start: { line: cursor.line, ch: trigger.start },
      end: { line: cursor.line, ch: trigger.end },
      query: trigger.query,
    };
  }

  override getSuggestions(
    context: EditorSuggestContext,
  ): SearchHit[] | Promise<SearchHit[]> {
    return this.#deps.lookup.search(context.query, { limit: this.limit });
  }

  override renderSuggestion(hit: SearchHit, el: HTMLElement): void {
    renderSearchHit(this.#deps.settings, hit, el);
  }

  override selectSuggestion(
    hit: SearchHit,
    evt: MouseEvent | KeyboardEvent,
  ): void {
    const context = this.context;
    if (!context) return;

    const secondary = this.#secondary || Keymap.isModifier(evt, "Shift");
    const outcome = resolveCitationInsert(this.#deps, hit, secondary);
    if (outcome.kind === "notice") {
      new BaseNotice(outcome.message);
      return;
    }
    const line = context.editor.getLine(context.end.line);
    const padded = padCitationInsert(outcome.text, line.charAt(context.end.ch));
    context.editor.replaceRange(padded.text, context.start, context.end);
    context.editor.setCursor(
      context.editor.offsetToPos(
        context.editor.posToOffset(context.start) + padded.cursor,
      ),
    );
  }
}

/** Editor-insert payload for a citation: replacement text plus cursor offset. */
export interface PaddedCitationInsert {
  /** Text replacing the trigger range (or selection). */
  text: string;
  /** Cursor position after the insert, as an offset from the replacement start. */
  cursor: number;
}

/**
 * Pad an editor citation insert with its single trailing space: the document
 * always reads `citation` + one space at the cursor, reusing a space already
 * present at the insert position instead of doubling it. The space keeps the
 * inserted citation from re-matching a trigger — an alternate-format `@key`
 * at a word boundary would otherwise re-open the suggester.
 *
 * @param nextChar - the document character at the insert position (`""` at
 *   line end).
 */
export function padCitationInsert(
  citation: string,
  nextChar: string,
): PaddedCitationInsert {
  return {
    text: nextChar === " " ? citation : `${citation} `,
    cursor: citation.length + 1,
  };
}

/** What selecting a suggestion does: insert `text`, or show `message`. */
export type CitationInsertOutcome =
  | { kind: "insert"; text: string }
  | { kind: "notice"; message: string };

/**
 * Decide what selecting `hit` inserts — the pure decision core both citation
 * insertion entry points run: the inline Citation Suggester and the
 * command-palette insert modal.
 *
 * Returns the rendered citation to insert, or the notice message to show:
 * an item without a citekey, a citekey several Zotero Items answer to, a
 * resolution snapshot that has not answered yet, an inert cite template, or a
 * template not loaded yet. An Ambiguous Citation Key is refused rather than
 * inserted, because the inserted text carries the key alone and would lose the
 * identity the user picked here. A snapshot still resolving reports every key
 * as missing, so it is refused too rather than let an ambiguous key through
 * while the answer is pending. Errors other than {@link InertTemplateError}
 * propagate.
 */
export function resolveCitationInsert(
  deps: Pick<CitationSuggestDeps, "noteFeature" | "citationIndex">,
  hit: SearchHit,
  secondary: boolean,
): CitationInsertOutcome {
  const citationKey =
    "citationKey" in hit.item.fields ? hit.item.fields.citationKey : null;
  if (!citationKey) {
    return {
      kind: "notice",
      message: m.notice_no_citekey({ key: hit.item.key }),
    };
  }

  // `degraded` is settled data, so it inserts on whatever the snapshot holds;
  // `resolving` has no verdict yet and would read an ambiguous key as missing.
  if (deps.citationIndex.resolution === "resolving") {
    return { kind: "notice", message: m.notice_citekey_not_ready() };
  }

  if (deps.citationIndex.resolveCitekey(citationKey).kind === "ambiguous") {
    return {
      kind: "notice",
      message: m.notice_citekey_ambiguous_insert({ citekey: citationKey }),
    };
  }

  let rendered: string | null;
  try {
    rendered = deps.noteFeature.renderCitation(
      [{ citationKey, item: hit.item }],
      secondary,
    );
  } catch (e) {
    if (!(e instanceof InertTemplateError)) throw e;
    return { kind: "notice", message: e.message };
  }
  if (rendered === null) {
    return { kind: "notice", message: m.notice_template_not_ready() };
  }
  return { kind: "insert", text: rendered };
}

/** Resolved inline trigger: ch offsets on the cursor line. */
export interface CitationTrigger {
  /** ch of the trigger's first char (`[`, `【`, or `@`). */
  start: number;
  /** ch replacement end (cursor, or cursor+1 when a bracket match consumes an adjacent closing bracket). */
  end: number;
  /** Search query (trailing `/` stripped; at-queries have `_` → space applied). */
  query: string;
  /** Trailing `/` was present. */
  secondary: boolean;
}

/**
 * Decide whether `line` at cursor `ch` opens the Citation Suggester, and with
 * what query. Pure decision core for {@link CitationEditorSuggest.onTrigger}.
 * The Bracket Trigger (`[@`/`【@`, always on) is tried first; the At Trigger
 * (bare `@` at a word boundary) is only consulted when it doesn't match and
 * `atTrigger` is enabled.
 */
export function resolveCitationTrigger(
  line: string,
  ch: number,
  atTrigger: boolean,
): CitationTrigger | null {
  const beforeCursor = line.slice(0, ch);

  const bracketMatch = TRIGGER.exec(beforeCursor);
  if (bracketMatch) {
    const raw = bracketMatch[1] ?? "";
    const secondary = raw.endsWith("/");
    return {
      start: bracketMatch.index,
      end: closingBracketAt(line, ch) ? ch + 1 : ch,
      query: secondary ? raw.slice(0, -1) : raw,
      secondary,
    };
  }

  if (!atTrigger) return null;

  const atMatch = AT_TRIGGER.exec(beforeCursor);
  if (!atMatch) return null;

  const raw = atMatch[1] ?? "";
  const secondary = raw.endsWith("/");
  const stripped = secondary ? raw.slice(0, -1) : raw;

  return {
    start: ch - raw.length - 1,
    end: ch,
    query: stripped.replaceAll("_", " "),
    secondary,
  };
}

function closingBracketAt(line: string, ch: number): boolean {
  const next = line.charAt(ch);
  return next === "]" || next === "】";
}
