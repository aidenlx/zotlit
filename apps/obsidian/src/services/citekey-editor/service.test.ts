import { it } from "@effect/vitest";
import { Context, Effect, Fiber, Layer, Stream } from "effect";
import { TFile } from "obsidian";
import { describe, expect } from "vitest";

import type { Item } from "@zotlit/db";

import { layerHostApp } from "@/lib/__fixtures__/obsidian-host-app";
import { FIELD_ZOTERO_KEY } from "@/lib/constants";
import { lookupAnswerFor } from "@/services/citation-index/__fixtures__/lookup";
import type { CitationLookupRequest } from "@/services/citation-index/lookup";
import { CitationLookup } from "@/services/citation-index/lookup-service";
import type { CitekeyResolution } from "@/services/citation-index/service";
import type { AvailableLibrary } from "@/services/library-scope/scope";
import type { ResolvedLibraryScope } from "@/services/library-scope/scope";
import { LibraryScope } from "@/services/library-scope/service";
import { createNoteHost } from "@/services/note-index/__fixtures__";
import { layerNoteIndex } from "@/services/note-index/service";
import {
  layerPluginSettings,
  PluginSettings,
} from "@/services/settings/service";
import { layerRcRef } from "@/services/zotero-reads/connection";
import { layerZoteroReads, ZoteroReads } from "@/services/zotero-reads/service";
import type { ZoteroReadsState } from "@/services/zotero-reads/service";
import {
  inProcessClient,
  memoryOpener,
  seedWorksSql,
} from "@/services/zotero-reads/test-utils";
import type { SeededWork } from "@/services/zotero-reads/test-utils";

import { CitekeyEditor, layerCitekeyEditor } from "./service";
import type { CitekeyEditorEvent, CitekeyNoteCreation } from "./service";

const MY_LIBRARY: AvailableLibrary = {
  selector: { type: "personal" },
  libraryID: 1,
  name: null,
};
const GROUP_LIBRARY: AvailableLibrary = {
  selector: { type: "group", groupID: 7 },
  libraryID: 4,
  name: "Shared group",
};
const BOTH_LIBRARIES: ResolvedLibraryScope = {
  mode: "all",
  invalid: false,
  available: [MY_LIBRARY, GROUP_LIBRARY],
  unavailable: [],
};

interface EditorOptions {
  /** Each Literature Note's path and the Item key it carries. */
  notes?: Record<string, string>;
  /** What each citekey resolves to; any other key is missing. */
  resolutions?: Record<string, CitekeyResolution>;
  /** The Items the database holds. */
  works?: readonly SeededWork[];
  /** The legacy note creation flow. */
  createNote?: CitekeyNoteCreation["createNote"];
  /** The database state the editor reads. */
  readsState?: ZoteroReadsState["state"];
}

/**
 * The Citekey Editor over the real Note Index on an in-memory vault, the real
 * settings and Zotero reads over a fixture database (My Library and the Shared
 * group: group 7, Library 4), and a Citation Lookup that answers from
 * `resolutions`.
 */
const openEditor = Effect.fnUntraced(function* ({
  notes = {},
  resolutions = {},
  works = [],
  createNote = () => Promise.reject(new Error("No note is created")),
  readsState = "ready",
}: EditorOptions = {}) {
  const host = createNoteHost(
    Object.fromEntries(
      Object.entries(notes).map(([path, itemKey]) => [
        path,
        { frontmatter: { [FIELD_ZOTERO_KEY]: itemKey } },
      ]),
    ),
    { enabledAtRuntime: true },
  );
  const { workspace } = host;
  const sql = `${seedWorksSql(works)}
    insert into libraries (libraryID, type) values (4, 'group');
    insert into groups (groupID, libraryID, name) values (7, 4, 'Shared group');`;
  const citekeysRead: string[] = [];
  const lookup = Layer.mock(CitationLookup, {
    read: ({ citekeys = [] }: CitationLookupRequest) =>
      Effect.sync(() => {
        citekeysRead.push(...citekeys);
        return lookupAnswerFor(citekeys, resolutions, "test");
      }),
  });
  // The real reads over the fixture database, in the state the test names.
  const { reads } = Context.get(
    yield* Layer.build(
      layerZoteroReads(
        inProcessClient(layerRcRef(memoryOpener(() => sql).open)),
      ),
    ),
    ZoteroReads,
  );
  const context = yield* Layer.build(
    layerCitekeyEditor({ createNote }).pipe(
      Layer.provide(
        Layer.mergeAll(
          layerNoteIndex,
          Layer.mock(ZoteroReads, {
            reads,
            current: Effect.succeed({
              state: readsState,
              error: null,
              moved: false,
              dbFileMissing: false,
              activeReadMode: null,
            }),
          }),
          lookup,
          Layer.mock(LibraryScope, {
            current: Effect.succeed(BOTH_LIBRARIES),
          }),
        ),
      ),
      Layer.provideMerge(
        layerPluginSettings({
          loadData: () => Promise.resolve(null),
          saveData: () => Promise.resolve(),
        }),
      ),
      Layer.provide(layerHostApp(host.app)),
    ),
  );
  const editor = Context.get(context, CitekeyEditor);
  const settings = Context.get(context, PluginSettings);
  const events: CitekeyEditorEvent[] = [];
  yield* Stream.runForEach(editor.events, (event) =>
    Effect.sync(() => events.push(event)),
  ).pipe(Effect.forkScoped({ startImmediately: true }));
  return { editor, settings, events, workspace, citekeysRead };
});

