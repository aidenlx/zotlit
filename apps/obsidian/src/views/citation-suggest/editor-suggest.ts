import { regex } from "arkregex";
import {
  EditorSuggest,
  type Editor,
  type EditorPosition,
  type EditorSuggestContext,
  type EditorSuggestTriggerInfo,
  type TFile,
} from "obsidian";

import { BaseNotice } from "@/lib/notice";
import * as m from "@/paraglide/messages";
import { type SearchHit } from "@/services/item-lookup/engine";
import { renderSuggestion as renderSearchHit } from "@/services/item-lookup/render-hit";
import { DEFAULT_LIMIT } from "@/services/item-lookup/service";

import { type CitationSuggestDeps } from "./register";

const TRIGGER = regex("[\\[【]@([^\\]】]*)$");

export class CitationEditorSuggest extends EditorSuggest<SearchHit> {
  readonly #deps: CitationSuggestDeps;

  constructor(deps: CitationSuggestDeps) {
    super(deps.app);
    this.#deps = deps;
    this.limit = DEFAULT_LIMIT;
    this.setInstructions([
      { command: "↑↓", purpose: m.instruction_navigate() },
      { command: "↵", purpose: m.instruction_insert_citation() },
      { command: "esc", purpose: m.instruction_dismiss() },
    ]);
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
    const beforeCursor = line.slice(0, cursor.ch);
    const match = TRIGGER.exec(beforeCursor);
    if (!match) return null;

    const start = { line: cursor.line, ch: match.index };
    const end = closingBracketAt(line, cursor.ch)
      ? { line: cursor.line, ch: cursor.ch + 1 }
      : cursor;

    return {
      start,
      end,
      query: match[1] ?? "",
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
    _evt: MouseEvent | KeyboardEvent,
  ): void {
    const context = this.context;
    if (!context) return;

    if (!hit.item.citekey) {
      new BaseNotice(m.notice_no_citekey({ key: hit.item.key }));
      return;
    }

    const rendered = this.#deps.template.render("cite", [
      { citekey: hit.item.citekey },
    ]);
    context.editor.replaceRange(rendered, context.start, context.end);
    context.editor.setCursor(
      context.editor.offsetToPos(
        context.editor.posToOffset(context.start) + rendered.length,
      ),
    );
  }
}

function closingBracketAt(line: string, ch: number): boolean {
  const next = line.charAt(ch);
  return next === "]" || next === "】";
}
