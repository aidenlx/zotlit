import { Text } from "@codemirror/state";
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
import { CurrentAnswer } from "@/services/item-lookup/current-answer";
import type { SearchSession } from "@/services/item-lookup/handle";
import { renderSuggestion as renderSearchHit } from "@/services/item-lookup/render-hit";
import { DEFAULT_LIMIT } from "@/services/item-lookup/service";
import type { SearchHit } from "@/services/item-lookup/service";
import { InertTemplateError } from "@/services/template/errors";
import {
  isCitationCloser,
  placeInsertion,
} from "@/views/annot-view/async-insert";

import { readDocumentCitedKeys } from "./document-citations";
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
  #documentController?: AbortController;
  #cited: Promise<readonly string[]> = Promise.resolve([]);
  readonly #answer = new CurrentAnswer<SearchHit>(this.suggestEl);

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
    if (
      this.#deps.bridge.runSync(this.#deps.settings.current)[
        "citation.editor-suggester"
      ] === false
    ) {
      return null;
    }

    const line = editor.getLine(cursor.line);
    const atTrigger = this.#deps.bridge.runSync(this.#deps.settings.current)[
      "citation.at-trigger"
    ];
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

  override getSuggestions(context: EditorSuggestContext): Promise<SearchHit[]> {
    // Obsidian shows nothing for a `null` answer; `[]` would close the dropdown.
    return this.#answer.track(this.#search(context)) as Promise<SearchHit[]>;
  }

  /** The hits for `context`, or `null` when a later keystroke superseded it. */
  async #search(context: EditorSuggestContext): Promise<SearchHit[] | null> {
    this.#lookupController?.abort();
    const controller = new AbortController();
    this.#lookupController = controller;
    const source = `@${context.query}`;
    const key = scanPandocCitations(source)[0]?.items[0];
    if (key?.start === 0 && source.slice(key.end).trimStart().startsWith(",")) {
      const answer = await this.#deps.citationLookup
        .read(
          {
            citekeys: [key.citationKey],
          },
          { signal: controller.signal },
        )
        .catch(() => null);
      if (controller.signal.aborted) return null;
      if (answer === null) return [];
      const found = answer.resolve(key.citationKey);
      if (found.kind === "unique" || found.kind === "ambiguous") {
        this.close();
        return [];
      }
    }
    if (!this.#session) {
      this.#session = this.#deps.lookup.openSession();
      this.#documentController = new AbortController();
      this.#cited = readDocumentCitedKeys(
        this.#deps.citationIndex,
        context.file,
        this.#documentController.signal,
      );
    }
    const session = this.#session;
    const cited = await this.#cited;
    if (session !== this.#session) return [];
    return session.search(context.query, { limit: this.limit, cited });
  }

  override close(): void {
    this.#documentController?.abort();
    this.#lookupController?.abort();
    this.#session?.close();
    this.#session = null;
    this.#answer.close();
    super.close();
  }

  override renderSuggestion(hit: SearchHit, el: HTMLElement): void {
    renderSearchHit(this.#deps.settings, this.#deps.bridge, hit, el);
  }

  override selectSuggestion(
    hit: SearchHit,
    evt: MouseEvent | KeyboardEvent,
  ): void {
    this.#answer.choose(hit, evt, (chosen) => void this.#insert(chosen, evt));
  }

  async #insert(
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
    commitCitationInsert(this.#deps, {
      indexedKey: hit.item.indexedKey,
      text: outcome.text,
      insert: () =>
        writeCitation(context.editor, outcome.text, {
          from: context.start,
          to: context.end,
          replacesTrigger: true,
        }),
    });
  }
}

/**
 * Write `citation` over `from`–`to` of `editor`, placed by the citation rule
 * of {@link placeInsertion} against the note as it stands now, and leave the
 * cursor where that rule puts it. `replacesTrigger` where the range is a
 * trigger the researcher typed.
 */
export function writeCitation(
  editor: Editor,
  citation: string,
  options: {
    from: EditorPosition;
    to: EditorPosition;
    replacesTrigger?: boolean;
  },
): boolean {
  const { from, to } = options;
  const start = editor.posToOffset(from);
  const { insert, cursor } = placeInsertion(citation, {
    kind: "citation",
    replacesTrigger: options.replacesTrigger,
    doc: Text.of(editor.getValue().split("\n")),
    range: { from: start, to: editor.posToOffset(to) },
  });
  editor.replaceRange(insert, from, to);
  editor.setCursor(editor.offsetToPos(start + cursor));
  return true;
}

/**
 * Commit one resolved citation and record the Use only after the destination
 * accepts nonempty text. The callback returns false when a stale destination
 * writes nothing.
 */
export function commitCitationInsert(
  deps: Pick<CitationSuggestDeps, "useLedger">,
  {
    indexedKey,
    text,
    insert,
  }: { indexedKey: string; text: string; insert: () => boolean },
): boolean {
  if (text.length === 0 || !insert()) return false;
  deps.useLedger.record(indexedKey, "cited");
  return true;
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
  deps: Pick<CitationSuggestDeps, "noteFeature" | "citationLookup">,
  hit: Pick<SearchHit, "item">,
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
  if (deps.citationLookup.status === "pending") {
    return { kind: "notice", message: m.notice_citekey_not_ready() };
  }

  let lookup;
  try {
    lookup = await deps.citationLookup.read({ citekeys: [citationKey] });
  } catch {
    return { kind: "notice", message: m.notice_citekey_not_ready() };
  }
  if (lookup.resolve(citationKey).kind === "ambiguous") {
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
  return isCitationCloser(line.charAt(ch));
}
