// @vitest-environment happy-dom
// Insert citation from a Library View row goes to the note the researcher was
// in last, which Obsidian no longer names once the Library View tab is active.
import { it as effectIt } from "@effect/vitest";
import { Effect, Layer, DateTime } from "effect";
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

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import type { ViewRegistryHandle } from "@/lib/view-atoms";
import { CitationLookupAnswer } from "@/services/citation-index/lookup";
import { CitationLookup } from "@/services/citation-index/lookup-service";
import { UseLedger } from "@/services/use-ledger/service";
import { ZoteroReads } from "@/services/zotero-reads/service";
import {
  inProcessReadsService,
  memoryOpener,
  seedWorksSql,
} from "@/services/zotero-reads/test-utils";
import { stateEditor } from "@/views/annot-view/__fixtures__/editor";
import { waitFor } from "@/views/welcome/__fixtures__";

import { makeLibraryHost } from "./__fixtures__";
import { libraryItemCommand, itemActions } from "./item-actions";
import type { CitationTarget, ItemActionsDeps } from "./item-actions";

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
async function setup(
  before: (fixture: ReturnType<typeof workspaceFixture>) => void = () => {},
) {
  const fixture = workspaceFixture();
  before(fixture);
  const app = stubService<App>("App", { workspace: fixture.workspace });
  const record = vi.fn();
  const notifier = testNotifier();
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

  const host = cleanup.use(
    await makeLibraryHost({
      services: Layer.mergeAll(
        notifier.layer,
        Layer.mock(ZoteroReads, {
          reads: reads.reads,
          snapshot: Effect.succeed(reads.reads),
        }),
        Layer.mock(CitationLookup, {
          current: Effect.succeed({
            status: "fresh" as const,
            revision: "test",
            stopped: false,
          }),
          read: () => Effect.succeed(lookup),
        }),
        Layer.mock(UseLedger, {
          record: (key, kind) =>
            Effect.sync(() => {
              record(key, kind);
              return { kind, instant: DateTime.makeUnsafe("2025-01-01") };
            }),
        }),
      ),
    }),
  );
  cleanup.defer(host.registry.mount(libraryItemCommand));
  const raw = itemActions(
    stubService<ItemActionsDeps>("ItemActionsDeps", {
      app,
      registry: host.registry,
      noteFeature: stubService<ItemActionsDeps["noteFeature"]>(
        "NoteFeatureHandle",
        {
          renderCitation: (cites: { citationKey: string }[]) =>
            cites.map(({ citationKey }) => `[@${citationKey}]`).join(""),
        },
      ),
    }),
  );
  // Each gesture runs on the registry; the test waits for the commands to finish.
  const settle =
    <A extends unknown[]>(gesture: (...args: A) => void) =>
    async (...args: A) => {
      gesture(...args);
      await idle(host.registry);
    };
  const actions = {
    insertCitation: settle((key: string, target?: CitationTarget) =>
      raw.insertCitation(key, target),
    ),
    copyCitationKey: settle((key: string) => raw.copyCitationKey(key)),
  };
  return { ...fixture, raw, actions, record, notifier, host };
}

/** Settles once no Item action runs on `registry`. */
const idle = (registry: ViewRegistryHandle) =>
  waitFor(() => expect(registry.get(libraryItemCommand).waiting).toBe(false));

it("inserts a row's citation into the note active last before the Library View, and into the one before once that closes", async () => {
  const env = await setup();
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
  const env = await setup((fixture) => {
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
  const env = await setup();
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

it("passes over a note in Reading view, which shows no editor, and inserts nowhere where it finds no note", async () => {
  const env = await setup();
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
  expect(env.record).toHaveBeenCalledTimes(1);
});

it("parts a dropped or inserted citation from the word before it with a space, and adds none at a line start", async () => {
  const env = await setup();
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
  const env = await setup();
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
  const env = await setup();
  const write = vi.spyOn(navigator.clipboard, "writeText");
  write.mockResolvedValueOnce();

  await env.actions.copyCitationKey(KEY);

  expect(write).toHaveBeenCalledExactlyOnceWith("vaswani2017");
  expect(env.record).toHaveBeenCalledExactlyOnceWith(KEY, "cited");

  write.mockRejectedValueOnce(new Error("Clipboard unavailable"));
  await env.actions.copyCitationKey(KEY);

  expect(env.record).toHaveBeenCalledTimes(1);
  expect(env.notifier.notices.map((notice) => notice.messages)).toEqual([
    [m.graph_citations_citekey_copied()],
    [m.graph_citations_citekey_copy_failed()],
  ]);
});

effectIt.effect(
  "each item command releases its resources when it finishes",
  () =>
    Effect.gen(function* () {
      const host = yield* Effect.acquireDisposable(
        Effect.promise(() => makeLibraryHost()),
      );
      const stop = host.registry.mount(libraryItemCommand);
      yield* Effect.addFinalizer(() => Effect.sync(stop));
      const released = vi.fn();
      host.registry.set(
        libraryItemCommand,
        Effect.acquireRelease(Effect.void, () => Effect.sync(released)),
      );
      yield* Effect.promise(() => idle(host.registry));
      expect(released).toHaveBeenCalledTimes(1);
    }),
);

effectIt.effect(
  "a second item command keeps a pending command's resource open",
  () =>
    Effect.gen(function* () {
      const host = yield* Effect.acquireDisposable(
        Effect.promise(() => makeLibraryHost()),
      );
      const stop = host.registry.mount(libraryItemCommand);
      yield* Effect.addFinalizer(() => Effect.sync(stop));
      const started = Promise.withResolvers<void>();
      const finish = Promise.withResolvers<void>();
      const released = vi.fn();
      const second = vi.fn();
      host.registry.set(
        libraryItemCommand,
        Effect.gen(function* () {
          yield* Effect.acquireRelease(Effect.void, () =>
            Effect.sync(released),
          );
          started.resolve();
          yield* Effect.promise(() => finish.promise);
        }),
      );
      yield* Effect.promise(() => started.promise);
      host.registry.set(libraryItemCommand, Effect.sync(second));
      yield* Effect.promise(() =>
        waitFor(() => expect(second).toHaveBeenCalledOnce()),
      );
      expect(released).not.toHaveBeenCalled();
      finish.resolve();
      yield* Effect.promise(() => idle(host.registry));
      expect(released).toHaveBeenCalledTimes(1);
    }),
);

it("does not show a clipboard outcome after the registry closes", async () => {
  const env = await setup();
  const started = Promise.withResolvers<void>();
  const copied = Promise.withResolvers<void>();
  vi.spyOn(navigator.clipboard, "writeText").mockImplementationOnce(() => {
    started.resolve();
    return copied.promise;
  });
  env.raw.copyCitationKey(KEY);
  await started.promise;
  await env.host.close();
  copied.resolve();
  await copied.promise;
  expect(env.notifier.notices).toEqual([]);
  expect(env.record).not.toHaveBeenCalled();
});

it("shows the missing citation destination through Notifier", async () => {
  const env = await setup();
  await env.actions.insertCitation(KEY);
  expect(env.notifier.notices.map((notice) => notice.messages)).toEqual([
    [m.library_view_cite_no_note()],
  ]);
});
