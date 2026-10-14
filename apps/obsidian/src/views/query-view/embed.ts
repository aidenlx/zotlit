// The Query File embed: `![[file.zotquery]]` and `![[file.zotquery#View]]` in
// a note, in Reading view, Live Preview and a hover popover. It mounts the one
// Query View, whose `this` is the Item of the embedding note's `zotero-key`.
// A toolbar change saves to the file; every embed and open tab of the file
// reads the new text.
//
// @see apps/obsidian/docs/adr/0068-query-files-are-a-zotlit-file-type-embedded-through-the-private-embed-registry.md
import { Component, debounce, Keymap, Scope, TFile } from "obsidian";
import type { App, Debouncer, EventRef } from "obsidian";

import type { QueryContext } from "@zotlit/item-query";

import { processLiveText, readLiveText } from "@/lib/live-text";
import { getLogger } from "@/lib/log";
import type {
  EmbedComponent,
  EmbedContext,
  EmbedCreator,
} from "@/lib/obsidian-private/embed-registry";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";

import { QueryView } from "./view";
import type { QueryViewDeps } from "./view";

const logger = getLogger(["views", "query-view", "embed"]);

/** How long the embed waits after a toolbar change before it writes the file. */
const SAVE_DELAY_MS = 500;

export class QueryFileEmbed extends Component implements EmbedComponent {
  readonly query: QueryView;
  readonly #app: App;
  readonly #context: EmbedContext;
  readonly #file: TFile;
  /** The text the view shows, so the embed's own save does not run it twice. */
  #text: string | null = null;
  /** The Item key `this` reads, as the embedding note's Properties give it. */
  #item: string | null;
  readonly #save: Debouncer<[string], Promise<void>>;
  #pending: Promise<void> = Promise.resolve();
  readonly #events: [{ offref(ref: EventRef): void }, EventRef][] = [];

  constructor(
    deps: QueryViewDeps,
    {
      context,
      file,
      viewName,
    }: {
      context: EmbedContext;
      file: TFile;
      /** The view the link names; the first view for `null`. */
      viewName: string | null;
    },
  ) {
    super();
    this.#app = deps.app;
    this.#context = context;
    this.#file = file;
    this.#item = this.#readItem();
    this.#save = debounce(
      (text: string) => (this.#pending = this.#write(text)),
      SAVE_DELAY_MS,
      true,
    );
    context.containerEl.addClass("zt-root", "interactive-child");
    this.query = new QueryView(deps, {
      scope: new Scope(deps.app.scope),
      sourcePath: () => context.sourcePath,
      context: (): QueryContext | undefined =>
        this.#item === null ? undefined : { item: this.#item },
      save: (text) => {
        this.#text = text;
        this.#save(text);
      },
      openFile: (event) => this.#open(event),
    });
    this.query.selectView(viewName);
  }

  override onload(): void {
    this.addChild(this.query);
    this.query.render(this.#context.containerEl);
    const { vault, metadataCache } = this.#app;
    this.#events.push([
      vault,
      vault.on("modify", (changed) => {
        if (changed === this.#file) void this.loadFile();
      }),
    ]);
    this.#events.push([
      metadataCache,
      metadataCache.on("changed", (changed) => {
        if (changed.path !== this.#context.sourcePath) return;
        const item = this.#readItem();
        if (item === this.#item) return;
        this.#item = item;
        this.query.refresh();
      }),
    ]);
  }

  override onunload(): void {
    for (const [source, ref] of this.#events) source.offref(ref);
    this.#events.length = 0;
    void this.flush();
  }

  /** Read the file and show it; Obsidian calls it once the embed is added. */
  async loadFile(): Promise<void> {
    const text = await readLiveText(this.#app, this.#file);
    if (text === this.#text) return;
    this.#text = text;
    this.query.setText(text);
  }

  /** Write a toolbar change that waits for its delay now. */
  flush(): Promise<void> {
    void this.#save.run();
    return this.#pending;
  }

  async #write(text: string): Promise<void> {
    try {
      // Through an open tab of the file, so the tab shows the change and its
      // own save does not write over it.
      await processLiveText(this.#app, this.#file, () => text);
    } catch (error) {
      logger.warn("A Query File embed could not save the file", {
        error,
        path: this.#file.path,
      });
    }
  }

  #readItem(): string | null {
    const note = this.#app.vault.getAbstractFileByPath(
      this.#context.sourcePath,
    );
    if (!(note instanceof TFile)) return null;
    return itemKeyFromFrontmatter(this.#app.metadataCache.getFileCache(note));
  }

  /** Open the Query File at the view the embed shows; Cmd/Ctrl opens a new tab. */
  #open(event: MouseEvent): void {
    const view = this.query.viewName;
    void this.#app.workspace
      .getLeaf(Keymap.isModEvent(event))
      .openFile(this.#file, {
        active: true,
        state: view === null ? {} : { view },
      });
  }
}

/** The creator Obsidian's embed registry calls for each `![[file.zotquery]]`. */
export function createQueryFileEmbed(
  deps: QueryViewDeps,
): (...args: Parameters<EmbedCreator>) => QueryFileEmbed {
  return (context, file, subpath) =>
    new QueryFileEmbed(deps, {
      context,
      file,
      viewName:
        subpath.startsWith("#") && subpath.length > 1 ? subpath.slice(1) : null,
    });
}
