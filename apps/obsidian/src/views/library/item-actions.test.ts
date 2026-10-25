// @vitest-environment happy-dom
// Insert citation from a Library View row goes to the note the researcher was
// in last, which Obsidian no longer names once the Library View tab is active.
import { MarkdownView } from "obsidian";
import { TFile } from "obsidian";
import type {
  App,
  Editor,
  MarkdownFileInfo,
  Workspace,
  WorkspaceLeaf,
} from "obsidian";
import { afterEach, expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { CitationLookupAnswer } from "@/services/citation-index/lookup";
import {
  inProcessReadsService,
  memoryOpener,
  seedWorksSql,
} from "@/services/zotero-reads/test-utils";
import { stateEditor } from "@/views/annot-view/__fixtures__/editor";

import { itemActions } from "./item-actions";
import type { ItemActionsDeps } from "./item-actions";

const KEY = "ABCD2345";

let cleanup = new AsyncDisposableStack();
afterEach(async () => {
  await cleanup.disposeAsync();
  cleanup = new AsyncDisposableStack();
});

/** A tab of the workspace: a note, in `mode`, or the Library View. */
interface Tab {
  leaf: WorkspaceLeaf;
  text: () => string;
}

function workspaceFixture() {
  const open: WorkspaceLeaf[] = [];
  let active: WorkspaceLeaf | null = null;
  /**
   * As Obsidian keeps them, across plugin reloads: the file of the last
   * active tab that showed one, and the files left before it, newest first.
   */
  let activeFile: string | null = null;
  const lastOpen: string[] = [];
  /** Obsidian's file-open: the file `leaf` shows, if any, is the active file. */
  const fileOpen = (leaf: WorkspaceLeaf) => {
    const path = (leaf.view as Partial<MarkdownView>).file?.path;
    if (!path || path === activeFile) return;
    if (activeFile)
      lastOpen.splice(
        0,
        lastOpen.length,
        activeFile,
        ...lastOpen.filter((held) => held !== activeFile && held !== path),
      );
    activeFile = path;
  };
  const workspace = stubService<Workspace>("Workspace", {
    getActiveFile: () => {
      if (activeFile === null) return null;
      const file = new TFile();
      file.path = activeFile;
      return file;
    },
    getLastOpenFiles: () => [...lastOpen],
    get activeEditor() {
      return active?.view instanceof MarkdownView ? active.view : null;
    },
    getMostRecentLeaf: () => active,
    // As Obsidian's, the iteration stops at a callback that returns a truthy
    // value.
    iterateAllLeaves: (callback: (leaf: WorkspaceLeaf) => unknown) =>
      open.some((leaf) => callback(leaf)),
    // The row actions here change no tab while an insert is held.
    on: () => ({}),
    offref: () => {},
  });
  /** The researcher makes `tab` the active tab. */
  const activate = (tab: Tab) => {
    active = tab.leaf;
    fileOpen(tab.leaf);
  };
  /** `tab` shows `view`, as a tab does that opens a note. */
  const show = (tab: Tab, view: WorkspaceLeaf["view"]) => {
    Object.assign(tab.leaf, { view });
    if (active === tab.leaf) fileOpen(tab.leaf);
  };
  /** A note at `path`, in Source mode or Reading view. */
  const note = (path: string, mode: "source" | "preview" = "source"): Tab => {
    const cm = stateEditor({ doc: "LEFT RIGHT" });
    const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {});
    const file = new TFile();
    file.path = path;
    const view = Object.assign(new MarkdownView(leaf), {
      file,
      editor: stubService<Editor>("Editor", { cm }),
      getMode: () => mode,
      getViewType: () => "markdown",
    });
    leaf.view = view;
    Object.assign(view, { leaf });
    open.push(leaf);
    return { leaf, text: () => cm.state.doc.toString() };
  };
  const library: Tab = {
    leaf: stubService<WorkspaceLeaf>("WorkspaceLeaf", {
      view: stubService<WorkspaceLeaf["view"] & { file: null }>("View", {
        file: null,
        getViewType: () => "zotlit-library",
      }),
    }),
    text: () => "",
  };
  open.push(library.leaf);
  /** The researcher closes `tab`. */
  const close = (tab: Tab) => {
    open.splice(open.indexOf(tab.leaf), 1);
  };
  return { workspace, activate, show, note, library, close };
}

/**
 * The row actions, made once `before` has set up the workspace, as a plugin
 * that loads into tabs the researcher already had open.
 */
function setup(
  before: (fixture: ReturnType<typeof workspaceFixture>) => void = () => {},
) {
  const fixture = workspaceFixture();
  before(fixture);
  const app = stubService<App>("App", { workspace: fixture.workspace });
  const notify = vi.fn();
  const record = vi.fn();
  const reads = cleanup.use(
    inProcessReadsService(
      memoryOpener(() =>
        seedWorksSql([{ itemID: 1, key: KEY, citationKey: "vaswani2017" }]),
      ).open,
    ),
  );
  const lookup = new CitationLookupAnswer({
    revision: "test",
    citekeys: new Map([
      [
        "vaswani2017",
        {
          kind: "unique",
          item: {
            itemID: 1,
            libraryID: 1,
            key: KEY,
            indexedKey: KEY,
          },
        },
      ],
    ]),
    indexedKeys: new Map([[KEY, "vaswani2017"]]),
    annotationKeys: new Map(),
  });
  const readyStatus: ItemActionsDeps["citationLookup"]["status"] = "fresh";
  const actions = itemActions(
    stubService<ItemActionsDeps>("ItemActionsDeps", {
      app,
      notify,
      reads,
      citationLookup: stubService<ItemActionsDeps["citationLookup"]>(
        "CitationLookup",
        {
          status: readyStatus,
          read: () => Promise.resolve(lookup),
        },
      ),
      noteFeature: stubService<ItemActionsDeps["noteFeature"]>("NoteFeature", {
        renderCitation: (cites: { citationKey: string }[]) =>
          cites.map(({ citationKey }) => `[@${citationKey}]`).join(""),
      }),
      useLedger: stubService<ItemActionsDeps["useLedger"]>("UseLedger", {
        record,
      }),
    }),
  );
  return { ...fixture, actions, notify, record };
}

