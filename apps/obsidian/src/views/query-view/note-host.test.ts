// @vitest-environment happy-dom
// A note holds a Query View in two ways: the Query File embed and the Query
// Block. Both bind `this` to the note's Item, take the card keys, keep a click
// from selecting them in Live Preview and settle as Export to PDF waits for
// them. These tests drive each host as Obsidian does: the embed through its
// creator and `loadFile`, the block through its code block processor.
import { resetMockPlatform, setMockPlatform } from "@mock/obsidian";
import { delay } from "@std/async";
import { Stream } from "effect";
import type {
  App,
  EmbedContext,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  Scope,
} from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createObsidianHost } from "@/lib/__fixtures__/obsidian-host";
import { testRuntime } from "@/lib/__fixtures__/runtime";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { effectBridge } from "@/lib/effect-bridge";
import type {
  QueryViewOutcome,
  QueryViewRequest,
} from "@/services/item-query/query-view";
import { annotationReads } from "@/services/pdf-annotation-editor/__fixtures__";
import { fakeQuery } from "@/views/query-view/__fixtures__/query-run";

import { noLiteratureNotes } from "./__fixtures__/literature-notes";
import { registerQueryBlock } from "./block";
import { QueryCardFocus } from "./card-focus";
import { createQueryFileEmbed } from "./embed";
import type { QueryView, QueryViewDeps } from "./view";

vi.mock("zustand", () => import("@/views/__fixtures__/zustand"));

const FILE_PATH = "query-files/Reading.zotquery";
const FILE = `views:
  - type: annotations
    name: Mine
    from: annotations
    filters: item == this.item
`;
const NOTE = (key: string) => `---
zotero-key: ${key}
---
Text
`;

const EMPTY: QueryViewOutcome = {
  kind: "result",
  result: {
    libraries: [{ type: "personal" }],
    query: { filter: null, fields: [], sort: [], limit: null },
    returnedCount: 0,
    matchedCount: 0,
    truncated: false,
    warnings: [],
    rows: [],
  },
};

let cleanup = new DisposableStack();
afterEach(() => {
  cleanup.dispose();
  cleanup = new DisposableStack();
  document.body.replaceChildren();
});

/** A Query View that a note holds, once its host has loaded. */
interface Held {
  el: HTMLElement;
  view: QueryView;
  unload: () => void;
}

type HostKind = "embed" | "block";

