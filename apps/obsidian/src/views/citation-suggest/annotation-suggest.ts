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
import { CurrentAnswer } from "@/services/item-lookup/current-answer";
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
  /** The hits the latest search returned, which the popup draws next. */
  #incoming: readonly AnnotationHit[] = [];
  /**
   * The rows the popup shows: the hits they draw and a stack that holds each
   * row's drawn comment and the component that owns them. A new result set
   * disposes it, and so does closing the popup.
   */
  #rows: {
    hits: readonly AnnotationHit[];
    stack: DisposableStack;
    renderComment: CommentRenderer;
  } | null = null;
  readonly #answer = new CurrentAnswer<AnnotationHit>(this.suggestEl);

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

  override getSuggestions(
    context: EditorSuggestContext,
  ): Promise<AnnotationHit[]> {
    // Obsidian shows nothing for a `null` answer; `[]` would close the popup.
    return this.#answer.track(this.#search(context)) as Promise<
      AnnotationHit[]
    >;
  }

  /** The hits for `context`, or `null` when a later keystroke superseded it. */
  async #search(
    context: EditorSuggestContext,
  ): Promise<AnnotationHit[] | null> {
    this.#searchController?.abort();
    const controller = new AbortController();
    this.#searchController = controller;
    const hits =
      (await searchAnnotations(this.#deps.query, context.query, {
        signal: controller.signal,
        limit: this.limit,
      })) ?? [];
    if (controller.signal.aborted) return null;
    this.#incoming = hits;
    return hits;
  }

  override close(): void {
    this.#searchController?.abort();
    this.#rows?.stack.dispose();
    this.#rows = null;
    this.#incoming = [];
    this.#answer.close();
    super.close();
  }

  override renderSuggestion(hit: AnnotationHit, el: HTMLElement): void {
    // The first row of a new result set replaces every row of the last one,
    // so the comments those rows drew go with them.
    if (
      this.#rows === null ||
      (this.#rows.hits !== this.#incoming && this.#incoming.includes(hit))
    ) {
      this.#rows?.stack.dispose();
      this.#rows = this.#openRows(this.#incoming);
    }
    const { stack, renderComment } = this.#rows;
    stack.defer(renderAnnotationHit(hit, el, renderComment));
  }

  #openRows(hits: readonly AnnotationHit[]) {
    const stack = new DisposableStack();
    const owner = stack.adopt(new Component(), (component) =>
      component.unload(),
    );
    owner.load();
    return {
      hits,
      stack,
      renderComment: this.#deps.commentRenderer(
        owner,
        this.context?.file?.path ?? "",
      ),
    };
  }

  override selectSuggestion(
    hit: AnnotationHit,
    evt: MouseEvent | KeyboardEvent,
  ): void {
    this.#answer.choose(hit, evt, (chosen) => this.#insert(chosen));
  }

  #insert(hit: AnnotationHit): void {
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
 *
 * @returns the cleanup of the drawn comment, a no-op for a row without one.
 */
export function renderAnnotationHit(
  hit: AnnotationHit,
  el: HTMLElement,
  renderComment: CommentRenderer,
): () => void {
  el.addClass("zt:flex", "zt:gap-2");
  const swatch = el.createDiv({
    cls: "zt:mt-1 zt:w-1 zt:shrink-0 zt:self-stretch zt:rounded-sm zt:bg-(--zt-annot-color)",
  });
  if (hit.color) swatch.style.setProperty("--zt-annot-color", hit.color);
  const body = el.createDiv({ cls: "zt:min-w-0 zt:flex-1" });
  if (hit.text) appendExcerptText(body, hit.text, "zt:m-0 zt:line-clamp-3");
  const cleanup = hit.comment
    ? renderComment(
        body.createDiv({
          cls: hit.text
            ? "zt:line-clamp-2 zt:text-sm zt:text-muted-foreground"
            : "zt:line-clamp-3",
        }),
        hit.comment,
      )
    : () => {};
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
  return cleanup;
}
