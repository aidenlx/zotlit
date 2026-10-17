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
import { LastNote } from "./last-note";

const KEY = "ABCD2345";

/** A tab of the workspace: a note, in `mode`, or the Library View. */
interface Tab {
  leaf: WorkspaceLeaf;
  text: () => string;
}

function workspaceFixture() {
  const listeners = new Set<(leaf: WorkspaceLeaf | null) => void>();
  const open: WorkspaceLeaf[] = [];
  let active: WorkspaceLeaf | null = null;
  const workspace = {
    get activeEditor() {
      return active?.view instanceof MarkdownView ? active.view : null;
    },
    getMostRecentLeaf: () => active,
    // As Obsidian's, the iteration stops at a callback that returns a truthy
    // value.
    iterateAllLeaves: (callback: (leaf: WorkspaceLeaf) => unknown) =>
      open.some((leaf) => callback(leaf)),
    onLayoutReady: (callback: () => void) => callback(),
    on: (
      _event: "active-leaf-change",
      cb: (leaf: WorkspaceLeaf | null) => void,
    ) => {
      listeners.add(cb);
      return cb;
    },
    offref: (cb: (leaf: WorkspaceLeaf | null) => void) => listeners.delete(cb),
  };
  /** The researcher makes `tab` the active tab. */
  const activate = (tab: Tab) => {
    active = tab.leaf;
    for (const cb of listeners) cb(tab.leaf);
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
  return { workspace, activate, note, library, close, listeners };
}

function setup() {
  const fixture = workspaceFixture();
  const app = { workspace: fixture.workspace } as unknown as App;
  using stack = new DisposableStack();
  const lastNote = stack.use(new LastNote(app.workspace));
  const notify = vi.fn();
  const actions = itemActions({
    app,
    lastNote,
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
  const tracking = stack.move();
  return {
    ...fixture,
    actions,
    notify,
    [Symbol.dispose]: () => tracking.dispose(),
  };
}

it("inserts a row's citation into the note active last before the Library View, and into the one before once that closes", async () => {
  using env = setup();
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

it("inserts into a new tab that became active before it opened its note", async () => {
  using env = setup();
  const earlier = env.note("Earlier.md");
  env.activate(earlier);
  // A new tab is active while it is empty, then opens the note.
  const fresh = env.note("Fresh.md");
  const view = fresh.leaf.view;
  Object.assign(fresh.leaf, { view: { getViewType: () => "empty" } });
  env.activate(fresh);
  Object.assign(fresh.leaf, { view });
  env.activate(env.library);

  await env.actions.insertCitation(KEY);
  expect(fresh.text()).toBe("[@vaswani2017]LEFT RIGHT");
  expect(earlier.text()).toBe("LEFT RIGHT");
});

it("passes over a note in Reading view, which shows no editor, and says where it finds no note", async () => {
  using env = setup();
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

it("stops following the workspace once disposed", () => {
  const env = setup();
  expect(env.listeners.size).toBe(1);
  env[Symbol.dispose]();
  expect(env.listeners.size).toBe(0);
});