function setup(kind: HostKind) {
  setMockPlatform({ isMacOS: true });
  cleanup.defer(resetMockPlatform);
  const host = createObsidianHost({
    [FILE_PATH]: FILE,
    "notes/Lab.md": NOTE("RUGIER24"),
    "notes/Plain.md": "No properties\n",
  });
  /** The keymap's pushed Scopes, the last one on top. */
  const scopes: Scope[] = [];
  const app = stubService<App>("App", {
    vault: host.vault as unknown as App["vault"],
    metadataCache: host.metadataCache as unknown as App["metadataCache"],
    scope: stubService<App["scope"]>("Scope", {}),
    keymap: stubService<App["keymap"]>("Keymap", {
      pushScope: (scope: Scope) => scopes.push(scope),
      popScope: (scope: Scope) => {
        const index = scopes.indexOf(scope);
        if (index !== -1) scopes.splice(index, 1);
      },
    }),
    workspace: Object.assign(host.workspace, {
      getLeaf: vi.fn(),
    }) as unknown as App["workspace"],
  });
  const cardFocus = new QueryCardFocus(app);
  const run = vi.fn((_request: QueryViewRequest, _signal: AbortSignal) =>
    Promise.resolve(EMPTY),
  );
  const runtime = testRuntime();
  const deps = stubService<QueryViewDeps>("QueryViewDeps", {
    runtime,
    bridge: effectBridge(runtime),
    app,
    reads: stubService<QueryViewDeps["reads"]>("ZoteroReads", {
      changed: Stream.empty,
      degraded: Stream.empty,
      "refresh-failed": Stream.empty,
      refreshing: Stream.empty,
      "db-file-missing": Stream.empty,
      "refresh-requested": Stream.empty,
    }),
    libraryScope: stubService<QueryViewDeps["libraryScope"]>("LibraryScope", {
      changed: Stream.empty,
      "libraries-changed": Stream.empty,
    }),
    query: fakeQuery(run),
    cardFocus,
    annotations: stubService<QueryViewDeps["annotations"]>(
      "Annotations",
      annotationReads(),
    ),
    opener: stubService<QueryViewDeps["opener"]>("TargetOpener", {}),
    allowEditing: vi.fn(),
    reportBlockedGesture: vi.fn(),
    libraryTagNames: async () => [],
    zoteroPref: stubService<QueryViewDeps["zoteroPref"]>("ZoteroPref", {
      dataDir: "/Zotero",
      baseAttachmentPath: null,
    }),
    excerptDisplay: stubService<QueryViewDeps["excerptDisplay"]>(
      "ExcerptDisplay",
      { open: vi.fn(), refresh: vi.fn() },
    ),
    noteFeature: stubService<QueryViewDeps["noteFeature"]>("NoteFeature", {}),
    literatureNotes: noLiteratureNotes(),
  });

  type Plugin = Parameters<typeof registerQueryBlock>[0];
  type Processor = Parameters<Plugin["registerMarkdownCodeBlockProcessor"]>[1];
  let processor: Processor | undefined;
  registerQueryBlock(
    {
      registerMarkdownCodeBlockProcessor: (_language, handler) => {
        processor = handler;
        return () => {};
      },
    },
    deps,
  );

  /** The Query View the End-to-end Run reads from the host's element. */
  const viewOf = (el: HTMLElement): QueryView =>
    (el as HTMLElement & { zotlitQueryView: QueryView }).zotlitQueryView;

  /**
   * Show the Query File in the note at `sourcePath`, under `parent`, as
   * Obsidian does. It settles as Export to PDF waits for the host: the
   * embed's `loadFile`, the block's processor.
   */
  function show(sourcePath: string, parent: HTMLElement): Promise<Held> {
    const el = parent.createDiv();
    if (kind === "embed") {
      const context: EmbedContext = {
        app,
        containerEl: el,
        linktext: "Reading.zotquery",
        sourcePath,
        depth: 1,
      };
      const component = createQueryFileEmbed(deps)(
        context,
        host.file(FILE_PATH),
        "",
      );
      component.load();
      const unload = () => component.unload();
      cleanup.defer(() => act(unload));
      return component
        .loadFile()
        .then(() => ({ el, view: viewOf(el), unload }));
    }
    let child: MarkdownRenderChild | undefined;
    // The block has no section to save to, as in a print.
    const ctx = stubService<MarkdownPostProcessorContext>(
      "MarkdownPostProcessorContext",
      {
        sourcePath,
        getSectionInfo: () => null,
        addChild: (added: MarkdownRenderChild) => {
          child = added;
          added.load();
        },
      },
    );
    const shown = processor!(FILE, el, ctx);
    const unload = () => child?.unload();
    cleanup.defer(() => act(unload));
    return Promise.resolve(shown).then(() => ({
      el,
      view: viewOf(el),
      unload,
    }));
  }

  /** Show it in a note on the page, and wait until its rows show. */
  async function hold(sourcePath = "notes/Lab.md"): Promise<Held> {
    let held: Held | undefined;
    await act(async () => {
      held = await show(sourcePath, document.body);
      await held.view.settled;
    });
    return held!;
  }
  /**
   * Show the block `source` under the context `ctx` gives, as Obsidian's
   * code block processor does, and wait until its rows show.
   */
  async function block(
    source: string,
    ctx: Omit<MarkdownPostProcessorContext, "addChild">,
  ): Promise<Held> {
    const el = document.body.createDiv();
    let child: MarkdownRenderChild | undefined;
    await act(async () => {
      const context = stubService<MarkdownPostProcessorContext>(
        "MarkdownPostProcessorContext",
        {
          ...ctx,
          addChild: (added: MarkdownRenderChild) => {
            child = added;
            added.load();
          },
        },
      );
      await processor!(source, el, context);
      await viewOf(el).settled;
    });
    const unload = () => child?.unload();
    cleanup.defer(() => act(unload));
    return { el, view: viewOf(el), unload };
  }
  return { host, run, show, hold, block, scopes, cardFocus };
}

