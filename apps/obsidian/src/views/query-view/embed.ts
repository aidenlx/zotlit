// The Query File embed: `![[file.zotquery]]` and `![[file.zotquery#View]]` in
// a note, in Reading view, Live Preview and a hover popover. It mounts the one
// Query View, whose `this` is the Item of the embedding note's `zotero-key`.
// A toolbar change saves to the file; every embed and open tab of the file
// reads the new text.
//
// @see apps/obsidian/docs/adr/0068-query-files-are-a-zotlit-file-type-embedded-through-the-private-embed-registry.md
import { Component, Keymap, Scope, TFile } from "obsidian";
import type { App, EventRef } from "obsidian";

import type { QueryContext } from "@zotlit/item-query";

import { processLiveText, readLiveText } from "@/lib/live-text";
import type {
  EmbedComponent,
  EmbedContext,
  EmbedCreator,
} from "@/lib/obsidian-private/embed-registry";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";

import { QueryView } from "./view";
import type { QueryViewDeps } from "./view";

export class QueryFileEmbed extends Component implements EmbedComponent {
  readonly query: QueryView;
  readonly #app: App;
  readonly #context: EmbedContext;
  readonly #file: TFile;
  /** The Item key `this` reads, as the embedding note's Properties give it. */
  #item: string | null;
  readonly #events: [{ offref(ref: EventRef): void }, EventRef][] = [];
  readonly #deps: QueryViewDeps;
  readonly #scope: Scope;
  #keys: Disposable | null = null;

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
    this.#deps = deps;
    this.#scope = new Scope(deps.app.scope);
    this.#context = context;
    this.#file = file;
    this.#item = this.#readItem();
    context.containerEl.addClass("zt-root", "interactive-child");
    this.query = new QueryView(deps, {
      scope: this.#scope,
      sourcePath: () => context.sourcePath,
      context: (): QueryContext | undefined =>
        this.#item === null ? undefined : { item: this.#item },
      // Through an open tab of the file, so the tab shows the change and its
      // own save does not write over it.
      save: (text) => processLiveText(this.#app, this.#file, () => text),
      openFile: (event) => this.#open(event),
    });
    this.query.selectView(viewName);
    // e2e-only: packages/e2e reaches the embed from its element to read its
    // Query View. A dev-build port, absent from a production build.
    if (__DEV__) Object.assign(context.containerEl, { zotlitQueryEmbed: this });
  }

  override onload(): void {
    this.addChild(this.query);
    this.query.render(this.#context.containerEl);
    // A card in the embed takes the card keys while it has focus.
    this.#keys = this.#deps.cardFocus.hold(
      this.#context.containerEl,
      this.#scope,
      this.query,
    );
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
    this.#keys?.[Symbol.dispose]();
    this.#keys = null;
  }

  /**
   * Read the file and show it; Obsidian calls it once the embed is added.
   * It settles once the rows show, as Export to PDF waits for it to print
   * them.
   */
  async loadFile(): Promise<void> {
    this.query.setText(await readLiveText(this.#app, this.#file));
    await this.query.shownIn(this.#context.containerEl);
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
