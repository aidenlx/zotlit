// The Annotation Suggester: a trigger in the editor opens a search over the
// annotations in Library Scope, beside the Citation Suggester.
import { Component, EditorSuggest } from "obsidian";
import type {
  Editor,
  EditorPosition,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  TFile,
} from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { DEFAULT_LIMIT } from "@/services/item-lookup/service";
import type { QueryService } from "@/services/item-query/service";
import { defaults } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";
import type { CommentRenderer } from "@/views/annot-view/comment-render";
import {
  appendExcerptText,
  pageLocator,
} from "@/views/annot-view/excerpt-parts";

import { insertAnnotation } from "./annotation-insert";
import type { AnnotationInsertDeps } from "./annotation-insert";
import { searchAnnotations } from "./annotation-search";
import type { AnnotationHit } from "./annotation-search";
import { resolveAnnotationTrigger } from "./annotation-trigger";

export interface AnnotationSuggestDeps extends AnnotationInsertDeps {
  query: Pick<QueryService, "run">;
  settings: Pick<SettingsService, "current">;
  /**
   * The comment renderer every annotation surface shares, which draws a
   * comment as the Markdown the note will hold. `owner` holds the rendered
   * comments; links in them resolve against `sourcePath`.
   */
  commentRenderer: (owner: Component, sourcePath: string) => CommentRenderer;
}

export class AnnotationEditorSuggest extends EditorSuggest<AnnotationHit> {
  readonly #deps: AnnotationSuggestDeps;
  #searchController?: AbortController;
  /** Holds the comments the open popup's rows render; unloaded as it closes. */
  #rows: { owner: Component; renderComment: CommentRenderer } | null = null;

  constructor(deps: AnnotationSuggestDeps) {
    super(deps.app);
    this.#deps = deps;
    this.limit = DEFAULT_LIMIT;
    // The popup is a plugin UI root: its rows draw with `zt:` utilities.
    this.suggestEl.addClass("zt-root");
    this.setInstructions([
      { command: "↑↓", purpose: m.instruction_navigate() },
      { command: "↵", purpose: m.instruction_insert_annotation() },
      { command: "esc", purpose: m.instruction_dismiss() },
    ]);
  }

  override onTrigger(
    cursor: EditorPosition,
    editor: Editor,
    _file: TFile | null,
  ): EditorSuggestTriggerInfo | null {
    const trigger =
      this.#deps.settings.current?.["citation.annotation-trigger"] ??
      defaults["citation.annotation-trigger"];
    const found = resolveAnnotationTrigger(
      editor.getLine(cursor.line),
      cursor.ch,
      {
        trigger,
      },
    );
    if (!found) return null;
    return {
      start: { line: cursor.line, ch: found.start },
      end: { line: cursor.line, ch: found.end },
      query: found.query,
    };
  }

  override async getSuggestions(
    context: EditorSuggestContext,
  ): Promise<AnnotationHit[]> {
    this.#searchController?.abort();
    const controller = new AbortController();
    this.#searchController = controller;
    return (
      (await searchAnnotations(this.#deps.query, context.query, {
        signal: controller.signal,
        limit: this.limit,
      })) ?? []
    );
  }

  override close(): void {
    this.#searchController?.abort();
    this.#rows?.owner.unload();
    this.#rows = null;
    super.close();
  }

  override renderSuggestion(hit: AnnotationHit, el: HTMLElement): void {
    if (this.#rows === null) {
      const owner = new Component();
      owner.load();
      this.#rows = {
        owner,
        renderComment: this.#deps.commentRenderer(
          owner,
          this.context?.file?.path ?? "",
        ),
      };
    }
    renderAnnotationHit(hit, el, this.#rows.renderComment);
  }

  override selectSuggestion(hit: AnnotationHit): void {
    const context = this.context;
    if (!context) return;
    const { editor, file, start, end } = context;
    const info = this.#deps.app.workspace.activeEditor;
    if (!info || info.editor !== editor || info.file !== file) return;
    this.close();
    void insertAnnotation(this.#deps, {
      hit,
      info,
      isCurrent: () => this.#deps.app.workspace.activeEditor?.editor === editor,
      range: { from: editor.posToOffset(start), to: editor.posToOffset(end) },
    }).then((outcome) => {
      if (outcome.kind === "unavailable")
        this.#deps.notify(m.annotation_suggest_unavailable());
    });
  }
}

/**
 * One result: the quote with its color, the comment, the page and paper. The
 * quote is Zotero's stored rich text, drawn as the Annotation View and the
 * Annotation Popover draw an excerpt; the comment goes through the comment
 * renderer they share, so it reads as the Markdown the note will hold.
 */
export function renderAnnotationHit(
  hit: AnnotationHit,
  el: HTMLElement,
  renderComment: CommentRenderer,
): void {
  el.addClass("zt:flex", "zt:gap-2");
  const swatch = el.createDiv({
    cls: "zt:mt-1 zt:w-1 zt:shrink-0 zt:self-stretch zt:rounded-sm zt:bg-(--zt-annot-color)",
  });
  if (hit.color) swatch.style.setProperty("--zt-annot-color", hit.color);
  const body = el.createDiv({ cls: "zt:min-w-0 zt:flex-1" });
  if (hit.text) appendExcerptText(body, hit.text, "zt:m-0 zt:line-clamp-3");
  if (hit.comment)
    renderComment(
      body.createDiv({
        cls: hit.text
          ? "zt:line-clamp-2 zt:text-sm zt:text-muted-foreground"
          : "zt:line-clamp-3",
      }),
      hit.comment,
    );
  if (!hit.text && !hit.comment)
    body.createDiv({
      text: m.workbench_annotation_type({ type: hit.type ?? "" }),
    });
  const meta = [
    hit.pageLabel === null || hit.pageLabel === ""
      ? null
      : pageLocator(hit.pageLabel),
    hit.title,
  ].filter((part): part is string => !!part);
  if (meta.length > 0)
    body.createDiv({
      cls: "zt:truncate zt:text-xs zt:text-faint",
      text: meta.join(" · "),
    });
}
