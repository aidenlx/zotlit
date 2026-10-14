// The Query Block: a ` ```zotquery ` code block in a note that holds a Query
// File's text and shows it as the one Query View. `this` is the Item of the
// note's `zotero-key`, read from the metadata cache of the note, since Live
// Preview hands a code block no frontmatter. A change in the view rewrites the
// block text only (see `block-write.ts`).
//
// The block saves where it stands in its own note. Shown somewhere else (a
// section embed, a popover, an Annotation comment, a note preview), the view
// still reads and its toolbar says a change is not saved. Inside a Query View,
// a block shows its text only, so a Query View never holds another live one.
//
// @see apps/obsidian/docs/adr/0068-query-files-are-a-zotlit-file-type-embedded-through-the-private-embed-registry.md
import { MarkdownRenderChild, Notice, Scope } from "obsidian";
import type { MarkdownPostProcessorContext, Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { itemKeyFromFrontmatter } from "@/services/note-index/service";

import { canWriteBlock, writeBlockCode } from "./block-write";
import { QUERY_FILE_EXTENSION } from "./query-file";
import { QueryView } from "./view";
import type { QueryViewDeps } from "./view";

const logger = getLogger(["views", "query-view", "block"]);

/** A Query View: a block in one of its cards' comments shows its text only. */
const IN_QUERY_VIEW = ".zt-query-view";
/**
 * Where a block shows outside its own note: a section embed, a popover, an
 * Annotation comment, a note preview.
 */
const OUTSIDE_NOTE =
  ".markdown-embed, .hover-popover, .zt-annot-comment, [data-zotlit-draft]";

type QueryBlockPlugin = Pick<Plugin, "registerMarkdownCodeBlockProcessor">;

export function registerQueryBlock(
  plugin: QueryBlockPlugin,
  deps: QueryViewDeps,
): void {
  plugin.registerMarkdownCodeBlockProcessor(
    QUERY_FILE_EXTENSION,
    (source, el, ctx) => {
      ctx.addChild(new QueryBlock(el, deps, { ctx, source }));
    },
  );
}

class QueryBlock extends MarkdownRenderChild {
  readonly #deps: QueryViewDeps;
  readonly #ctx: MarkdownPostProcessorContext;
  /** The block text as the note holds it, as this block last read or wrote it. */
  #source: string;
  #itemKey: string | null = null;

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
    const { app } = this.#deps;
    const sourcePath = this.#ctx.sourcePath;
    this.#itemKey = this.#readItemKey();
    const query = new QueryView(this.#deps, {
      scope: new Scope(app.scope),
      sourcePath: () => sourcePath,
      context: () =>
        this.#itemKey === null ? undefined : { item: this.#itemKey },
      save: (text) => void this.#save(text),
      canSave: () => this.#canSave(),
    });
    this.addChild(query);
    this.containerEl.addClass("zt-root", "interactive-child");
    query.render(this.containerEl);
    query.setText(this.#source);
    // The End-to-end Run reaches the block's view through its element.
    if (__DEV__) Object.assign(this.containerEl, { zotlitQueryView: query });
    // `this` follows the note's `zotero-key`.
    this.registerEvent(
      app.metadataCache.on("changed", (file) => {
        if (file.path !== sourcePath) return;
        const itemKey = this.#readItemKey();
        if (itemKey === this.#itemKey) return;
        this.#itemKey = itemKey;
        query.refresh();
      }),
    );
  }

  /** Whether a change saves: the block stands in its own note. */
  #canSave(): boolean {
    const el = this.containerEl;
    return (
      el.closest(OUTSIDE_NOTE) === null && canWriteBlock({ ctx: this.#ctx, el })
    );
  }

  #readItemKey(): string | null {
    const { app } = this.#deps;
    const file = app.vault.getFileByPath(this.#ctx.sourcePath);
    return file === null
      ? null
      : itemKeyFromFrontmatter(app.metadataCache.getFileCache(file));
  }

  async #save(file: string): Promise<void> {
    if (!this.#canSave()) return;
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
      logger.warn("A Query Block could not save its text", { error });
      new Notice(m.query_block_save_failed());
    }
  }
}
