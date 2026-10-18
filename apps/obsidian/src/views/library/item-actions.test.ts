// @vitest-environment happy-dom
// Insert citation from a Library View row goes to the note the researcher was
// in last, which Obsidian no longer names once the Library View tab is active.
import { MarkdownView } from "obsidian";
import type { App, Editor, TFile, WorkspaceLeaf } from "obsidian";
import { expect, it, vi } from "vitest";

import { Effect } from "@/lib/effect";
import * as m from "@/lib/i18n/generated/messages";
import { stateEditor } from "@/views/annot-view/__fixtures__/editor";

import { itemActions } from "./item-actions";
import type { ItemActionsDeps } from "./item-actions";

const KEY = "ABCD2345";

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
  const workspace = {
    getActiveFile: () => (activeFile === null ? null : { path: activeFile }),
    getLastOpenFiles: () => [...lastOpen],
    get activeEditor() {
      return active?.view instanceof MarkdownView ? active.view : null;
    },
    getMostRecentLeaf: () => active,
    // As Obsidian's, the iteration stops at a callback that returns a truthy
    // value.
    iterateAllLeaves: (callback: (leaf: WorkspaceLeaf) => unknown) =>
      open.some((leaf) => callback(leaf)),
  };
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
    const view = Object.assign(Object.create(MarkdownView.prototype), {
      file: { path } as TFile,
      editor: { cm } as Editor,
      getMode: () => mode,
      getViewType: () => "markdown",
    }) as MarkdownView;
    const leaf = { view } as unknown as WorkspaceLeaf;
    Object.assign(view, { leaf });
    open.push(leaf);
    return { leaf, text: () => cm.state.doc.toString() };
  };
  const library: Tab = {
    leaf: { view: { getViewType: () => "zotlit-library" } } as WorkspaceLeaf,
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
  const app = { workspace: fixture.workspace } as unknown as App;
  const notify = vi.fn();
  const actions = itemActions({
    app,
    notify,
    reads: {
      acquireRead: () =>
        Promise.resolve({
          reads: {
            ItemsByIndexedKeys: () =>
              Effect.succeed(
                new Map([
                  [KEY, { key: KEY, fields: { citationKey: "vaswani2017" } }],
                ]),
              ),
          },
          [Symbol.asyncDispose]: () => Promise.resolve(),
        }),
    },
    citationLookup: {
      status: "ready",
      read: () => Promise.resolve({ resolve: () => ({ kind: "unique" }) }),
    },
    noteFeature: {
      renderCitation: (cites: { citationKey: string }[]) =>
        cites.map(({ citationKey }) => `[@${citationKey}]`).join(""),
    },
  } as unknown as ItemActionsDeps);
  return { ...fixture, actions, notify };
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

  env.close(second);
  await env.actions.insertCitation(KEY);
  expect(first.text()).toBe("[@vaswani2017]LEFT RIGHT");
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
  env.show(fresh, { getViewType: () => "empty" } as WorkspaceLeaf["view"]);
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
  const target = (at: number) => ({ editor: view.editor, info: view, at });

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
});
