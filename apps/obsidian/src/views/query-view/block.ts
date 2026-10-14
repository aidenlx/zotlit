// The Query Block: a ` ```zotquery ` code block in a note that holds a Query
// File's text and shows it as the one Query View, with `this` bound as for an
// embed (see `note-host.ts`). A change in the view rewrites the block text only
// (see `block-write.ts`).
//
// The block saves to the note that holds it, also through a section embed or a
// hover popover. Where it has no save path (print, export, an Annotation
// comment, a note preview), the view still reads and its toolbar says a change
// is not saved. Inside a Query View, a block shows its text only, so a Query
// View never holds another live one.
//
// @see apps/obsidian/docs/adr/0068-query-files-are-a-zotlit-file-type-embedded-through-the-private-embed-registry.md
import { MarkdownRenderChild } from "obsidian";
import type { MarkdownPostProcessorContext, Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";

import { canWriteBlock, writeBlockCode } from "./block-write";
import { NoteQueryHost } from "./note-host";
import { QUERY_FILE_EXTENSION } from "./query-file";
import type { QueryViewDeps } from "./view";

/** A Query View: a block in one of its cards' comments shows its text only. */
const IN_QUERY_VIEW = ".zt-query-view";
/** Where a block shows as a preview: an Annotation comment, a note preview. */
const IN_PREVIEW = ".zt-annot-comment, [data-zotlit-draft]";

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
    host.query.setText(this.#source);
    this.#host = host;
  }

  /** Settles once the block shows its first rows, or its text only. Never rejects. */
  get shown(): Promise<void> {
    return this.#host?.shown() ?? Promise.resolve();
  }

  /** Whether a change saves: the block stands in its own note. */
  #canSave(): boolean {
    const el = this.containerEl;
    return (
      el.closest(IN_PREVIEW) === null && canWriteBlock({ ctx: this.#ctx, el })
    );
  }

  async #save(file: string): Promise<void> {
    // The closing fence takes the place of the file's last line break.
    const text = file.replace(/\n$/, "");
    const previous = this.#source;
    if (text === previous) return;
    this.#source = text;
    try {
      await writeBlockCode(
        this.#deps.app,
        { ctx: this.#ctx, el: this.containerEl },
        { previous, next: text },
      );
    } catch (error) {
      this.#source = previous;
      new BaseNotice(m.query_block_save_failed());
      throw error;
    }
  }
}