const paper = {
  itemID: 11,
  libraryID: 1,
  indexedKey: "PAPER234",
  key: "PAPER234",
};

function created(path: string): TFile {
  return Object.assign(new TFile(), { path });
}

describe("CitekeyEditor note creation", () => {
  it.effect("opens the note the creation flow made in the requested pane", () =>
    Effect.gen(function* () {
      const choice = Promise.withResolvers<TFile | null>();
      const asked: Item[] = [];
      const { editor, workspace } = yield* openEditor({
        resolutions: { paper2024: { kind: "unique", item: paper } },
        works: [{ itemID: paper.itemID, key: paper.key }],
        createNote: (item) => {
          asked.push(item);
          return choice.promise;
        },
      });

      const opening = yield* editor
        .openCitekey("paper2024", "tab")
        .pipe(Effect.forkScoped);
      yield* Effect.promise(async () => {
        await expect.poll(() => asked).toHaveLength(1);
      });
      expect(asked[0]?.indexedKey).toBe("PAPER234");
      expect(workspace.opened).toEqual([]);

      choice.resolve(created("Books/Paper.md"));
      yield* Fiber.join(opening);
      expect(workspace.opened).toEqual([
        {
          linktext: "Books/Paper.md",
          sourcePath: "",
          newLeaf: "tab",
          openViewState: { active: true },
        },
      ]);
    }),
  );

  it.effect("keeps hover read-only and a cancelled creation silent", () =>
    Effect.gen(function* () {
      let asked = 0;
      const { editor, workspace, events } = yield* openEditor({
        resolutions: { paper2024: { kind: "unique", item: paper } },
        works: [{ itemID: paper.itemID, key: paper.key }],
        createNote: () => {
          asked += 1;
          return Promise.resolve(null);
        },
      });
      const answer = lookupAnswerFor(["paper2024"], {
        paper2024: { kind: "unique", item: paper },
      });

      expect(yield* editor.hoverNotePath("paper2024", answer)).toBeNull();
      expect(asked).toBe(0);

      yield* editor.openCitekey("paper2024", false);
      expect(asked).toBe(1);
      expect(workspace.opened).toEqual([]);
      expect(events).toEqual([]);
    }),
  );

  it.effect(
    "creates the note of an exact ambiguous-citekey candidate without resolving the key",
    () =>
      Effect.gen(function* () {
        const { editor, workspace, citekeysRead } = yield* openEditor({
          works: [{ itemID: paper.itemID, key: paper.key }],
          createNote: () => Promise.resolve(created("Books/Paper.md")),
        });

        yield* editor.openCandidate(
          { ...paper, summary: "A study of citations", library: null },
          true,
        );

        expect(citekeysRead).toEqual([]);
        expect(
          workspace.opened.map(({ linktext, newLeaf }) => [linktext, newLeaf]),
        ).toEqual([["Books/Paper.md", true]]);
      }),
  );
});