describe.each<HostKind>(["embed", "block"])("a %s", (kind) => {
  it("binds `this.item` to the Item of its note", async () => {
    const { hold, run } = setup(kind);
    await hold("notes/Lab.md");
    expect(run.mock.calls.at(-1)![0].context).toEqual({ item: "RUGIER24" });
    await hold("notes/Plain.md");
    expect(run.mock.calls.at(-1)![0].context).toBeUndefined();
  });

  it("runs again when the note's `zotero-key` changes, and for nothing else", async () => {
    const { hold, run, host } = setup(kind);
    await hold("notes/Lab.md");
    const edit = async (path: string, text: string) => {
      await act(async () => {
        host.vault.modifyFile(path, text);
        await delay(0);
      });
    };
    const runs = run.mock.calls.length;

    await edit("notes/Lab.md", `${NOTE("RUGIER24")}More text\n`);
    await edit("notes/Plain.md", NOTE("OTHERK34"));
    expect(run).toHaveBeenCalledTimes(runs);

    await edit("notes/Lab.md", NOTE("SMITHJ25"));
    expect(run).toHaveBeenCalledTimes(runs + 1);
    expect(run.mock.calls.at(-1)![0].context).toEqual({ item: "SMITHJ25" });

    await edit("notes/Lab.md", "No properties\n");
    expect(run).toHaveBeenCalledTimes(runs + 2);
    expect(run.mock.calls.at(-1)![0].context).toBeUndefined();
  });

  it("settles once the first rows show, as Export to PDF waits for it", async () => {
    const { show, run } = setup(kind);
    const answer = Promise.withResolvers<QueryViewOutcome>();
    run.mockReturnValueOnce(answer.promise);
    const print = document.body.createDiv({ cls: "print" });
    let printed = false;
    let held: Promise<Held> | undefined;
    await act(async () => {
      held = show("notes/Lab.md", print);
      void held.then(() => {
        printed = true;
      });
      await delay(50);
    });
    expect(run).toHaveBeenCalled();
    expect(printed).toBe(false);

    await act(async () => {
      answer.resolve(EMPTY);
      await delay(50);
    });
    // The list draws the rows once the render settles.
    await delay(0);
    expect(printed).toBe(true);
    const { el } = await held!;
    expect(el.querySelector("[data-query-empty]")).not.toBeNull();
  });

  it("keeps a click inside it from selecting it in Live Preview", async () => {
    const { hold } = setup(kind);
    const { el } = await hold();
    expect(el.classList.contains("interactive-child")).toBe(true);
  });

  it("keeps a drag that starts in it from the note's editor, which would drag the note's text", async () => {
    const { hold } = setup(kind);
    const note = document.body.createDiv();
    const { el } = await hold();
    note.append(el);
    const editorDrag = vi.fn();
    note.addEventListener("dragstart", editorDrag);
    const handle = el.createEl("a", { attr: { draggable: "true" } });

    handle.dispatchEvent(new DragEvent("dragstart", { bubbles: true }));
    expect(editorDrag).not.toHaveBeenCalled();
  });

  describe("the card keys", () => {
    /** A control in the view that takes focus as a card does, and is no text field. */
    const control = (el: HTMLElement) => {
      const button = el.querySelector("button");
      if (!button) throw new Error(`The ${kind} shows no button`);
      return button;
    };

    it("are on the keymap while focus is in it, and leave with focus to the note", async () => {
      const { hold, scopes } = setup(kind);
      const { el } = await hold();
      const note = document.body.createEl("textarea");

      control(el).focus();
      expect(scopes).toHaveLength(1);
      note.focus();
      expect(scopes).toEqual([]);
    });

    it("stay off the keymap while focus is in a text field of it", async () => {
      const { hold, scopes } = setup(kind);
      const { el } = await hold();
      const field = el.createEl("input", { type: "text" });

      field.focus();
      expect(scopes).toEqual([]);
    });

    it("leave the keymap when it unloads with focus in it", async () => {
      const { hold, scopes } = setup(kind);
      const { el, unload } = await hold();

      control(el).focus();
      await act(unload);
      expect(scopes).toEqual([]);
    });

    it("let the palette step the view focus was last in, through a modal over it", async () => {
      const { hold, cardFocus } = setup(kind);
      const note = document.body.createDiv();
      const { el, view } = await hold();
      note.append(el);
      const palette = document.body
        .createDiv({ cls: "modal-container" })
        .createEl("input");

      expect(cardFocus.surfaceIn(note)).toBeNull();
      control(el).focus();
      palette.focus();
      expect(cardFocus.surfaceIn(note)).toBe(view);

      control(el).focus();
      note.createEl("textarea").focus();
      expect(cardFocus.surfaceIn(note)).toBeNull();
    });
  });
});

