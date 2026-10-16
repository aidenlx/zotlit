// The Query Block: a ` ```zotquery ` code block in a note that holds a Query
// File's text and shows it as the one Query View, with `this` bound as for an
// embed (see `note-host.ts`). A change in the view rewrites the block text only
// (see `block-write.ts`).
//
// The block saves to the note that holds it, also through a section embed or a
// hover popover. Where it has no save path (print, export, an Annotation
// comment), the view still reads and its toolbar says a change is not saved.
// A note preview shows a placeholder (see `preview-placeholder.ts`). Inside a
// Query View, a block shows its text only, so a Query View never holds another
// live one.
//
// @see apps/obsidian/docs/adr/0068-query-files-are-a-zotlit-file-type-embedded-through-the-private-embed-registry.md
import { MarkdownRenderChild } from "obsidian";
import type { MarkdownPostProcessorContext, Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";

import { writeBlockAt, writeBlockCode } from "./block-write";
import { NoteQueryHost } from "./note-host";
import { inPreview, renderPreviewPlaceholder } from "./preview-placeholder";
import { QUERY_FILE_EXTENSION } from "./query-file";
import type { QueryViewDeps } from "./view";

/** A Query View: a block in one of its cards' comments shows its text only. */
const IN_QUERY_VIEW = ".zt-query-view";
/** An Annotation comment, which gives a block no place to save to. */
const IN_COMMENT = ".zt-annot-comment";

type QueryBlockPlugin = Pick<Plugin, "registerMarkdownCodeBlockProcessor">;

export function registerQueryBlock(
  plugin: QueryBlockPlugin,
  deps: QueryViewDeps,
): void {
  plugin.registerMarkdownCodeBlockProcessor(
    QUERY_FILE_EXTENSION,
    (source, el, ctx) => {
      const block = new QueryBlock(el, deps, { ctx, source });
      ctx.addChild(block);
      // Export to PDF waits for this promise before it prints the note.
      return block.shown;
    },
  );
}

class QueryBlock extends MarkdownRenderChild {
  readonly #deps: QueryViewDeps;
  readonly #ctx: MarkdownPostProcessorContext;
  /** The block text as the note holds it, as this block last read or wrote it. */
  #source: string;
  #host: NoteQueryHost | null = null;
  /**
   * The line the block's opening fence stood at, as the block last found it
   * on the page; `null` while it has had no place in a note.
   */
  #lineStart: number | null = null;
  /** Whether the block is leaving the page, as its note closes or shows another file. */
  #leaving = false;

  constructor(
    el: HTMLElement,
    deps: QueryViewDeps,
    { ctx, source }: { ctx: MarkdownPostProcessorContext; source: string },
  ) {
    super(el);
    this.#deps = deps;
    this.#ctx = ctx;
    this.#source = source;
  }

  override onload(): void {
    if (this.containerEl.closest(IN_QUERY_VIEW) !== null) {
      this.containerEl.createEl("pre").createEl("code", { text: this.#source });
      return;
    }
    if (inPreview(this.containerEl)) {
      renderPreviewPlaceholder(this.containerEl, null);
      return;
    }
    const sourcePath = this.#ctx.sourcePath;
    const host = new NoteQueryHost(this.#deps, {
      el: this.containerEl,
      sourcePath: () => sourcePath,
      storage: {
        save: (text) => this.#save(text),
        canSave: () => this.#canSave(),
      },
    });
    this.addChild(host);
    host.setText(this.#source);
    this.#host = host;
  }

  /**
   * The block leaves the page. Its view saves a typed change that waits for
   * its delay as it unloads, which writes at the line the block last stood
   * at: the editor it stood in may already show another note.
   */
  override unload(): void {
    this.#leaving = true;
    super.unload();
  }

  /** Settles once the block shows its first rows, or its text only. Never rejects. */
  get shown(): Promise<void> {
    return this.#host?.shown() ?? Promise.resolve();
  }

  /**
   * Whether a change saves: the block stands in its own note, or stood there
   * as it leaves the page. A section embed, a popover, a print and a
   * Markdown render outside a note give it no place.
   */
  #canSave(): boolean {
    if (this.#leaving) return this.#lineStart !== null;
    const el = this.containerEl;
    if (el.closest(IN_COMMENT) !== null) return false;
    const info = this.#ctx.getSectionInfo(el);
    if (info !== null) this.#lineStart = info.lineStart;
    return info !== null;
  }

  async #save(file: string): Promise<void> {
    // The closing fence takes the place of the file's last line break.
    const text = file.replace(/\n$/, "");
    const previous = this.#source;
    if (text === previous) return;
    this.#source = text;
    try {
      const edit = { previous, next: text };
      if (this.#leaving && this.#lineStart !== null)
        await writeBlockAt(
          this.#deps.app,
          { sourcePath: this.#ctx.sourcePath, lineStart: this.#lineStart },
          edit,
        );
      else
        await writeBlockCode(
          this.#deps.app,
          { ctx: this.#ctx, el: this.containerEl },
          edit,
        );
    } catch (error) {
      this.#source = previous;
      new BaseNotice(m.query_block_save_failed());
      throw error;
    }
  }
}
