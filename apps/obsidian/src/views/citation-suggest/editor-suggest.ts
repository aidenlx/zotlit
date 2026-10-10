import { regex } from "arkregex";
import { EditorSuggest, Keymap } from "obsidian";
import type {
  Editor,
  EditorPosition,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  TFile,
} from "obsidian";

import type { CitationVariant } from "@zotlit/db";
import { scanPandocCitations } from "@zotlit/templates/pandoc-citation";

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import { renderSuggestion as renderSearchHit } from "@/services/item-lookup/render-hit";
import { DEFAULT_LIMIT } from "@/services/item-lookup/service";
import type { SearchHit, SearchSession } from "@/services/item-lookup/service";
import { InertTemplateError } from "@/services/template/errors";

import type { CitationSuggestDeps } from "./register";

const TRIGGER = regex("[\\[【]@([^\\]】]*)$");
// Bare `@` at a word boundary: line start, or preceded by whitespace or one of
// the openers `( [ { （ 【 「 " '`. Query runs to the cursor, stopping at the
// first whitespace or closing bracket.
const AT_TRIGGER = regex("(?:^|[\\s(\\[{（【「\"'])@([^\\s\\]】]*)$");

export class CitationEditorSuggest extends EditorSuggest<SearchHit> {
  readonly #deps: CitationSuggestDeps;
  /** Set in {@link onTrigger}: the Citation Variant the open query asks for. */
  #variant: CitationVariant = "main";
  /** The searches of the open dropdown: its first search opens it, and {@link close} ends it. */
  #session: SearchSession | null = null;
  #lookupController?: AbortController;

