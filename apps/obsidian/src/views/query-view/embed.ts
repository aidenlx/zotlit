// The Query File embed: `![[file.zotquery]]` and `![[file.zotquery#View]]` in
// a note, in Reading view, Live Preview and a hover popover. It mounts the one
// Query View, whose `this` is the Item of the embedding note's `zotero-key`.
// A toolbar change saves to the file; every embed and open tab of the file
// reads the new text. In a preview the embed shows a placeholder (see
// `preview-placeholder.ts`).
//
// @see apps/obsidian/docs/adr/0068-query-files-are-a-zotlit-file-type-embedded-through-the-private-embed-registry.md
import { Component, Keymap } from "obsidian";
import type { App, EventRef, TFile } from "obsidian";

import { processLiveText, readLiveText } from "@/lib/live-text";
import type {
  EmbedComponent,
  EmbedContext,
  EmbedCreator,
} from "@/lib/obsidian-private/embed-registry";

import { NoteQueryHost } from "./note-host";
import { inPreview, renderPreviewPlaceholder } from "./preview-placeholder";
import type { QueryViewDeps } from "./view";

export class QueryFileEmbed extends Component implements EmbedComponent {
  readonly #app: App;
  readonly #file: TFile;
  /** The view; `null` in a preview, where the embed shows a placeholder. */
  readonly #host: NoteQueryHost | null;
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
    this.#file = file;
    if (inPreview(context.containerEl)) {
      const name =
        viewName === null ? file.basename : `${file.basename} › ${viewName}`;
      renderPreviewPlaceholder(context.containerEl, name);
      this.#host = null;
      return;
    }
    this.#host = new NoteQueryHost(deps, {
      el: context.containerEl,
      sourcePath: () => context.sourcePath,
      storage: {
        // Through an open tab of the file, so the tab shows the change and its
        // own save does not write over it.
        save: (text) => processLiveText(this.#app, this.#file, () => text),
        openFile: (event) => this.#open(event),
      },
    });
    this.#host.selectView(viewName);
  }

  override onload(): void {
    if (this.#host === null) return;
    this.addChild(this.#host);
    const { vault } = this.#app;
    this.#events.push([
      vault,
      vault.on("modify", (changed) => {
        if (changed === this.#file) void this.loadFile();
      }),
    ]);
  }

  override onunload(): void {
    for (const [source, ref] of this.#events) source.offref(ref);
    this.#events.length = 0;
  }

  /**
   * Read the file and show it; Obsidian calls it once the embed is added.
   * It settles once the rows show, as Export to PDF waits for it to print
   * them.
   */
  async loadFile(): Promise<void> {
    const host = this.#host;
    if (host === null) return;
    host.setText(await readLiveText(this.#app, this.#file));
    await host.shown();
  }

  /** Open the Query File at the view the embed shows; Cmd/Ctrl opens a new tab. */
  #open(event: MouseEvent): void {
    const view = this.#host?.viewName ?? null;
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