describe("a Query Block that leaves the page", () => {
  const PATH = "notes/Lab.md";
  const SOURCE = `${FILE}    limit: 100`;
  const BLOCK_NOTE = `${NOTE("RUGIER24")}\n\`\`\`zotquery\n${SOURCE}\n\`\`\`\n\nAfter the block.\n`;
  /** The opening fence's line in {@link BLOCK_NOTE}. */
  const LINE_START = 5;

  /**
   * A block on the page until it unloads, as in Reading view and Live
   * Preview: its section, while it stands there, and Live Preview's own
   * `replaceCode`, which writes into an editor that no longer shows the note
   * once the block has left it.
   */
  async function leaving({ replaceCode }: { replaceCode?: () => void }) {
    const { block, host } = setup("block");
    host.vault.modifyFile(PATH, BLOCK_NOTE);
    let onPage = true;
    const ctx: Omit<MarkdownPostProcessorContext, "addChild"> = {
      docId: "doc",
      sourcePath: PATH,
      frontmatter: {},
      getSectionInfo: () =>
        onPage
          ? { text: BLOCK_NOTE, lineStart: LINE_START, lineEnd: LINE_START + 7 }
          : null,
      ...(replaceCode && { replaceCode }),
    };
    const held = await block(SOURCE, ctx);
    return {
      host,
      held,
      leave: async () => {
        onPage = false;
        await act(async () => {
          held.unload();
          await delay(0);
        });
      },
    };
  }

  it("in Reading view, saves a limit typed just before it left", async () => {
    const { host, held, leave } = await leaving({});
    await act(() => held.view.document.editView({ limit: 3 }, { typed: true }));
    await leave();
    expect(host.text(PATH)).toBe(BLOCK_NOTE.replace("limit: 100", "limit: 3"));
  });

  it("in Live Preview, saves a limit typed just before it left into its note, not into the editor it left", async () => {
    const replaceCode = vi.fn();
    const { host, held, leave } = await leaving({ replaceCode });
    await act(() => held.view.document.editView({ limit: 3 }, { typed: true }));
    await leave();
    expect(replaceCode).not.toHaveBeenCalled();
    expect(host.text(PATH)).toBe(BLOCK_NOTE.replace("limit: 100", "limit: 3"));
  });

  it("saves nothing where the note's text at its line changed meanwhile", async () => {
    const { host, held, leave } = await leaving({});
    await act(() => held.view.document.editView({ limit: 3 }, { typed: true }));
    const moved = `Inserted above.\n${BLOCK_NOTE}`;
    host.vault.modifyFile(PATH, moved);
    await leave();
    expect(host.text(PATH)).toBe(moved);
  });
});