  constructor(deps: CitationSuggestDeps) {
    super(deps.app);
    this.#deps = deps;
    this.limit = DEFAULT_LIMIT;
    this.setInstructions([
      { command: "↑↓", purpose: m.instruction_navigate() },
      { command: "↵", purpose: m.instruction_insert_citation() },
      { command: "/ ↵", purpose: m.instruction_insert_alternate_citation() },
      { command: "⇧↵", purpose: m.instruction_insert_alternate_citation() },
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
    const trigger = resolveCitationTrigger(line, cursor.ch, {
      atTrigger,
    });
    if (!trigger) return null;

    this.#variant = trigger.variant;

    return {
      start: { line: cursor.line, ch: trigger.start },
      end: { line: cursor.line, ch: trigger.end },
      query: trigger.query,
    };
  }

  override async getSuggestions(
    context: EditorSuggestContext,
  ): Promise<SearchHit[]> {
    this.#lookupController?.abort();
    const controller = new AbortController();
    this.#lookupController = controller;
    const source = `@${context.query}`;
    const key = scanPandocCitations(source)[0]?.items[0];
    if (key?.start === 0 && source.slice(key.end).trimStart().startsWith(",")) {
      const answer = await this.#deps.citationIndex
        .readLookup(
          {
            citekeys: [key.citationKey],
          },
          { signal: controller.signal },
        )
        .catch(() => null);
      if (answer === null || controller.signal.aborted) return [];
      const found = answer.resolve(key.citationKey);
      if (found?.kind === "unique" || found?.kind === "ambiguous") {
        this.close();
        return [];
      }
    }
    this.#session ??= this.#deps.lookup.openSession();
    return this.#session.search(context.query, { limit: this.limit });
  }

  override close(): void {
    this.#lookupController?.abort();
    this.#session?.close();
    this.#session = null;
    super.close();
  }

  override renderSuggestion(hit: SearchHit, el: HTMLElement): void {
    renderSearchHit(this.#deps.settings, hit, el);
  }

  override async selectSuggestion(
    hit: SearchHit,
    evt: MouseEvent | KeyboardEvent,
  ): Promise<void> {
    const context = this.context;
    if (!context) return;

    const variant: CitationVariant =
      this.#variant === "alt" || Keymap.isModifier(evt, "Shift")
        ? "alt"
        : "main";
    const before = context.editor.getValue();
    const outcome = await resolveCitationInsert(this.#deps, hit, variant);
    if (context.editor.getValue() !== before) return;
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
 * A bracketed citation ends at its closing bracket instead, which no trigger
 * matches, so punctuation typed next follows it directly: `[@key].`
 *
 * @param nextChar - the document character at the insert position (`""` at
 *   line end).
 */
export function padCitationInsert(
  citation: string,
  nextChar: string,
): PaddedCitationInsert {
  if (closingBracketAt(citation, citation.length - 1))
    return { text: citation, cursor: citation.length };
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
 * resolution snapshot that has not answered yet, an inert Citation Template,
 * or a template not loaded yet. An Ambiguous Citation Key is refused rather than
 * inserted, because the inserted text carries the key alone and would lose the
 * identity the user picked here. A snapshot still resolving reports every key
 * as missing, so it is refused too rather than let an ambiguous key through
 * while the answer is pending. Errors other than {@link InertTemplateError}
 * propagate.
 */
export async function resolveCitationInsert(
  deps: Pick<CitationSuggestDeps, "noteFeature" | "citationIndex">,
  hit: SearchHit,
  variant: CitationVariant,
): Promise<CitationInsertOutcome> {
  const citationKey =
    "citationKey" in hit.item.fields ? hit.item.fields.citationKey : null;
  if (!citationKey) {
    return {
      kind: "notice",
      message: m.notice_no_citekey({ key: hit.item.key }),
    };
  }

  // A pending snapshot has no verdict yet and would read an ambiguous key as
  // missing. A held snapshot keeps its verdict while it revalidates or fails.
  if (deps.citationIndex.resolution === null) {
    return { kind: "notice", message: m.notice_citekey_not_ready() };
  }

  let lookup;
  try {
    lookup = await deps.citationIndex.readLookup({ citekeys: [citationKey] });
  } catch {
    return { kind: "notice", message: m.notice_citekey_not_ready() };
  }
  if (lookup.resolve(citationKey)?.kind === "ambiguous") {
    return {
      kind: "notice",
      message: m.notice_citekey_ambiguous_insert({ citekey: citationKey }),
    };
  }

  let rendered: string | null;
  try {
    rendered = deps.noteFeature.renderCitation(
      [{ citationKey, item: hit.item }],
      variant,
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
  /** The Citation Variant the query asks for: `"alt"` when it ended with `/`. */
  variant: CitationVariant;
}

/**
 * Decide whether `line` at cursor `ch` opens the Citation Suggester, and with
 * what query. Pure decision core for {@link CitationEditorSuggest.onTrigger}.
 * The Bracket Trigger (`[@`/`【@`, always on) is tried first; the At Trigger
 * (bare `@` at a word boundary) is only consulted when it doesn't match and
 * `atTrigger` is enabled. A comma after a known key starts locator editing;
 * other queries keep their title-search punctuation and spaces.
 */
export function resolveCitationTrigger(
  line: string,
  ch: number,
  {
    atTrigger,
    isKnownCitekey = () => false,
  }: { atTrigger: boolean; isKnownCitekey?: (key: string) => boolean },
): CitationTrigger | null {
  const beforeCursor = line.slice(0, ch);

  const bracketMatch = TRIGGER.exec(beforeCursor);
  if (bracketMatch) {
    const raw = bracketMatch[1] ?? "";
    const source = `@${raw}`;
    const key = scanPandocCitations(source)[0]?.items[0];
    if (
      key?.start === 0 &&
      source.slice(key.end).trimStart().startsWith(",") &&
      isKnownCitekey(key.citationKey)
    ) {
      return null;
    }
    const alternate = raw.endsWith("/");
    return {
      start: bracketMatch.index,
      end: closingBracketAt(line, ch) ? ch + 1 : ch,
      query: alternate ? raw.slice(0, -1) : raw,
      variant: alternate ? "alt" : "main",
    };
  }

  if (!atTrigger) return null;

  const atMatch = AT_TRIGGER.exec(beforeCursor);
  if (!atMatch) return null;

  const raw = atMatch[1] ?? "";
  const alternate = raw.endsWith("/");
  const stripped = alternate ? raw.slice(0, -1) : raw;

  return {
    start: ch - raw.length - 1,
    end: ch,
    query: stripped.replaceAll("_", " "),
    variant: alternate ? "alt" : "main",
  };
}

function closingBracketAt(line: string, ch: number): boolean {
  const next = line.charAt(ch);
  return next === "]" || next === "】";
}