it("inserts a row's citation into the note active last before the Library View, and into the one before once that closes", async () => {
  const env = setup();
  const first = env.note("First.md");
  const second = env.note("Second.md");
  env.activate(first);
  env.activate(second);
  env.activate(env.library);

  await env.actions.insertCitation(KEY);
  expect(second.text()).toBe("[@vaswani2017]LEFT RIGHT");
  expect(first.text()).toBe("LEFT RIGHT");
  expect(env.record).toHaveBeenCalledExactlyOnceWith(KEY, "cited");

  env.close(second);
  await env.actions.insertCitation(KEY);
  expect(first.text()).toBe("[@vaswani2017]LEFT RIGHT");
  expect(env.record).toHaveBeenCalledTimes(2);
});

it("inserts into the note that was active last before the plugin loaded", async () => {
  let draft!: Tab;
  const env = setup((fixture) => {
    const other = fixture.note("Other.md");
    draft = fixture.note("Draft.md");
    fixture.activate(other);
    fixture.activate(draft);
    fixture.activate(fixture.library);
  });

  await env.actions.insertCitation(KEY);
  expect(draft.text()).toBe("[@vaswani2017]LEFT RIGHT");
});

it("inserts into a new tab that became active before it opened its note", async () => {
  const env = setup();
  const earlier = env.note("Earlier.md");
  env.activate(earlier);
  // A new tab is active while it is empty, then opens the note.
  const fresh = env.note("Fresh.md");
  const view = fresh.leaf.view;
  env.show(
    fresh,
    stubService<WorkspaceLeaf["view"] & { file: null }>("View", {
      file: null,
      getViewType: () => "empty",
    }),
  );
  env.activate(fresh);
  env.show(fresh, view);
  env.activate(env.library);

  await env.actions.insertCitation(KEY);
  expect(fresh.text()).toBe("[@vaswani2017]LEFT RIGHT");
  expect(earlier.text()).toBe("LEFT RIGHT");
});

it("passes over a note in Reading view, which shows no editor, and says where it finds no note", async () => {
  const env = setup();
  const editing = env.note("Editing.md");
  const reading = env.note("Reading.md", "preview");
  env.activate(editing);
  env.activate(reading);
  env.activate(env.library);

  await env.actions.insertCitation(KEY);
  expect(editing.text()).toBe("[@vaswani2017]LEFT RIGHT");

  env.close(editing);
  await env.actions.insertCitation(KEY);
  expect(reading.text()).toBe("LEFT RIGHT");
  expect(env.notify).toHaveBeenCalledExactlyOnceWith(
    m.library_view_cite_no_note(),
  );
});

it("parts a dropped or inserted citation from the word before it with a space, and adds none at a line start", async () => {
  const env = setup();
  const draft = env.note("Draft.md");
  env.activate(draft);
  env.activate(env.library);
  const view = draft.leaf.view as MarkdownView;
  const target = (at: number) => ({
    editor: view.editor,
    info: view as MarkdownFileInfo,
    at,
  });

  // Dropped right after LEFT.
  await env.actions.insertCitation(KEY, target(4));
  expect(draft.text()).toBe("LEFT [@vaswani2017] RIGHT");
  // Dropped at the start of the line.
  await env.actions.insertCitation(KEY, target(0));
  expect(draft.text()).toBe("[@vaswani2017]LEFT [@vaswani2017] RIGHT");
  // Inserted at the cursor, at the end of the line.
  const { cm } = view.editor;
  cm.dispatch({ selection: { anchor: cm.state.doc.length } });
  await env.actions.insertCitation(KEY);
  expect(draft.text()).toBe(
    "[@vaswani2017]LEFT [@vaswani2017] RIGHT [@vaswani2017]",
  );
  expect(env.record).toHaveBeenCalledTimes(3);
  expect(env.record).toHaveBeenLastCalledWith(KEY, "cited");
});

it("records no citation when the destination changes under an asynchronous row insert", async () => {
  const env = setup();
  const draft = env.note("Draft.md");
  env.activate(draft);
  env.activate(env.library);

  const insert = env.actions.insertCitation(KEY);
  (draft.leaf.view as MarkdownView).editor.cm.dispatch({
    changes: { from: 0, to: 0, insert: "changed " },
  });
  await insert;

  expect(draft.text()).toBe("changed LEFT RIGHT");
  expect(env.record).not.toHaveBeenCalled();
});

it("records a copied citation key only after the clipboard accepts it", async () => {
  const env = setup();
  const write = vi.spyOn(navigator.clipboard, "writeText");
  write.mockResolvedValueOnce();

  await env.actions.copyCitationKey(KEY);

  expect(write).toHaveBeenCalledExactlyOnceWith("vaswani2017");
  expect(env.record).toHaveBeenCalledExactlyOnceWith(KEY, "cited");

  write.mockRejectedValueOnce(new Error("Clipboard unavailable"));
  await env.actions.copyCitationKey(KEY);

  expect(env.record).toHaveBeenCalledTimes(1);
});