describe("CitekeyEditor navigation", () => {
  it.effect("opens the existing Literature Note before any creation", () =>
    Effect.gen(function* () {
      const { editor, workspace } = yield* openEditor({
        notes: { "Paper.md": "PAPER234" },
        resolutions: { paper2024: { kind: "unique", item: paper } },
      });
      const answer = lookupAnswerFor(["paper2024"], {
        paper2024: { kind: "unique", item: paper },
      });

      expect(yield* editor.hoverNotePath("paper2024", answer)).toBe("Paper.md");
      yield* editor.openCitekey("paper2024", "split");
      expect(
        workspace.opened.map(({ linktext, newLeaf }) => [linktext, newLeaf]),
      ).toEqual([["Paper.md", "split"]]);
    }),
  );

  it.effect("reports a citekey that names no Item", () =>
    Effect.gen(function* () {
      const { editor, events, workspace } = yield* openEditor();

      yield* editor.openCitekey("nobody2024", false);
      yield* Effect.yieldNow;

      expect(events).toEqual([
        { _tag: "citekey-not-found", citekey: "nobody2024" },
      ]);
      expect(workspace.opened).toEqual([]);
    }),
  );

  it.effect(
    "reports a missing citekey as a database problem while the database is not ready",
    () =>
      Effect.gen(function* () {
        const { editor, events } = yield* openEditor({
          readsState: "degraded",
        });

        yield* editor.openCitekey("nobody2024", false);
        yield* editor.openIndexedKey("PAPER234", false);
        yield* Effect.yieldNow;

        expect(events).toEqual([
          { _tag: "db-unavailable", citekey: "nobody2024" },
          { _tag: "item-unavailable", reason: "database" },
        ]);
      }),
  );

  it.effect("reports an Indexed Key the database holds no Item for", () =>
    Effect.gen(function* () {
      const { editor, events } = yield* openEditor();

      yield* editor.openIndexedKey("GONE2345", false);
      yield* Effect.yieldNow;

      expect(events).toEqual([{ _tag: "item-unavailable", reason: "item" }]);
    }),
  );

  it.effect(
    "gates the palette commands on Pandoc citations and open-as-links",
    () =>
      Effect.gen(function* () {
        const { editor, settings } = yield* openEditor();
        expect(yield* editor.navigationEnabled).toBe(false);

        yield* settings.update({ "citation.open-as-links": true });
        expect(yield* editor.navigationEnabled).toBe(true);

        yield* settings.update({ "citation.pandoc-citations": false });
        expect(yield* editor.navigationEnabled).toBe(false);
      }),
  );
});

describe("CitekeyEditor ambiguous citation keys", () => {
  const AMBIGUOUS: CitekeyResolution = {
    kind: "ambiguous",
    candidates: [
      { itemID: 11, libraryID: 1, key: "DEAA2345", indexedKey: "DEAA2345" },
      { itemID: 22, libraryID: 4, key: "REBB3456", indexedKey: "REBB3456g7" },
    ],
  };

  function zoteroItem(
    itemID: number,
    title: string,
    lastName: string,
  ): SeededWork {
    const personal = itemID === 11;
    return {
      itemID,
      libraryID: personal ? 1 : 4,
      key: personal ? "DEAA2345" : "REBB3456",
      title,
      date: "2024",
      creators: [["A", lastName]],
    };
  }

  it.effect(
    "reports every candidate with its summary, Library name, and bare Zotero item key",
    () =>
      Effect.gen(function* () {
        const { editor, events, workspace } = yield* openEditor({
          resolutions: { doe2024: AMBIGUOUS },
          works: [
            zoteroItem(11, "A study of citations", "Doe"),
            zoteroItem(22, "Another study", "Roe"),
          ],
        });

        yield* editor.openCitekey("doe2024", false);
        yield* Effect.yieldNow;

        expect(workspace.opened).toEqual([]);
        expect(events).toHaveLength(1);
        const [event] = events;
        if (event?._tag !== "citekey-ambiguous")
          throw new Error("Expected an ambiguous citekey report");
        expect(event.ambiguous).toMatchObject({
          citekey: "doe2024",
          pane: false,
        });
        expect(
          event.ambiguous.candidates.map(({ summary, library, key }) => ({
            summary,
            library: library?.name ?? null,
            key,
          })),
        ).toEqual([
          {
            summary: "Doe (2024): A study of citations",
            library: null,
            key: "DEAA2345",
          },
          {
            summary: "Roe (2024): Another study",
            library: "Shared group",
            key: "REBB3456",
          },
        ]);
      }),
  );

  // The page preview would have to pick one of the candidates to show, so it
  // shows none of them: a hover implies no identity the key does not carry.
  it.effect("previews no note for a citekey that names several Items", () =>
    Effect.gen(function* () {
      const { editor } = yield* openEditor({
        notes: { "Doe 2024.md": "DEAA2345", "Roe 2025.md": "REBB3456g7" },
        resolutions: { doe2024: AMBIGUOUS },
      });
      const answer = lookupAnswerFor(["doe2024"], { doe2024: AMBIGUOUS });

      expect(yield* editor.hoverNotePath("doe2024", answer)).toBeNull();
    }),
  );

  it.effect(
    "opens a chosen candidate by its exact Indexed Key without resolving the key again",
    () =>
      Effect.gen(function* () {
        const { editor, events, workspace, citekeysRead } = yield* openEditor({
          notes: { "Roe 2025.md": "REBB3456g7" },
          resolutions: { doe2024: AMBIGUOUS },
        });
        yield* editor.openCitekey("doe2024", "tab");
        yield* Effect.yieldNow;
        citekeysRead.length = 0;
        const [event] = events;
        if (event?._tag !== "citekey-ambiguous")
          throw new Error("Expected an ambiguous citekey report");

        yield* editor.openCandidate(event.ambiguous.candidates[1]!, "tab");

        expect(
          workspace.opened.map(({ linktext, newLeaf }) => [linktext, newLeaf]),
        ).toEqual([["Roe 2025.md", "tab"]]);
        expect(citekeysRead).toEqual([]);
      }),
  );
});
