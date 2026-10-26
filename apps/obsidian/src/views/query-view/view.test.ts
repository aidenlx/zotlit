// The Query View runs one view of a Query File through ZotLit Query and shows
// its rows as live Annotation Cards. These tests drive it as a host does: the
// file's text in, the cards, the count and the messages out.
import {
  Menu,
  hideSuggestChooser,
  resetMockPlatform,
  setMockPlatform,
} from "@mock/obsidian";
import { Effect } from "effect";
import { Scope } from "obsidian";
import type { App } from "obsidian";
import { act } from "preact/test-utils";
import { createElement, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { nameDictionary } from "@zotlit/item-query";
import type {
  FormulaDiagnostics,
  QueryContext,
  QuerySummary,
} from "@zotlit/item-query";

import { shimPopover } from "@/components/__fixtures__/popover";
import type { ShimmedPopover } from "@/components/__fixtures__/popover";
import { testEvents } from "@/lib/__fixtures__/event-stream";
import { pressTop } from "@/lib/__fixtures__/keymap";
import { testRuntime } from "@/lib/__fixtures__/runtime";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { effectBridge } from "@/lib/effect-bridge";
import * as m from "@/lib/i18n/generated/messages";
import type { HistorySurface } from "@/services/annotation-repository/actions";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import type {
  AnnotationList,
  AnnotationRecord,
} from "@/services/annotation-repository/service";
import { IDLE } from "@/services/annotation-repository/write";
import type {
  QueryViewOutcome,
  QueryViewRequest,
  QueryViewRow,
} from "@/services/item-query/query-view";
import type { LibraryScope } from "@/services/library-scope/scope";
import { annotationReads } from "@/services/pdf-annotation-editor/__fixtures__";
import { editorApp } from "@/views/annot-view/__fixtures__/editor-app";

// @vitest-environment happy-dom
import { makeQueryHost } from "./__fixtures__/host";
import { fakeQuery, requested } from "./__fixtures__/query-run";
import { QueryCardFocus } from "./card-focus";
import type { ContextSource } from "./context-hint";
import { serializeQueryFile } from "./query-file";
import type { QueryFileDataset } from "./query-file";
import { formulaIssuesOf } from "./results";
import { inferType } from "./table-notes";
import type {
  VaultEdit,
  VaultHost,
  VaultPropertyType,
  VaultValue,
  VaultWrite,
} from "./table-notes";
import { QueryView, RERUN_DELAY_MS, SaveAsButton, SortButton } from "./view";
import type { QueryViewDeps } from "./view";

vi.mock("zustand", () => import("@/views/__fixtures__/zustand"));
vi.mock("obsidian", async (importOriginal) => {
  const obsidian = await importOriginal<typeof import("obsidian")>();
  return {
    ...obsidian,
    // A substring match, enough for a search of the Properties popover.
    prepareFuzzySearch: (query: string) => (text: string) =>
      text.includes(query) ? { score: 0, matches: [] } : null,
  };
});

function record(key: string, parentKey: string): AnnotationRecord {
  return {
    key,
    parentKey,
    type: "highlight",
    color: "#ffd400",
    comment: null,
    text: `text of ${key}`,
    pageLabel: "1",
    sortIndex: "00000|000000|00000",
    tags: [],
    version: 1,
    lock: null,
    position: { kind: "pdf-rects", pageIndex: 0, rects: [[0, 0, 10, 10]] },
  };
}

const LIST: AnnotationList = {
  source: {
    kind: "zotero-db",
    database: { userID: 1, localUserKey: "LOCALKEY", serverID: null },
    libraryID: 1,
    libraryRevision: 7,
  },
  annotations: [record("ANNOTAAA", "PDFAAAAA"), record("ANNOTBBB", "PDFAAAAA")],
};

const FILE = `views:
  - type: annotations
    name: Yellow
    from: annotations
    filters: colorName == "yellow"
    groupBy:
      property: item.indexedKey
      direction: ASC
    limit: 100
  - type: annotations
    name: Everything
    from: annotations
`;

function row(key: string): QueryViewRow {
  return {
    indexedKey: key,
    attachmentIndexedKey: "PDFAAAAA",
    itemIndexedKey: "ITEMAAAA",
    values: { "item.title": "Ten simple rules", "attachment.title": "PDF" },
  };
}

function result(
  rows: QueryViewRow[],
  matchedCount = rows.length,
): QueryViewOutcome {
  return {
    kind: "result",
    result: {
      libraries: [{ type: "personal" }],
      query: { filter: null, fields: [], sort: [], limit: null },
      returnedCount: rows.length,
      matchedCount,
      truncated: matchedCount > rows.length,
      warnings: [],
      rows,
    },
  };
}

type Listener = (...args: unknown[]) => void;

function emitter() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    on: (event: string, cb: Listener) => {
      const set = listeners.get(event) ?? new Set();
      set.add(cb);
      listeners.set(event, set);
      return () => set.delete(cb);
    },
    emit: (event: string, ...args: unknown[]) => {
      for (const cb of listeners.get(event) ?? []) cb(...args);
    },
  };
}

let cleanup = new AsyncDisposableStack();
afterEach(async () => {
  await cleanup.disposeAsync();
  cleanup = new AsyncDisposableStack();
  document.body.replaceChildren();
});

async function mount(
  answers: QueryViewOutcome[],
  onWrite?: (text: string) => void,
  {
    notes = {},
    frontmatter = {},
    managed = {},
    types = {},
    propertyNames = [],
    sourcePath = "query-files/Reading.zotquery",
    layout,
    write,
    canSave,
    context = () => undefined,
    contextSource,
    libraries,
    displayOnly,
    layouts,
    saveAs,
    toolbar,
    rowPass,
    reason,
    creation = "created",
    values = {},
    notePaths = [],
  }: {
    notes?: Record<string, string>;
    /** The frontmatter of each note, by path. */
    frontmatter?: Record<string, Record<string, unknown>>;
    /** The keys each note's Profile manages with replace, by path. */
    managed?: Record<string, string[]>;
    /** The type Obsidian assigns each property, by name. */
    types?: Record<string, VaultPropertyType>;
    /** The names the vault properties take. */
    propertyNames?: string[];
    /** The note or file that holds the view. */
    sourcePath?: string;
    layout?: ConstructorParameters<typeof QueryView>[1]["layout"];
    /** The host's write; it rejects where the text was not saved. */
    write?: (text: string) => Promise<void>;
    canSave?: () => boolean;
    context?: () => QueryContext | undefined;
    contextSource?: ContextSource;
    libraries?: () => LibraryScope;
    displayOnly?: boolean;
    layouts?: readonly string[];
    saveAs?: () => void;
    toolbar?: "host";
    rowPass?: ConstructorParameters<typeof QueryView>[1]["rowPass"];
    reason?: (row: QueryViewRow) => string | null;
    /**
     * What the usual creation does for an edit of an Item with no note:
     * create its note at `<key>.md`, or have the Profile prompt cancelled.
     */
    creation?: "created" | "cancelled";
    /** The values the vault holds for each property, by name. */
    values?: Record<string, string[]>;
    /** The notes a link reaches, by link text. */
    notePaths?: string[];
  } = {},
) {
  setMockPlatform({ isMacOS: true });
  cleanup.defer(resetMockPlatform);
  const reads = testEvents<Record<string, (...args: unknown[]) => void>>([
    "changed",
    "degraded",
    "db-file-missing",
  ]);
  const libraryScope = testEvents<Record<string, (...args: unknown[]) => void>>(
    ["changed", "libraries-changed"],
  );
  const annotations = annotationReads();
  const repository = {
    emit(event: "annotations-changed", attachmentKey: string): void {
      annotations.replace(attachmentKey, list.annotations);
    },
  };
  let list = LIST;
  const held: string[][] = [];
  const released: string[][] = [];
  // As ZotLit Query does, each row carries only the fields the request names.
  const run = vi.fn((request: QueryViewRequest, _signal: AbortSignal) =>
    Promise.resolve(requested(answers.shift() ?? result([]), request)),
  );
  const notesChanged = emitter();
  const literatureNotes = {
    find: (itemKey: string) => {
      const path = notes[itemKey];
      return path === undefined
        ? null
        : { path, basename: path.replace(/\.md$/, "") };
    },
    on: notesChanged.on,
    /** Fire one of the Note Index's events. */
    emit: notesChanged.emit,
    propertyNames: () => propertyNames,
    itemKeys: () => Object.keys(notes),
    propertyType: (name: string, value?: unknown): VaultPropertyType => {
      if (types[name]) return types[name];
      if (value !== undefined && value !== null) return inferType(value);
      for (const values of Object.values(frontmatter))
        if (values[name] !== undefined && values[name] !== null)
          return inferType(values[name]);
      return "text";
    },
    read: vi.fn(
      (itemKey: string, name: string, host: VaultHost | null): VaultValue => {
        const path = host?.itemKey === itemKey ? host.path : notes[itemKey];
        if (path === undefined) return { note: false };
        return { note: true, value: frontmatter[path]?.[name] ?? null };
      },
    ),
    managed: (itemKey: string, name: string, host: VaultHost | null) => {
      const path = host?.itemKey === itemKey ? host.path : notes[itemKey];
      return path !== undefined && (managed[path]?.includes(name) ?? false);
    },
    write: vi.fn(
      async ({
        itemKey,
        name,
        value,
        host,
      }: VaultEdit): Promise<VaultWrite> => {
        let path = host?.itemKey === itemKey ? host.path : notes[itemKey];
        if (path === undefined) {
          if (creation === "cancelled") return "cancelled";
          path = notes[itemKey] = `${itemKey}.md`;
          frontmatter[path] = { [name]: value };
          notesChanged.emit("changed");
          return "created";
        }
        frontmatter[path] = { ...frontmatter[path], [name]: value };
        notesChanged.emit("frontmatter-changed");
        return "written";
      },
    ),
    suggestions: vi.fn(
      (name: string, _type: VaultPropertyType) => values[name] ?? [],
    ),
    resolves: ({ target }: { target: string }) => notePaths.includes(target),
    openLink: vi.fn(),
    open: vi.fn(),
    create: vi.fn(async (itemKey: string) => {
      notes[itemKey] = `${itemKey}.md`;
      notesChanged.emit("changed");
    }),
  };
  const readers = {
    open: vi.fn<QueryViewDeps["opener"]["open"]>(async () => ({
      kind: "reader",
    })),
  };
  const runtime = testRuntime();
  const readService = new Proxy(
    stubService<QueryViewDeps["reads"]>("ZoteroReads", {
      ...reads.streams,
      acquireRead: vi.fn(),
    }),
    {
      get(target, property, receiver) {
        if (property === "acquireRead")
          return () =>
            Promise.resolve({
              reads: {
                TagNames: ({ libraryID }: { libraryID: number }) =>
                  Effect.succeed(
                    libraryID === 1 ? ["figure", "method"] : ["group"],
                  ),
                CollectionPaths: ({ libraryIDs }: { libraryIDs: number[] }) =>
                  Effect.succeed(
                    libraryIDs.length === 2 ? [["Thesis", "Methods"]] : [],
                  ),
              },
              [Symbol.asyncDispose]: () => Promise.resolve(),
            });
        return Reflect.get(target, property, receiver);
      },
    },
  );
  const queryHost = cleanup.use(await makeQueryHost());
  const deps = stubService<QueryViewDeps>("QueryViewDeps", {
    registry: queryHost.registry,
    runtime,
    bridge: effectBridge(runtime),
    app: editorApp(),
    reads: readService,
    libraryScope: stubService<QueryViewDeps["libraryScope"]>("LibraryScope", {
      ...libraryScope.streams,
      current: {
        mode: "selected",
        invalid: false,
        available: [
          { selector: { type: "personal" }, libraryID: 1, name: null },
          {
            selector: { type: "group", groupID: 4815 },
            libraryID: 2,
            name: "Lab",
          },
        ],
        unavailable: [],
      },
    }),
    query: fakeQuery(run),
    annotations: stubService<QueryViewDeps["annotations"]>("Annotations", {
      ...annotations,
      read: () => Effect.succeed(list),
      peek: () =>
        Effect.succeed({
          value: list,
          status: "fresh",
          settled: Promise.resolve(list),
        }),
      refresh: () => Effect.succeed(null),
      capabilityFor: (): Effect.Effect<EditingCapability> =>
        Effect.succeed({ kind: "writable" }),
      textDraftFor: () => Effect.succeed(null),
      tagDraftFor: () => Effect.succeed(null),
      annotationState: () =>
        Effect.succeed({
          mutation: IDLE,
          textDrafts: { comment: null, text: null },
          tagDraft: null,
          hidden: false,
          gone: false,
        }),
      hold: (keys: Iterable<string>) => {
        const list = [...keys];
        held.push(list);
        return Effect.succeed({
          [Symbol.dispose]: () => released.push(list),
        });
      },
    }),
    zoteroPref: stubService<QueryViewDeps["zoteroPref"]>("ZoteroPref", {
      dataDir: "/zotero",
      baseAttachmentPath: null,
    }),
    excerptDisplay: stubService<QueryViewDeps["excerptDisplay"]>(
      "ExcerptDisplay",
      { open: vi.fn(), refresh: vi.fn() },
    ),
    noteFeature: stubService<QueryViewDeps["noteFeature"]>(
      "NoteFeatureHandle",
      {},
    ),
    libraryTagNames: () => Promise.resolve([]),
    allowEditing: vi.fn(),
    reportBlockedGesture: vi.fn(),
    literatureNotes,
    opener: stubService<QueryViewDeps["opener"]>("TargetOpener", readers),
  });
  const save = vi.fn((_text: string) => {});
  const onSelectView = vi.fn((_name: string) => {});
  const scope = new Scope();
  const view = new QueryView(deps, {
    scope,
    sourcePath: () => sourcePath,
    context,
    contextSource,
    save: (text) => {
      saved.push(text);
      save(text);
      onWrite?.(text);
      return write?.(text);
    },
    onSelectView,
    ...(canSave && { canSave }),
    ...(layout && { layout }),
    ...(libraries && { libraries }),
    ...(displayOnly && { displayOnly }),
    ...(layouts && { layouts }),
    ...(saveAs && { saveAs }),
    ...(toolbar && { toolbar }),
    ...(rowPass && { rowPass }),
    ...(reason && { reason }),
  });
  const saved: string[] = [];
  const el = document.createElement("div");
  document.body.append(el);
  view.load();
  await act(() => view.render(el));
  cleanup.defer(() => act(() => view.unload()));
  const settle = () =>
    act(async () => {
      await view.settled;
    });
  return {
    view,
    el,
    /** The keymap whose pushed Scopes a test can read. */
    app: deps.app as unknown as { scopes: Scope[] },
    /** The Scope the host gives the view for its keys. */
    scope,
    run,
    reads,
    libraryScope,
    repository,
    /** Change what the repository holds for the Attachment. */
    setList: (next: AnnotationList) => {
      list = next;
    },
    held,
    released,
    settle,
    save,
    onSelectView,
    saved,
    literatureNotes,
    readers,
  };
}

function cards(el: HTMLElement): (string | null)[] {
  return [...el.querySelectorAll(".zt-annot-card")].map((node) =>
    node.getAttribute("data-zotero-annotation-key"),
  );
}

it("runs the first view of the file and shows its rows with the count", async () => {
  const { view, el, run, settle } = await mount([result([row("ANNOTBBB")])]);
  await act(() => view.setText(FILE));
  await settle();

  expect(run).toHaveBeenCalledTimes(1);
  const [request] = run.mock.calls[0]!;
  expect(request).toMatchObject({
    from: "annotations",
    filter: 'colorName == "yellow"',
    limit: 100,
  });
  // In a Query File's own tab, `this` has no value.
  expect(request.context).toBeUndefined();
  expect(cards(el)).toEqual(["ANNOTBBB"]);
  expect(el.querySelector("[data-query-count]")?.textContent).toBe("1 result");
  expect(el.querySelector("[data-query-group]")?.textContent).toBe(
    "Ten simple rules",
  );
});

it("switches to another view of the file from the view menu", async () => {
  const { view, el, run, settle } = await mount([
    result([row("ANNOTBBB")]),
    result([row("ANNOTAAA"), row("ANNOTBBB")]),
  ]);
  await act(() => view.setText(FILE));
  await settle();
  await act(() => view.pickView("Everything"));
  await settle();

  expect(run.mock.calls[1]![0]).not.toHaveProperty("filter");
  expect(cards(el)).toEqual(["ANNOTAAA", "ANNOTBBB"]);
  expect(el.querySelector("[data-query-view-menu]")?.textContent).toBe(
    "Everything",
  );
});

it("runs again on a database change and a Library Scope change", async () => {
  const { view, run, reads, libraryScope, settle } = await mount([]);
  await act(() => view.setText(FILE));
  await settle();
  reads.emit("changed");
  await settle();
  libraryScope.emit("libraries-changed");
  await settle();
  expect(run).toHaveBeenCalledTimes(3);
});

it("runs again once an Attachment it shows gains an Annotation, so a grouped view shows it", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  cleanup.defer(() => {
    vi.useRealTimers();
  });
  const { view, el, run, repository, setList, settle } = await mount([
    result([row("ANNOTAAA"), row("ANNOTBBB")]),
    result([row("ANNOTAAA"), row("ANNOTBBB"), row("ANNOTCCC")]),
  ]);
  await act(() => view.setText(FILE));
  await settle();
  const wait = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  // A new Annotation runs the view once, after a short wait.
  setList({
    ...LIST,
    annotations: [...LIST.annotations, record("ANNOTCCC", "PDFAAAAA")],
  });
  repository.emit("annotations-changed", "PDFAAAAA");
  await wait(RERUN_DELAY_MS - 1);
  expect(run).toHaveBeenCalledTimes(1);
  await wait(1);
  await settle();
  expect(run).toHaveBeenCalledTimes(2);
  expect(cards(el)).toEqual(["ANNOTAAA", "ANNOTBBB", "ANNOTCCC"]);
  expect(el.querySelector("[data-query-group]")?.textContent).toBe(
    "Ten simple rules",
  );
});

it("keeps a new Annotation on screen when a run from its list change has not read it yet", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  cleanup.defer(() => {
    vi.useRealTimers();
  });
  const { view, el, run, reads, repository, setList, settle } = await mount(
    [
      result([row("ANNOTBBB")]),
      result([row("ANNOTAAA"), row("ANNOTBBB")]),
      // Zotero's database does not hold the new Annotation yet.
      result([row("ANNOTAAA"), row("ANNOTBBB")]),
      result([row("ANNOTAAA"), row("ANNOTBBB"), row("ANNOTCCC")]),
    ],
    undefined,
    { layout: { showNewRecords: true } },
  );
  await act(() => view.setText(FILE));
  await settle();
  await act(() => view.pickView("Everything"));
  await settle();

  setList({
    ...LIST,
    annotations: [...LIST.annotations, record("ANNOTCCC", "PDFAAAAA")],
  });
  repository.emit("annotations-changed", "PDFAAAAA");
  await settle();
  expect(cards(el)).toEqual(["ANNOTAAA", "ANNOTBBB", "ANNOTCCC"]);

  await act(() => {
    vi.advanceTimersByTime(RERUN_DELAY_MS);
  });
  await settle();
  expect(run).toHaveBeenCalledTimes(3);
  expect(cards(el)).toEqual(["ANNOTAAA", "ANNOTBBB", "ANNOTCCC"]);

  // The database change that brings it runs the view, and its rows hold it.
  reads.emit("changed");
  await settle();
  expect(run).toHaveBeenCalledTimes(4);
  expect(cards(el)).toEqual(["ANNOTAAA", "ANNOTBBB", "ANNOTCCC"]);
});

it("holds the lists it shows, and lets the old ones go only after the new ones", async () => {
  const { view, held, released, settle } = await mount([
    result([row("ANNOTBBB")]),
    result([]),
  ]);
  await act(() => view.setText(FILE));
  await settle();
  expect(held).toEqual([["PDFAAAAA"]]);
  expect(released).toEqual([]);

  await act(() => view.refresh());
  await settle();
  expect(held).toEqual([["PDFAAAAA"], []]);
  expect(released).toEqual([["PDFAAAAA"]]);
});

it("says the Item's library is outside the library scope, rather than only that nothing matches", async () => {
  const outside = result([]);
  if (outside.kind !== "result") throw new Error("unreachable");
  const { view, el, settle } = await mount([
    {
      kind: "result",
      result: {
        ...outside.result,
        warnings: [
          {
            code: "key-outside-target-libraries",
            severity: "warning",
            message:
              'Indexed Key "RUGIER24G4815" names group:4815, which is outside the Target Libraries.',
            hint: "Use library=group:4815 to include group:4815.",
            report: [],
            found: "group:4815",
            expected: ["the Target Libraries"],
            suggestions: [],
          },
        ],
      },
    },
  ]);
  await act(() => view.setText(FILE));
  await settle();

  expect(
    el.querySelector('[data-query-warning="key-outside-target-libraries"]')
      ?.textContent,
  ).toBe(
    "This item's library is not in the library scope, so the view cannot show it. Add the library to the library scope in ZotLit settings.",
  );
});

it("says why when the query cannot read Zotero's data, rather than looking empty", async () => {
  const { view, el, settle } = await mount([
    {
      kind: "failed",
      diagnostic: {
        code: "source-unavailable",
        message: "The Zotero database cannot be read.",
        hint: "Check the Zotero data directory.",
        severity: "error",
        report: ["The Zotero database cannot be read."],
        found: "",
        expected: [],
        suggestions: [],
      },
    },
  ]);
  await act(() => view.setText(FILE));
  await settle();

  expect(
    el
      .querySelector("[data-query-diagnostic]")
      ?.getAttribute("data-query-diagnostic"),
  ).toBe("source-unavailable");
  expect(
    el
      .querySelector('[data-query-diagnostic="source-unavailable"]')
      ?.getAttribute("role"),
  ).toBe("alert");
  expect(el.querySelector("[data-query-empty]")).toBeNull();
});

/** Whether the rows' layout is out of the flow, so the frame takes the space. */
function rowsHidden(el: HTMLElement): boolean {
  return el.querySelector(".annots-container")?.closest("[hidden]") != null;
}

it("keeps the note of a failed run inline above the last good rows", async () => {
  const { view, el, settle } = await mount(
    [result([row("ANNOTBBB")]), filterFault(1, 11)],
    () => {},
  );
  await act(() => view.setText(FILE));
  await settle();
  await act(() => {
    view.document.setFilters("view", {
      and: ['colourName == "yellow"', 'tags.contains("figure")'],
    });
  });
  await settle();

  const note = el.querySelector("[data-query-filter-error]");
  expect(note).not.toBeNull();
  expect(el.querySelector("[data-pane-state]")).toBeNull();
  expect(rowsHidden(el)).toBe(false);
  expect(cards(el)).toEqual(["ANNOTBBB"]);
});

it("shows where this.item gets an Item above the diagnostic of a filter that reads it unbound", async () => {
  const at = "this.item";
  const { view, el, settle } = await mount(
    [
      {
        kind: "failed",
        diagnostic: {
          code: "unbound-context",
          message:
            "The filter reads this.item, but the query binds no Item to this.",
          hint: "Bind this.item to an Item when you run the query.",
          severity: "error",
          report: [],
          excerpt: { before: "item == ", at, after: "" },
          found: "",
          expected: [],
          suggestions: [],
        },
      },
    ],
    undefined,
    { contextSource: "note" },
  );
  await act(() => view.setText(FILE));
  await settle();

  const hint = el.querySelector("[data-query-context-hint]");
  const box = el.querySelector('[data-query-diagnostic="unbound-context"]');
  expect(hint?.textContent).toBe(m.query_view_context_hint_note_item());
  expect(box).not.toBeNull();
  expect(
    hint!.compareDocumentPosition(box!) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("opens a file with a broken view and names the problem without running it", async () => {
  const { view, el, run, settle } = await mount([]);
  await act(() =>
    view.setText(
      "views:\n  - type: kanban\n    name: Items\n    from: items\n",
    ),
  );
  await settle();
  expect(run).not.toHaveBeenCalled();
  expect(el.querySelector("[data-query-problems]")?.textContent).toContain(
    "kanban",
  );
});

it("keeps a renamed view on screen without running it again", async () => {
  const { view, el, run, settle } = await mount([result([row("ANNOTBBB")])]);
  await act(() => view.setText(FILE));
  await settle();
  await act(() => view.document.renameView(0, "Yellow highlights"));
  await settle();

  expect(el.querySelector("[data-query-view-menu]")?.textContent).toBe(
    "Yellow highlights",
  );
  expect(run).toHaveBeenCalledTimes(1);
  expect(cards(el)).toEqual(["ANNOTBBB"]);
});

it("changes the cards at once for an Annotations layout option, and saves it", async () => {
  const { view, el, run, settle, save } = await mount([
    result([row("ANNOTBBB")]),
  ]);
  await act(() => view.setText(FILE));
  await settle();
  expect(el.querySelector(".zt-annot-page-chip")?.textContent).toContain("1");

  await act(() => view.document.setViewOption(0, "showPage", false));
  await act(() => view.document.setViewOption(0, "cardWidth", 420));
  await settle();

  expect(el.querySelector(".zt-annot-page-chip")?.textContent).toBe("");
  expect(
    el.querySelector("[data-card-width]")?.getAttribute("data-card-width"),
  ).toBe("420");
  expect(save.mock.calls.at(-1)![0]).toContain("showPage: false");
  expect(save.mock.calls.at(-1)![0]).toContain("cardWidth: 420");
  expect(run).toHaveBeenCalledTimes(1);
  expect(cards(el)).toEqual(["ANNOTBBB"]);
});

describe("saving a toolbar edit", () => {
  it("writes typed text that still waits when it unloads", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    cleanup.defer(() => {
      vi.useRealTimers();
    });
    const { view, saved, settle } = await mount([]);
    await act(() => view.setText(FILE));
    await settle();
    await act(() => view.document.renameView(0, "Yellow highlights"));
    expect(saved).toEqual([]);
    await act(() => view.unload());
    expect(saved).toHaveLength(1);
    expect(saved[0]).toContain("name: Yellow highlights");
  });

  it("runs once for an edit whose text the host gives back", async () => {
    let echo: (text: string) => void = () => {};
    const { view, run, settle } = await mount([], (text) => echo(text));
    await act(() => view.setText(FILE));
    await settle();
    const runs = run.mock.calls.length;

    echo = (text) => view.setText(text);
    await act(() => view.document.editView({ limit: 6 }));
    await settle();
    const shown = view.state.getState().file;
    expect(shown?.views[0]?.limit).toBe(6);
    expect(run).toHaveBeenCalledTimes(runs + 1);

    // The host reads the saved text again, as a vault change makes it.
    await act(() => view.setText(serializeQueryFile(shown!)));
    await settle();
    expect(run).toHaveBeenCalledTimes(runs + 1);
  });

  it("runs again once the host says its Query Context changed, as the sidebar does for another Attachment", async () => {
    let attachment = "PDFAAAAA";
    const { view, run, saved, settle } = await mount([], undefined, {
      context: () => ({ attachment }),
    });
    await act(() => view.setText(FILE));
    await settle();
    await act(() => view.document.editView({ limit: 5 }));
    await settle();
    const runs = run.mock.calls.length;

    // The same Query Context runs nothing.
    await act(() => view.contextChanged());
    await settle();
    expect(run).toHaveBeenCalledTimes(runs);

    attachment = "PDFBBBBB";
    // The text alone does not read the Query Context again.
    await act(() => view.setText(saved.at(-1)!));
    await settle();
    expect(run).toHaveBeenCalledTimes(runs);
    await act(() => view.contextChanged());
    await settle();
    expect(run).toHaveBeenCalledTimes(runs + 1);
    expect(run.mock.calls.at(-1)![0]).toMatchObject({
      limit: 5,
      context: { attachment: "PDFBBBBB" },
    });
  });

  it("reads the Libraries the host selects, and runs again once the host selects others", async () => {
    let libraries: LibraryScope = {
      mode: "selected",
      libraries: [{ type: "personal" }],
    };
    const { view, run, settle } = await mount([], undefined, {
      libraries: () => libraries,
    });
    await act(() => view.setText(FILE));
    await settle();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0].libraries).toEqual({
      mode: "selected",
      libraries: [{ type: "personal" }],
    });

    // The same Libraries run nothing.
    await act(() => view.contextChanged());
    await settle();
    expect(run).toHaveBeenCalledTimes(1);

    libraries = {
      mode: "selected",
      libraries: [{ type: "group", groupID: 4815 }],
    };
    await act(() => view.contextChanged());
    await settle();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]![0].libraries).toEqual({
      mode: "selected",
      libraries: [{ type: "group", groupID: 4815 }],
    });
  });

  it("offers only the result count, Sort and Save as query file where the host keeps only the sort and offers one Layout, and every control where it keeps the file", async () => {
    const toolbar = (el: HTMLElement) =>
      [
        ...el.querySelectorAll(
          "[data-query-view-menu], [data-query-results], [data-query-toolbar], [data-query-properties], [data-query-save-as]",
        ),
      ].map(
        (node) =>
          node.getAttribute("data-query-toolbar") ??
          [...node.attributes]
            .map(({ name }) => name)
            .find((name) => name.startsWith("data-query-")),
      );
    const full = await mount([]);
    await act(() => full.view.setText(FILE));
    await full.settle();
    expect(toolbar(full.el)).toEqual([
      "data-query-view-menu",
      "data-query-results",
      "sort",
      "group",
      "filter",
      "data-query-properties",
      "search",
    ]);
    await cleanup.disposeAsync();
    cleanup = new AsyncDisposableStack();
    document.body.replaceChildren();

    const saveAs = vi.fn();
    const fixed = await mount([], undefined, {
      displayOnly: true,
      layouts: ["papers"],
      saveAs,
    });
    await act(() => fixed.view.setText(PAPERS_FILE));
    await fixed.settle();
    // A host that keeps only the sort has a search of its own (ADR 0073).
    expect(toolbar(fixed.el)).toEqual([
      "data-query-results",
      "sort",
      "data-query-save-as",
    ]);
    const button = fixed.el.querySelector<HTMLElement>("[data-query-save-as]")!;
    // A labelled button: its name is its tooltip, and shows on a wide pane.
    expect(button.getAttribute("aria-label")).toBe(
      m.annot_view_save_as_query_file(),
    );
    await act(() => button.click());
    expect(saveAs).toHaveBeenCalledOnce();

    // The result count still opens its menu, with no limit to set.
    await shimPopover(
      fixed.el.querySelector<HTMLElement>("[data-query-results-popup]")!,
    ).open();
    expect(fixed.el.querySelector("[data-query-copy]")).not.toBeNull();
    expect(fixed.el.querySelector("[data-query-export]")).not.toBeNull();
    expect(fixed.el.querySelector("[data-query-limit]")).toBeNull();
  });

  it("draws no toolbar row where the host places Sort and Save as query file itself, which still sort and save from the host's place", async () => {
    const saveAs = vi.fn();
    const hosted = await mount([], undefined, {
      displayOnly: true,
      layouts: ["papers"],
      saveAs,
      toolbar: "host",
    });
    await act(() => hosted.view.setText(PAPERS_FILE));
    await hosted.settle();
    expect(hosted.el.querySelector('[role="toolbar"]')).toBeNull();
    expect(hosted.el.querySelector("[data-query-results]")).toBeNull();
    // The rows still show under where the row would be.
    expect(hosted.el.querySelector("[data-query-layout]")).not.toBeNull();
    const place = document.createElement("div");
    document.body.append(place);
    const root = createRoot(place);
    cleanup.defer(() => act(() => root.unmount()));
    await act(() =>
      root.render(
        createElement(
          Fragment,
          null,
          createElement(SortButton, { view: hosted.view }),
          createElement(SaveAsButton, { view: hosted.view }),
        ),
      ),
    );
    await act(() =>
      place.querySelector<HTMLElement>("[data-query-save-as]")!.click(),
    );
    expect(saveAs).toHaveBeenCalledOnce();
    expect(place.querySelector('[data-query-toolbar="sort"]')).not.toBeNull();
  });

  it("switches only between the Layouts the host offers from the view menu, with no view to add or configure, where the host keeps only the Layout of its view", async () => {
    const { view, el, settle, saved } = await mount(
      [result([]), result([])],
      undefined,
      { displayOnly: true, layouts: ["papers", "table"] },
    );
    await act(() =>
      view.setText(`views:
  - type: table
    name: Reading list
    from: items
`),
    );
    await settle();
    const trigger = () =>
      el.querySelector<HTMLElement>("[data-query-view-menu]")!;
    // The menu names the Layout on screen; the view's own name is the host's.
    expect(trigger().textContent).toBe("Table");
    await act(() => trigger().click());
    await shimPopover(
      document.querySelector<HTMLElement>("[data-query-view-list]")!,
    ).open();
    expect(
      [...document.querySelectorAll("[data-query-view-layout-option]")].map(
        (row) => row.getAttribute("data-query-view-layout-option"),
      ),
    ).toEqual(["papers", "table"]);
    expect(document.querySelector("[data-query-view-action]")).toBeNull();
    expect(document.querySelector("[data-query-view-configure]")).toBeNull();

    await act(() =>
      document
        .querySelector<HTMLElement>('[data-query-view-layout-option="papers"]')!
        .click(),
    );
    await act(() => view.flush());
    await settle();
    expect(saved.at(-1)).toContain("type: papers");
    expect(trigger().textContent).toBe("Papers");
  });

  it("leaves the Libraries to the Library Scope where the host selects none", async () => {
    const { view, run, settle } = await mount([]);
    await act(() => view.setText(FILE));
    await settle();
    expect(run.mock.calls[0]![0]).not.toHaveProperty("libraries");
  });

  it("says a change is not saved when the host cannot write it, until a later save works", async () => {
    let fail = true;
    const { view, el, settle } = await mount([], undefined, {
      write: () =>
        fail ? Promise.reject(new Error("disk full")) : Promise.resolve(),
    });
    await act(() => view.setText(FILE));
    await settle();
    expect(el.querySelector("[data-query-read-only]")).toBeNull();

    await act(async () => {
      view.document.editView({ limit: 5 });
      await view.flush();
    });
    expect(view.state.getState().view?.limit).toBe(5);
    expect(el.querySelector("[data-query-read-only]")).not.toBeNull();

    fail = false;
    await act(async () => {
      view.document.editView({ limit: 6 });
      await view.flush();
    });
    expect(el.querySelector("[data-query-read-only]")).toBeNull();
  });

  it("says a change is not saved where the host cannot save", async () => {
    const { view, el, settle } = await mount([], undefined, {
      canSave: () => false,
    });
    await act(() => view.setText(FILE));
    await settle();
    expect(el.querySelector("[data-query-read-only]")).not.toBeNull();
  });
});

const TAGGED = `views:
  - type: annotations
    name: Tags
    from: annotations
    groupBy:
      property: tags[]
      direction: ASC
`;

function tagged(key: string, tags: string[]): QueryViewRow {
  return { ...row(key), values: { ...row(key).values, tags } };
}

function headings(el: HTMLElement): (string | null)[] {
  return [...el.querySelectorAll("[data-query-group]")].map(
    (node) => node.textContent,
  );
}

it("shows a card with two tags under both tag headings, and counts it once", async () => {
  const { view, el, run, settle } = await mount([
    result([
      tagged("ANNOTAAA", ["figure", "method"]),
      tagged("ANNOTBBB", ["method"]),
    ]),
  ]);
  await act(() => view.setText(TAGGED));
  await settle();

  expect(run.mock.calls[0]![0].fields).toContain("tags");
  expect(headings(el)).toEqual(["figure", "method"]);
  expect(cards(el)).toEqual(["ANNOTAAA", "ANNOTAAA", "ANNOTBBB"]);
  expect(el.querySelector("[data-query-count]")?.textContent).toBe("2 results");
});

it("collapses a group heading and expands it again", async () => {
  const { view, el, settle } = await mount([
    result([tagged("ANNOTAAA", ["figure"]), tagged("ANNOTBBB", ["method"])]),
  ]);
  await act(() => view.setText(TAGGED));
  await settle();

  const toggle = () =>
    el.querySelector<HTMLElement>('[data-query-group="figure"] button')!;
  await act(() => toggle().click());
  expect(toggle().getAttribute("aria-expanded")).toBe("false");
  expect(cards(el)).toEqual(["ANNOTBBB"]);
  await act(() => toggle().click());
  expect(cards(el)).toEqual(["ANNOTAAA", "ANNOTBBB"]);
});

/** A Select's popup, opened as the browser opens it (see `shimPopover`). */
const shims = new WeakMap<HTMLElement, ShimmedPopover>();

async function openSelect(trigger: Element): Promise<HTMLElement> {
  const popup = trigger.ownerDocument.getElementById(
    trigger.getAttribute("popovertarget")!,
  )!;
  let shim = shims.get(popup);
  if (!shim) shims.set(popup, (shim = shimPopover(popup)));
  await shim.open();
  return popup;
}

/** The rows a Select offers, by value and by the label each row shows. */
async function selectOptions(
  trigger: Element,
): Promise<{ value: string; label: string }[]> {
  const popup = await openSelect(trigger);
  const options = [
    ...popup.querySelectorAll<HTMLElement>('[role="option"]'),
  ].map((option) => ({
    value: option.dataset.value!,
    label: option.querySelector("[data-select-label]")!.textContent!,
  }));
  await act(() => popup.hidePopover());
  return options;
}

/** Picks `value` from a native select, or the row of it from a Select's popup. */
async function choose(trigger: Element, value: string): Promise<void> {
  if (trigger.instanceOf(HTMLSelectElement)) {
    await act(() => {
      trigger.value = value;
      trigger.dispatchEvent(new Event("input", { bubbles: true }));
      trigger.dispatchEvent(new Event("change", { bubbles: true }));
    });
    return;
  }
  const popup = await openSelect(trigger);
  await act(() =>
    popup
      .querySelector<HTMLElement>(`[role="option"][data-value="${value}"]`)!
      .click(),
  );
}

it("adds sorts from the toolbar, runs them in order, and saves them to the file", async () => {
  const { view, el, run, settle, saved } = await mount([]);
  await act(() => view.setText(TAGGED));
  await settle();

  const editor = () =>
    el.querySelector<HTMLElement>('[data-query-popover="sort"]')!;
  // The sort list offers only properties ZotLit Query can sort.
  const offered = [
    ...editor().querySelectorAll<HTMLButtonElement>("[data-sort-add]"),
  ];
  expect(offered).toHaveLength(1);
  await act(() => offered[0]!.click());
  await act(() =>
    editor().querySelector<HTMLButtonElement>("[data-sort-add]")!.click(),
  );
  const properties = () => [
    ...editor().querySelectorAll<HTMLElement>("[data-sort-property]"),
  ];
  const options = (await selectOptions(properties()[0]!)).map((o) => o.value);
  expect(options).not.toContain("text");
  expect(options).not.toContain("pageLabel");
  await choose(properties()[1]!, "dateAdded");
  await choose(editor().querySelectorAll("[data-sort-direction]")[1]!, "DESC");
  await settle();

  expect(run.mock.calls.at(-1)![0].sort).toEqual([
    { field: "sortIndex", direction: "asc" },
    { field: "dateAdded", direction: "desc" },
  ]);
  expect(saved.at(-1)).toContain(`    sort:
      - property: sortIndex
        direction: ASC
      - property: dateAdded
        direction: DESC
`);

  // Alt+ArrowDown on the first row's handle gives it the second place.
  await act(() => {
    editor()
      .querySelector<HTMLElement>("[data-reorder-handle]")!
      .dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          altKey: true,
          bubbles: true,
        }),
      );
  });
  expect(properties().map((select) => select.dataset.value)).toEqual([
    "dateAdded",
    "sortIndex",
  ]);
});

it("sets a Manual group order where a tick hides a group, and saves it to the file", async () => {
  const { view, el, settle, saved } = await mount([
    result([tagged("ANNOTAAA", ["figure"]), tagged("ANNOTBBB", ["method"])]),
    result([tagged("ANNOTAAA", ["figure"]), tagged("ANNOTBBB", ["method"])]),
    result([tagged("ANNOTAAA", ["figure"]), tagged("ANNOTBBB", ["method"])]),
  ]);
  await act(() => view.setText(TAGGED));
  await settle();

  const editor = () =>
    el.querySelector<HTMLElement>('[data-query-popover="group"]')!;
  await choose(editor().querySelector("[data-group-direction]")!, "MANUAL");
  await settle();
  const rows = () => [
    ...editor().querySelectorAll<HTMLElement>("[data-group-row]"),
  ];
  expect(
    rows().map((row) => [
      row.textContent,
      row.querySelector<HTMLInputElement>("input")!.checked,
    ]),
  ).toEqual([
    ["figure1", true],
    ["method1", true],
  ]);

  await act(() => rows()[0]!.querySelector<HTMLInputElement>("input")!.click());
  await settle();

  expect(headings(el)).toEqual(["method"]);
  expect(cards(el)).toEqual(["ANNOTBBB"]);
  expect(saved.at(-1)).toContain(`    groupOrder:
      - method
`);
  expect(view.state.getState().view?.groupOrder).toEqual(["method"]);
});

it("finds text in the shown cards from the toolbar search", async () => {
  const { view, el, settle } = await mount([
    result([row("ANNOTAAA"), row("ANNOTBBB")]),
  ]);
  await act(() => view.setText(FILE));
  await settle();

  await act(() =>
    el.querySelector<HTMLElement>('[data-query-toolbar="search"]')!.click(),
  );
  const input = el.querySelector<HTMLInputElement>("[data-query-search]")!;
  await act(() => {
    input.value = "of ANNOTBBB";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(cards(el)).toEqual(["ANNOTBBB"]);
});

function filterFault(from: number, to: number): QueryViewOutcome {
  return {
    kind: "failed",
    diagnostic: {
      code: "unknown-field",
      message: "colourName is not a field of Annotations.",
      hint: "Use colorName.",
      severity: "error",
      report: ["colourName is not a field of Annotations."],
      location: { argument: "filter", span: { from, to } },
      found: "colourName",
      expected: [],
      suggestions: ["colorName"],
    },
  };
}

it("writes a filter change to the file, and runs the view with it", async () => {
  const written: string[] = [];
  const { view, run, settle } = await mount(
    [result([row("ANNOTBBB")]), result([row("ANNOTAAA")])],
    (text) => written.push(text),
  );
  await act(() => view.setText(FILE));
  await settle();

  await act(() => {
    view.document.setFilters("view", {
      and: ['colorName == "yellow"', 'tags.contains("figure")'],
    });
  });
  await settle();

  expect(written).toHaveLength(1);
  expect(written[0]).toContain(`    filters:
      and:
        - colorName == "yellow"
        - tags.contains("figure")`);
  expect(run.mock.calls[1]![0].filter).toBe(
    '(colorName == "yellow") && (tags.contains("figure"))',
  );
});

it("shows a wrong condition's diagnostic at its row and keeps the last good results", async () => {
  const { view, el, settle } = await mount(
    [result([row("ANNOTBBB")]), filterFault(1, 11)],
    () => {},
  );
  await act(() => view.setText(FILE));
  await settle();

  await act(() => {
    view.document.setFilters("view", {
      and: ['colourName == "yellow"', 'tags.contains("figure")'],
    });
  });
  await settle();

  expect(view.state.getState().failure?.filterIssue).toEqual({
    section: "view",
    path: [0],
    message: "colourName is not a field of Annotations. Use colorName.",
    fault: { text: 'colourName == "yellow"', span: { from: 0, to: 10 } },
  });
  expect(cards(el)).toEqual(["ANNOTBBB"]);
  expect(el.querySelector("[data-query-filter-error]")?.textContent).toBe(
    "The filter has an error. The view shows the last results.",
  );
});

/**
 * A syntax fault at the end of the filter text `before`, as ZotLit Query
 * reports it: the caret of its `report` counts the JSON-escaped text.
 */
function endOfFilterFault(at: number | null, before: string): QueryViewOutcome {
  const message =
    "Found end of filter where the filter takes !, (, -, [, a name, a number, a regular expression, a string, false, null, true.";
  const hint =
    "Use !, (, -, [, a name, a number, a regular expression, a string, false, null, true.";
  return {
    kind: "failed",
    diagnostic: {
      code: "invalid-filter",
      message,
      hint,
      severity: "error",
      report: [
        message,
        before,
        `${" ".repeat(JSON.stringify(before).length - 2)}^`,
        hint,
      ],
      excerpt: { before, at: "", after: "" },
      ...(at !== null && {
        location: { argument: "filter", span: { from: at, to: at } },
      }),
      found: "end of filter",
      expected: [
        "!",
        "(",
        "-",
        "[",
        "a name",
        "a number",
        "a regular expression",
        "a string",
        "false",
        "null",
        "true",
      ],
      suggestions: [],
    },
  };
}

it("names the tokens a syntax error lacks once, at the row and in the view's diagnostic, with the caret under the fault", async () => {
  const { view, el, settle } = await mount(
    [
      result([row("ANNOTBBB")]),
      endOfFilterFault(8, "place !="),
      endOfFilterFault(null, 'tags.contains("figure") && place !='),
    ],
    () => {},
  );
  await act(() => view.setText(FILE));
  await settle();

  await act(() => {
    view.document.setFilters("view", "place !=");
  });
  await settle();
  expect(view.state.getState().failure?.filterIssue).toEqual({
    section: "view",
    path: [0],
    message:
      "Found end of filter where the filter takes !, (, -, [, a name, a number, a regular expression, a string, false, null, true.",
    fault: { text: "place !=", span: { from: 8, to: 8 } },
  });

  await act(() => {
    view.document.setFilters("view", {
      and: ['tags.contains("figure")', "place !="],
    });
  });
  await settle();

  expect(view.state.getState().failure?.filterIssue).toBeNull();
  expect(el.querySelector("[data-query-diagnostic] pre")?.textContent).toBe(
    [
      "Found end of filter where the filter takes !, (, -, [, a name, a number, a regular expression, a string, false, null, true.",
      'tags.contains("figure") && place !=',
      `${" ".repeat('tags.contains("figure") && place !='.length)}^`,
    ].join("\n"),
  );
});

function section(el: HTMLElement, name: "all" | "view"): HTMLElement {
  return el.querySelector<HTMLElement>(`[data-filter-section="${name}"]`)!;
}

it("edits the filters for all views and for this view from the Filter popover", async () => {
  const written: string[] = [];
  const { view, el, run, settle } = await mount(
    [result([row("ANNOTBBB")]), result([]), result([])],
    (text) => written.push(text),
  );
  await act(() => view.setText(FILE));
  await settle();

  expect(
    el.querySelector('[data-query-toolbar="filter"]')?.textContent,
  ).toContain("Filter");
  expect(section(el, "all").textContent).toContain("All views");
  expect(section(el, "view").textContent).toContain("This view");

  const [color] = section(el, "view").querySelectorAll("[data-condition-row]");
  await choose(color!.querySelector('[aria-label="Value"]')!, "red");
  await settle();
  expect(written.at(-1)).toContain(
    'filters:\n      and:\n        - colorName == "red"',
  );
  expect(run.mock.calls.at(-1)![0].filter).toBe('colorName == "red"');

  // The empty "All views" section shows one placeholder: a colour condition
  // with no value, which the file does not keep until it has one.
  const all = section(el, "all");
  const [placeholder] = all.querySelectorAll("[data-condition-row]");
  expect(all.querySelectorAll("[data-condition-row]")).toHaveLength(1);
  const writes = written.length;
  expect(
    placeholder!.querySelector<HTMLSelectElement>('select[aria-label="Value"]')!
      .value,
  ).toBe("");
  await choose(placeholder!.querySelector('[aria-label="Value"]')!, "blue");
  await settle();
  expect(written).toHaveLength(writes + 1);
  expect(written.at(-1)).toMatch(
    /^filters:\n  and:\n    - colorName == "blue"\n/,
  );
  expect(run.mock.calls.at(-1)![0].filter).toBe(
    '(colorName == "blue") && (colorName == "red")',
  );
});

it("offers the vault properties in the Filter popover of an Items view, in bracket form", async () => {
  const written: string[] = [];
  const { view, el, settle } = await mount(
    [result([itemRow("ITEMAAAA", "Ten simple rules")])],
    (text) => written.push(text),
    {
      propertyNames: ["reading-status"],
      notes: { ITEMAAAA: "A.md" },
      frontmatter: { "A.md": { "reading-status": "read" } },
    },
  );
  await act(() =>
    view.setText(`views:
  - type: table
    name: Reading list
    from: items
    filters: 'vault["reading-status"] == "read"'
`),
  );
  await settle();

  const [status] = section(el, "view").querySelectorAll("[data-condition-row]");
  const kind = status!.querySelector(
    `[aria-label="${m.workbench_match_condition_kind()}"]`,
  )!;
  // Named as the note's, so it never reads as a database field.
  expect(kind.textContent).toContain(
    m.query_view_vault_property_label({ name: "reading-status" }),
  );
  const input = status!.querySelector<HTMLInputElement>(
    'input[aria-label="Value"]',
  )!;
  expect(input.value).toBe("read");
  await act(() => {
    input.value = "unread";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
  expect(written.at(-1)).toContain(
    'filters:\n      and:\n        - vault["reading-status"] == "unread"',
  );
});

it("filters by a checkbox vault property as true or false from the Filter popover", async () => {
  const written: string[] = [];
  const { view, el, settle } = await mount(
    [result([itemRow("ITEMAAAA", "Ten simple rules")])],
    (text) => written.push(text),
    {
      propertyNames: ["done"],
      notes: { ITEMAAAA: "A.md" },
      frontmatter: { "A.md": { done: true } },
    },
  );
  await act(() =>
    view.setText(`views:
  - type: table
    name: Reading list
    from: items
    filters: 'vault["done"] == true'
`),
  );
  await settle();

  const [done] = section(el, "view").querySelectorAll("[data-condition-row]");
  const kind = done!.querySelector(
    `[aria-label="${m.workbench_match_condition_kind()}"]`,
  )!;
  const operator = done!.querySelector<HTMLSelectElement>("select");
  expect(kind.textContent).toContain("done");
  expect(operator!.selectedOptions[0]?.textContent).toBe(
    m.workbench_filter_op_is_true(),
  );
  // A boolean has no value to type.
  expect(done!.querySelector('input[aria-label="Value"]')).toBeNull();
  await choose(operator!, "is-false");
  await settle();
  expect(written.at(-1)).toContain(
    'filters:\n      and:\n        - vault["done"] == false',
  );
});

it("offers a vault property's operators by its type, as its type changes", async () => {
  const types: Record<string, VaultPropertyType> = {};
  const { view, el, settle, literatureNotes } = await mount(
    [result([itemRow("ITEMAAAA", "Ten simple rules")])],
    () => {},
    {
      propertyNames: ["pages"],
      notes: { ITEMAAAA: "A.md" },
      frontmatter: { "A.md": { pages: "12" } },
      types,
    },
  );
  await act(() =>
    view.setText(`views:
  - type: table
    name: Reading list
    from: items
    filters: 'vault["pages"] == "12"'
`),
  );
  await settle();
  const operators = () => {
    const [row] = section(el, "view").querySelectorAll("[data-condition-row]");
    const operator = row!.querySelector<HTMLSelectElement>("select");
    return [...operator!.options].map((option) => option.value);
  };
  expect(operators()).not.toContain("before");

  types.pages = "number";
  await act(() => literatureNotes.emit("frontmatter-changed"));

  expect(operators()).toContain("before");
});

it("names a filter condition by the Display Name of its field", async () => {
  const { view, el, settle } = await mount(
    [result([row("ANNOTBBB")])],
    () => {},
  );
  await act(() =>
    view.setText(`properties:
  colorName:
    displayName: Highlight colour
${FILE}`),
  );
  await settle();

  const [color] = section(el, "view").querySelectorAll("[data-condition-row]");
  const kinds = (
    await selectOptions(
      color!.querySelector(
        `[aria-label="${m.workbench_match_condition_kind()}"]`,
      )!,
    )
  ).map((option) => option.label);
  expect(kinds).toContain("Highlight colour");
  expect(kinds).not.toContain("Color");
  // A field without a Display Name keeps the name of its condition.
  expect(kinds).toContain("Item title");
});

it("shows the query's diagnostic at the wrong condition in the Filter popover", async () => {
  const { view, el, settle } = await mount(
    [result([row("ANNOTBBB")]), filterFault(1, 11)],
    () => {},
  );
  await act(() => view.setText(FILE));
  await settle();
  await act(() => {
    view.document.setFilters("view", {
      and: ['colourName == "yellow"', 'tags.contains("figure")'],
    });
  });
  await settle();

  const rows = section(el, "view").querySelectorAll("[data-condition-row]");
  expect(rows[0]!.querySelector('[role="alert"]')?.textContent).toBe(
    "colourName is not a field of Annotations. Use colorName.",
  );
  expect(rows[1]!.querySelector('[role="alert"]')).toBeNull();
});

it("offers the Tags and Collections of the Libraries the view reads", async () => {
  const { view } = await mount([]);
  await expect(view.filterValues()).resolves.toEqual({
    tags: ["figure", "group", "method"],
    collections: ["Thesis/Methods"],
    libraries: [
      { id: "personal", name: null },
      { id: "group:4815", name: "Lab" },
    ],
  });
});

it("counts every match, and says how many of them the limit shows", async () => {
  const { view, el, settle } = await mount([
    result([row("ANNOTAAA"), row("ANNOTBBB")], 12),
  ]);
  await act(() => view.setText(FILE));
  await settle();

  const count = el.querySelector("[data-query-count]");
  expect(count?.getAttribute("data-query-count")).toBe("2");
  expect(count?.getAttribute("data-query-matched")).toBe("12");
  expect(count?.textContent).toBe("2 of 12 results");
});

function valued(key: string, comment: string): QueryViewRow {
  return {
    ...row(key),
    values: { ...row(key).values, comment, pageLabel: "4" },
  };
}

it("reads the visible properties with the rows, and gives them as the table's columns in order", async () => {
  const { view, run, settle } = await mount([
    result([valued("ANNOTAAA", "Key figure"), valued("ANNOTBBB", "")]),
  ]);
  await act(() =>
    view.setText(`views:
  - type: annotations
    name: Shared
    from: annotations
    order:
      - pageLabel
      - comment
`),
  );
  await settle();

  expect(run.mock.calls[0]![0].fields).toEqual(
    expect.arrayContaining(["pageLabel", "comment"]),
  );
  expect(view.state.getState().view?.order).toEqual(["pageLabel", "comment"]);
  expect(view.table()).toEqual({
    header: ["pageLabel", "comment"],
    body: [
      ["4", "Key figure"],
      ["4", ""],
    ],
  });
});

it("saves a new order and a new limit to the file, and runs the view again with them", async () => {
  const { view, run, saved, settle } = await mount([]);
  await act(() => view.setText(FILE));
  await settle();

  await act(() => view.document.editView({ order: ["comment"], limit: 5 }));
  await settle();
  expect(saved).toHaveLength(1);
  expect(saved[0]).toContain("    order:\n      - comment\n");
  expect(saved[0]).toContain("    limit: 5\n");
  expect(run.mock.calls.at(-1)![0]).toMatchObject({ limit: 5 });
  expect(view.state.getState().view?.name).toBe("Yellow");

  await act(() => view.document.editView({ limit: undefined }));
  await settle();
  expect(saved[1]).not.toContain("limit: 5");
  expect(run.mock.calls.at(-1)![0]).toMatchObject({ limit: null });
});

/** The rows a List or Cards layout shows, as their Indexed Keys. */
function shownRows(el: HTMLElement): (string | null)[] {
  return [...el.querySelectorAll("[data-query-row]")].map((node) =>
    node.getAttribute("data-query-row"),
  );
}

function item(key: string, title: string, year: string): QueryViewRow {
  return {
    indexedKey: key,
    values: { title, "date.year": year, tags: ["thesis"] },
  };
}

it("shows only the rows the host keeps after the query, cut to the view's limit, and counts them, reading the fields of those rows alone", async () => {
  // The host answers a condition the query cannot: here, which Items have a
  // note in the vault.
  const kept = new Set(["ITEMAAAA", "ITEMCCCC", "ITEMDDDD"]);
  let pass: { key: string; keeps: (indexedKey: string) => boolean } | null = {
    key: "noted",
    keeps: (indexedKey) => kept.has(indexedKey),
  };
  const rows = [
    item("ITEMAAAA", "Ten simple rules", "2021"),
    item("ITEMBBBB", "Reading at scale", "2019"),
    item("ITEMCCCC", "Close reading", "2018"),
    item("ITEMDDDD", "Distant reading", "2013"),
  ];
  const [a, , c, d] = rows as [
    QueryViewRow,
    QueryViewRow,
    QueryViewRow,
    QueryViewRow,
  ];
  // Each condition reads every match by key, then the rows it keeps; the
  // engine gives those back in an order of its own.
  const { view, el, run, settle } = await mount(
    [result(rows), result([c, a]), result(rows), result([d, a]), result(rows)],
    undefined,
    { rowPass: () => pass },
  );
  await act(() =>
    view.setText(`views:
  - type: list
    name: Sources
    from: items
    limit: 2
    order:
      - title
`),
  );
  await settle();
  // The query reads the key of every match, so the limit cuts the kept rows
  // alone; only the rows on screen are read with their fields.
  const [keys, page] = run.mock.calls.map(([request]) => request);
  expect(keys).toMatchObject({ fields: [], limit: null });
  expect(page!.fields).toEqual(expect.arrayContaining(["title"]));
  expect(page!.filter).toBe('["ITEMAAAA","ITEMCCCC"].contains(indexedKey)');
  expect(shownRows(el)).toEqual(["ITEMAAAA", "ITEMCCCC"]);
  expect(el.querySelector("[data-query-row]")?.textContent).toContain(
    "Ten simple rules",
  );
  expect(el.querySelector("[data-query-count]")?.textContent).toBe(
    "2 of 3 results",
  );

  // Another condition of the host runs again, with the same text.
  kept.delete("ITEMCCCC");
  pass = { key: "noted-2", keeps: (indexedKey) => kept.has(indexedKey) };
  await act(() => view.contextChanged());
  await settle();
  expect(run).toHaveBeenCalledTimes(4);
  expect(shownRows(el)).toEqual(["ITEMAAAA", "ITEMDDDD"]);
  expect(el.querySelector("[data-query-count]")?.textContent).toBe("2 results");

  // Without a condition, the query takes the view's limit again.
  pass = null;
  await act(() => view.contextChanged());
  await settle();
  expect(run).toHaveBeenCalledTimes(5);
  expect(run.mock.calls[4]![0]).toMatchObject({ limit: 2 });
});

it("reads no rows where the host keeps none of the matches", async () => {
  const { view, el, run, settle } = await mount(
    [result([item("ITEMAAAA", "Ten simple rules", "2021")])],
    undefined,
    { rowPass: () => ({ key: "none", keeps: () => false }) },
  );
  await act(() =>
    view.setText(`views:
  - type: list
    name: Sources
    from: items
    order:
      - title
`),
  );
  await settle();
  expect(run).toHaveBeenCalledTimes(1);
  expect(shownRows(el)).toEqual([]);
});

it("lists the Items of an items view, with the visible properties in their order", async () => {
  const { view, el, run, settle } = await mount([
    result([
      item("ITEMAAAA", "Ten simple rules", "2021"),
      item("ITEMBBBB", "Reading at scale", "2019"),
    ]),
  ]);
  await act(() =>
    view.setText(`views:
  - type: list
    name: Sources
    from: items
    order:
      - date.year
      - title
`),
  );
  await settle();

  expect(view.state.getState().problems).toEqual([]);
  const [request] = run.mock.calls[0]!;
  expect(request.from).toBe("items");
  expect(request.fields).toEqual(
    expect.arrayContaining(["date.year", "title"]),
  );
  expect(request.fields).not.toContain("color");
  expect(shownRows(el)).toEqual(["ITEMAAAA", "ITEMBBBB"]);
  expect(
    [...el.querySelectorAll("[data-query-row]")].map((n) => n.textContent),
  ).toEqual(["2021, Ten simple rules", "2019, Reading at scale"]);
  expect(cards(el)).toEqual([]);
});

it("switches an Annotations view to Cards and to List, and keeps its rows, filters, sort and grouping", async () => {
  const { view, el, run, settle, saved } = await mount([
    result([
      tagged("ANNOTAAA", ["figure", "method"]),
      tagged("ANNOTBBB", ["method"]),
    ]),
  ]);
  await act(() =>
    view.setText(`views:
  - type: annotations
    name: Tags
    from: annotations
    filters: colorName == "yellow"
    sort:
      - property: dateAdded
        direction: DESC
    groupBy:
      property: tags[]
      direction: ASC
    order:
      - tags
`),
  );
  await settle();
  expect(cards(el)).toEqual(["ANNOTAAA", "ANNOTAAA", "ANNOTBBB"]);

  await act(() => view.document.setViewLayout(0, "cards"));
  await settle();
  expect(cards(el)).toEqual([]);
  expect(shownRows(el)).toEqual(["ANNOTAAA", "ANNOTAAA", "ANNOTBBB"]);
  expect(headings(el)).toEqual(["figure", "method"]);
  expect(el.querySelector("[data-query-count]")?.textContent).toBe("2 results");

  await act(() => view.document.setViewLayout(0, "list"));
  await settle();
  expect(shownRows(el)).toEqual(["ANNOTAAA", "ANNOTAAA", "ANNOTBBB"]);
  expect(headings(el)).toEqual(["figure", "method"]);

  // Each switch saves the layout alone; the query stays as it was.
  const text = saved.at(-1)!;
  expect(text).toContain("type: list");
  expect(text).toContain('filters: colorName == "yellow"');
  expect(text).toContain("property: dateAdded");
  expect(text).toContain("property: tags[]");
  expect(
    new Set(run.mock.calls.map(([request]) => JSON.stringify(request))),
  ).toHaveLength(1);

  // Back on the Annotations layout, the same rows are cards again.
  await act(() => view.document.setViewLayout(0, "annotations"));
  await settle();
  expect(cards(el)).toEqual(["ANNOTAAA", "ANNOTAAA", "ANNOTBBB"]);
  expect(shownRows(el)).toEqual([]);
});

it("draws the List and Cards options at once, and saves them to the file", async () => {
  const { view, el, run, settle, saved } = await mount([
    result([item("ITEMAAAA", "Ten simple rules", "2021")]),
  ]);
  await act(() =>
    view.setText(`views:
  - type: cards
    name: Sources
    from: items
    order:
      - title
      - date.year
`),
  );
  await settle();
  const card = el.querySelector("[data-query-row]")!;
  expect(card.textContent).toBe("Ten simple rulesYear2021");
  expect(
    el.querySelector("[data-card-size]")?.getAttribute("data-card-size"),
  ).toBe("200");

  await act(() => view.document.setViewOption(0, "cardSize", 320));
  expect(
    el.querySelector("[data-card-size]")?.getAttribute("data-card-size"),
  ).toBe("320");
  expect(saved.at(-1)).toContain("cardSize: 320");

  await act(() => view.document.setViewLayout(0, "list"));
  await settle();
  expect(el.querySelector("ul[data-query-markers='bullet']")).not.toBeNull();
  await act(() => view.document.setViewOption(0, "markers", "number"));
  await act(() => view.document.setViewOption(0, "separator", " · "));
  expect(el.querySelector("ol[data-query-markers='number']")).not.toBeNull();
  expect(el.querySelector("[data-query-row]")?.textContent).toBe(
    "Ten simple rules · 2021",
  );
  await act(() => view.document.setViewOption(0, "indentProperties", true));
  expect(
    [...el.querySelectorAll("[data-query-row] span")].map((n) => n.textContent),
  ).toEqual(["Ten simple rules", "2021", "2021"]);
  const text = saved.at(-1)!;
  expect(text).toContain("markers: number");
  expect(text).toContain("indentProperties: true");
  expect(run).toHaveBeenCalledTimes(1);
});

const TABLE_FILE = `views:
  - type: table
    name: Reading list
    from: items
    order:
      - title
      - date
      - vault.literatureNote
`;

function itemRow(
  key: string,
  title: string,
  attachments: string[] = [],
): QueryViewRow {
  return {
    indexedKey: key,
    values: {
      title,
      // A date as ZotLit Query gives it; the Table shows it as Zotero does.
      date: {
        kind: "year",
        value: null,
        year: 2014,
        month: null,
        day: null,
        text: null,
        raw: "2014-00-00 2014",
      },
      itemType: "journalArticle",
      "attachments[].indexedKey": attachments,
    },
  };
}

/** The Table's rows as text: each cell of each row, the header first. */
/** The text of the Table as it shows: a `hidden` name of a cell is not. */
function tableText(el: HTMLElement): string[][] {
  const shown = (node: Node): string =>
    node.instanceOf(HTMLElement) && node.hidden
      ? ""
      : node.nodeType === Node.TEXT_NODE
        ? (node.textContent ?? "")
        : [...node.childNodes].map(shown).join("");
  return [...el.querySelectorAll("[data-query-table] tr")].map((tr) =>
    [...tr.querySelectorAll("th, td")].map((cell) => shown(cell).trim()),
  );
}

it("shows no property in the Table, Cards, List, copy and the run of a view with an empty order", async () => {
  const rows = () =>
    result([
      itemRow("ITEMAAAA", "Ten simple rules"),
      itemRow("ITEMBBBB", "Deep learning"),
    ]);
  // Cards read less than the Table, so the switch runs again.
  const { view, el, run, settle } = await mount([rows(), rows()]);
  await act(() =>
    view.setText(`views:
  - type: table
    name: Reading list
    from: items
    order: []
`),
  );
  await settle();

  // The run asks for what the Table itself reads, and no property.
  const [request] = run.mock.calls[0]!;
  expect(request.fields).not.toContain("title");
  expect(request.fields).not.toContain("itemType");
  // The Table hides the Literature Note Property too, as `order` names it
  // not, and keeps one row for each Item.
  const [header, ...body] = tableText(el);
  expect(header).toEqual([""]);
  expect(body).toHaveLength(2);
  expect(el.querySelector("[data-query-column]")).toBeNull();
  // Copy and CSV write no column.
  expect(view.table()).toEqual({ header: [], body: [] });

  // Cards and List keep one empty record for each Item.
  await act(() => view.document.setViewLayout(0, "cards"));
  await settle();
  expect(shownRows(el)).toEqual(["ITEMAAAA", "ITEMBBBB"]);
  expect(
    [...el.querySelectorAll("[data-query-row]")].map((n) => n.textContent),
  ).toEqual(["", ""]);
  expect(run.mock.calls.at(-1)![0].fields).toEqual([]);
  await act(() => view.document.setViewLayout(0, "list"));
  await settle();
  expect(shownRows(el)).toEqual(["ITEMAAAA", "ITEMBBBB"]);
  expect(
    [...el.querySelectorAll("[data-query-row]")].map((n) => n.textContent),
  ).toEqual(["", ""]);
});

it("shows a column at the width the view keeps, and a double click on its edge sets it back to its auto width in one save", async () => {
  const { view, el, settle, save, saved } = await mount([
    result([itemRow("ITEMAAAA", "Ten simple rules")]),
  ]);
  await act(() =>
    view.setText(`${TABLE_FILE}    columnSize:
      title: 260
`),
  );
  await settle();
  const header = (path: string) =>
    el.querySelector<HTMLElement>(`th[data-query-column="${path}"]`)!;
  expect(header("title").dataset.sized).toBe("");
  expect(header("title").style.getPropertyValue("--zt-column-width")).toBe(
    "260px",
  );
  expect(header("date").dataset.sized).toBeUndefined();

  // A double click on the edge of a column at its auto width saves nothing.
  const edge = (path: string) =>
    header(path).querySelector("[data-query-column-resizer]")!;
  await act(() => {
    edge("date").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  });
  expect(save).not.toHaveBeenCalled();

  await act(async () => {
    edge("title").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await view.flush();
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(saved.at(-1)).not.toContain("columnSize");
  expect(header("title").dataset.sized).toBeUndefined();
});

it("opens the header menu on a click or a right click, with what has nothing to do disabled, not hidden", async () => {
  // A move runs the query again, for the new order of the fields.
  const { view, el, settle, save, saved } = await mount([
    result([itemRow("ITEMAAAA", "Ten simple rules")]),
    result([itemRow("ITEMAAAA", "Ten simple rules")]),
  ]);
  await act(() =>
    view.setText(`${TABLE_FILE}    columnSize:
      vault.literatureNote: 140
`),
  );
  await settle();
  const header = (path: string) =>
    el.querySelector<HTMLElement>(`th[data-query-column="${path}"]`)!;
  const open = (path: string, type: "click" | "contextmenu") => {
    Menu.instances.length = 0;
    void act(() => {
      header(path).dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true }),
      );
    });
    const menu = Menu.instances.at(-1)!;
    return Object.fromEntries(
      menu.items.map((item) => [item.title, item] as const),
    );
  };

  // The first column at its auto width: it can only move right.
  const first = open("title", "contextmenu");
  expect(Object.keys(first)).toEqual([
    "Move left",
    "Move right",
    "Reset column width",
  ]);
  expect(first["Move left"]!.disabled).toBe(true);
  expect(first["Move right"]!.disabled).toBe(false);
  expect(first["Reset column width"]!.disabled).toBe(true);
  first["Reset column width"]!.click();
  expect(save).not.toHaveBeenCalled();

  // The last column, the Literature Note Property, resized: it can move
  // left and reset.
  const last = open("vault.literatureNote", "click");
  expect(last["Move left"]!.disabled).toBe(false);
  expect(last["Move right"]!.disabled).toBe(true);
  expect(last["Reset column width"]!.disabled).toBe(false);
  await act(async () => {
    last["Move left"]!.click();
    await view.flush();
  });
  expect(saved.at(-1)).toContain(
    "    order:\n      - title\n      - vault.literatureNote\n      - date\n",
  );
  await settle();
  expect(
    [...el.querySelectorAll("th[data-query-column]")].map((th) =>
      th.getAttribute("data-query-column"),
    ),
  ).toEqual(["title", "vault.literatureNote", "date"]);

  await act(async () => {
    open("vault.literatureNote", "contextmenu")["Reset column width"]!.click();
    await view.flush();
  });
  expect(saved.at(-1)).not.toContain("columnSize");
});

it("offers no column move and no column resize where the host cannot save", async () => {
  const { view, el, settle } = await mount(
    [result([itemRow("ITEMAAAA", "Ten simple rules")])],
    undefined,
    { canSave: () => false },
  );
  await act(() => view.setText(TABLE_FILE));
  await settle();
  const headers = [...el.querySelectorAll("th[data-query-column]")];
  expect(headers).toHaveLength(3);
  expect(headers.some((th) => th.getAttribute("draggable") === "true")).toBe(
    false,
  );
  expect(el.querySelector("[data-query-column-resizer]")).toBeNull();
});

it("shows the Literature Note Property where the view's order places it, at the width it keeps, and asks ZotLit Query nothing for it", async () => {
  const { view, el, run, settle } = await mount([
    result([itemRow("ITEMAAAA", "Ten simple rules")]),
  ]);
  await act(() =>
    view.setText(`views:
  - type: table
    name: Reading list
    from: items
    order:
      - vault.literatureNote
      - title
    columnSize:
      vault.literatureNote: 180
`),
  );
  await settle();
  expect(tableText(el)).toEqual([
    ["", "Literature note", "Title"],
    ["", "Create", "Ten simple rules"],
  ]);
  const header = el.querySelector<HTMLElement>(
    'th[data-query-column="vault.literatureNote"]',
  )!;
  expect(header.getAttribute("draggable")).toBe("true");
  expect(header.querySelector("[data-query-column-resizer]")).not.toBeNull();
  expect(header.style.getPropertyValue("--zt-column-width")).toBe("180px");
  expect(run.mock.calls[0]![0].fields).not.toContain("vault.literatureNote");
  // Copy and CSV write the values of the rows, which hold no note.
  expect(view.table().header).toEqual(["Title"]);
});

it("asks ZotLit Query for no vault property: none among the fields, the sort or the filter, and the view still runs", async () => {
  const { view, el, run, settle } = await mount([
    result([itemRow("ITEMAAAA", "Ten simple rules")]),
  ]);
  await act(() =>
    view.setText(`filters:
  and:
    - vault["reading-status"] == "read"
    - itemType == "book"
views:
  - type: table
    name: Reading list
    from: items
    filters: 'vault.rating > 3'
    sort:
      - property: vault.reading-status
        direction: ASC
      - property: title
        direction: DESC
    order:
      - title
      - vault.reading-status
      - vault.literatureNote
`),
  );
  await settle();
  expect(view.state.getState().problems).toEqual([]);
  const request = run.mock.calls[0]![0];
  expect(request.fields?.filter((field) => field.startsWith("vault"))).toEqual(
    [],
  );
  expect(request.sort).toEqual([{ field: "title", direction: "desc" }]);
  // The vault conditions reach ZotLit Query only as the Items they keep:
  // here none, since no Item has a Literature Note.
  expect(request.filter).toBe(
    '(itemType == "book")\n&& ([].contains(indexedKey))',
  );
  expect(tableText(el)).toEqual([
    [
      "",
      "Title",
      m.query_view_vault_property_label({ name: "reading-status" }),
      "Literature note",
    ],
    ["", "Ten simple rules", m.query_view_vault_no_note(), "Create"],
  ]);
});

it("expands an Item row into its Attachments, and an Attachment row into its Annotations", async () => {
  const { view, el, run, settle } = await mount([
    result([
      itemRow("ITEMAAAA", "Ten simple rules", ["PDFAAAAA"]),
      itemRow("ITEMBBBB", "Deep learning"),
    ]),
    result([
      {
        indexedKey: "PDFAAAAA",
        values: {
          title: "Full text PDF",
          "annotations[].indexedKey": ["ANNOTAAA"],
        },
      },
    ]),
    result([
      {
        indexedKey: "ANNOTAAA",
        values: {
          text: "Rule 1: know your audience",
          color: "#ffd400",
          pageLabel: "3",
        },
      },
    ]),
  ]);
  await act(() => view.setText(TABLE_FILE));
  await settle();

  // Only an Item with Attachments can expand.
  expect(
    [...el.querySelectorAll("[data-query-expand]")].map((node) =>
      node.getAttribute("data-query-expand"),
    ),
  ).toEqual(["item:ITEMAAAA"]);

  await act(async () => {
    el.querySelector<HTMLElement>(
      '[data-query-expand="item:ITEMAAAA"]',
    )!.click();
  });
  await act(async () => {});
  expect(run.mock.calls[1]![0]).toMatchObject({
    from: "attachments",
    filter: 'item.indexedKey == "ITEMAAAA"',
  });
  await act(async () => {
    el.querySelector<HTMLElement>(
      '[data-query-expand="attachment:PDFAAAAA"]',
    )!.click();
  });
  await act(async () => {});
  expect(run.mock.calls[2]![0]).toMatchObject({
    from: "annotations",
    filter: 'attachment.indexedKey == "PDFAAAAA"',
  });
  expect(tableText(el)).toEqual([
    ["", "Title", "Date", "Literature note"],
    ["", "Ten simple rules", "2014", "Create"],
    ["", "Full text PDF"],
    ["", "Rule 1: know your audiencePage 3"],
    ["", "Deep learning", "2014", "Create"],
  ]);

  // Collapsing the Item hides every row under it.
  await act(async () => {
    el.querySelector<HTMLElement>(
      '[data-query-expand="item:ITEMAAAA"]',
    )!.click();
  });
  expect(tableText(el)).toHaveLength(3);
});

it("links an Item's Literature Note, and creates one where it has none, then links it", async () => {
  const { view, el, settle, literatureNotes } = await mount(
    [
      result([
        itemRow("ITEMAAAA", "Ten simple rules"),
        itemRow("ITEMBBBB", "Deep learning"),
      ]),
    ],
    undefined,
    { notes: { ITEMAAAA: "Rougier 2014.md" } },
  );
  await act(() => view.setText(TABLE_FILE));
  await settle();

  const link = el.querySelector<HTMLElement>(
    '[data-query-note="Rougier 2014.md"]',
  )!;
  expect(link.textContent).toBe("Rougier 2014");
  await act(() => link.click());
  expect(literatureNotes.open).toHaveBeenCalledWith(
    expect.objectContaining({ path: "Rougier 2014.md" }),
    expect.anything(),
  );

  await act(async () => {
    el.querySelector<HTMLElement>(
      '[data-query-create-note="ITEMBBBB"]',
    )!.click();
  });
  expect(literatureNotes.create).toHaveBeenCalledWith("ITEMBBBB");
  expect(el.querySelector("[data-query-create-note]")).toBeNull();
  expect(el.querySelector('[data-query-note="ITEMBBBB.md"]')?.textContent).toBe(
    "ITEMBBBB",
  );
});

it("sorts, groups and searches the Table by Item fields", async () => {
  const { view, el, run, settle } = await mount([
    result([
      {
        ...itemRow("ITEMAAAA", "Ten simple rules"),
        values: {
          ...itemRow("ITEMAAAA", "Ten simple rules").values,
          itemType: "journalArticle",
        },
      },
      {
        ...itemRow("ITEMBBBB", "Deep learning"),
        values: {
          ...itemRow("ITEMBBBB", "Deep learning").values,
          itemType: "book",
        },
      },
    ]),
  ]);
  await act(() =>
    view.setText(`views:
  - type: table
    name: Reading list
    from: items
    sort:
      - property: title
        direction: DESC
    groupBy:
      property: itemType
      direction: ASC
    order:
      - title
`),
  );
  await settle();

  expect(view.state.getState().problems).toEqual([]);
  expect(run.mock.calls[0]![0]).toMatchObject({
    from: "items",
    sort: [{ field: "title", direction: "desc" }],
  });
  expect(tableText(el)).toEqual([
    ["", "Title"],
    ["Book"],
    ["", "Deep learning"],
    ["Journal Article"],
    ["", "Ten simple rules"],
  ]);

  await act(() =>
    el.querySelector<HTMLElement>('[data-query-toolbar="search"]')!.click(),
  );
  const input = el.querySelector<HTMLInputElement>("[data-query-search]")!;
  await act(() => {
    input.value = "deep";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(tableText(el)).toEqual([
    ["", "Title"],
    ["Book"],
    ["", "Deep learning"],
  ]);
});

it("names and searches the properties of Items in Cards and List as the Table does", async () => {
  const { view, el, settle } = await mount([
    result([
      itemRow("ITEMAAAA", "Ten simple rules"),
      {
        ...itemRow("ITEMBBBB", "Deep learning"),
        values: {
          ...itemRow("ITEMBBBB", "Deep learning").values,
          itemType: "book",
        },
      },
    ]),
  ]);
  await act(() =>
    view.setText(`views:
  - type: cards
    name: Reading list
    from: items
    order:
      - title
      - itemType
`),
  );
  await settle();

  // A card names each property by its label and shows its value as text.
  const card = el.querySelector("[data-query-row]")!;
  expect(
    [...card.children].slice(1).map((part) => ({
      label: part.children[0]?.textContent,
      value: part.children[1]?.textContent,
    })),
  ).toEqual([{ label: "Item Type", value: "Journal Article" }]);

  const search = async (text: string) => {
    if (!el.querySelector("[data-query-search]"))
      await act(() =>
        el.querySelector<HTMLElement>('[data-query-toolbar="search"]')!.click(),
      );
    const input = el.querySelector<HTMLInputElement>("[data-query-search]")!;
    await act(() => {
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  // The search finds the text on screen, not the stored value.
  await search("journal article");
  expect(shownRows(el)).toEqual(["ITEMAAAA"]);
  await search("journalarticle");
  expect(shownRows(el)).toEqual([]);

  await act(() => view.document.setViewLayout(0, "list"));
  await settle();
  await search("journal article");
  expect(shownRows(el)).toEqual(["ITEMAAAA"]);
  await search("journalarticle");
  expect(shownRows(el)).toEqual([]);
});

it("offers Item fields to sort and group a view of Items by", async () => {
  const { view, el, settle } = await mount([result([])]);
  await act(() => view.setText(TABLE_FILE));
  await settle();
  await act(() =>
    el.querySelector<HTMLElement>('[data-query-toolbar="group"]')!.click(),
  );
  const offered = await selectOptions(
    document.querySelector("[data-group-property]")!,
  );
  expect(offered.map((option) => option.label)).toContain("Item Type");
  expect(document.body.textContent).not.toContain("Attachment");
});

/**
 * Representative groupings from each dataset, with each row's values and
 * heading. A List that shows none of the grouping's fields still gathers
 * its rows by them.
 */
const GROUPINGS: {
  dataset: QueryFileDataset;
  path: string;
  values: QueryViewRow["values"];
  heading: string;
}[] = [
  {
    dataset: "annotations",
    path: "colorName",
    values: { color: "#ffd400", colorName: "yellow" },
    heading: "Yellow",
  },
  {
    dataset: "attachments",
    path: "item.indexedKey",
    values: { "item.title": "Ten simple rules" },
    heading: "Ten simple rules",
  },
  {
    dataset: "items",
    path: "itemType",
    values: { itemType: "journalArticle" },
    heading: "Journal Article",
  },
];

it.each(GROUPINGS)(
  "gathers a List of $dataset by $path, though it shows none of its fields",
  async ({ dataset, path, values, heading }) => {
    const { view, el, run, settle } = await mount([
      result([
        {
          indexedKey: "RECORDAA",
          ...(dataset !== "items" && { itemIndexedKey: "ITEMAAAA" }),
          ...(dataset === "annotations" && {
            attachmentIndexedKey: "PDFAAAAA",
          }),
          values: { ...values, dateAdded: "2024-05-01" },
        },
      ]),
    ]);
    await act(() =>
      view.setText(`views:
  - type: list
    name: Grouped
    from: ${dataset}
    groupBy:
      property: ${path}
      direction: ASC
    order:
      - dateAdded
`),
    );
    await settle();

    expect(view.state.getState().problems).toEqual([]);
    expect(run.mock.calls[0]![0].fields).toEqual(
      expect.arrayContaining(Object.keys(values)),
    );
    expect(headings(el)).toEqual([heading]);
  },
);

it("says a view of Items cannot show their tags, and still groups the Items by them", async () => {
  const { view, el, settle } = await mount([
    result([
      {
        indexedKey: "ITEMAAAA",
        values: {
          title: "Ten simple rules",
          tags: [{ name: "read-later", type: "manual" }],
        },
      },
    ]),
  ]);
  await act(() =>
    view.setText(`views:
  - type: list
    name: Tagged
    from: items
    groupBy:
      property: tags[]
      direction: ASC
    order:
      - title
      - tags
`),
  );
  await settle();

  expect(el.querySelector("[data-query-unused]")?.textContent).toBe(
    "Views of Items cannot show these properties: Tag.",
  );
  expect(headings(el)).toEqual(["read-later"]);
});

it("says a view of Items cannot sort by their tags, and runs without that sort", async () => {
  const { view, el, run, settle } = await mount([
    result([itemRow("ITEMAAAA", "Ten simple rules")]),
  ]);
  await act(() =>
    view.setText(`views:
  - type: table
    name: Tagged
    from: items
    sort:
      - property: tags
        direction: ASC
`),
  );
  await settle();

  expect(run.mock.calls.at(-1)![0]).not.toHaveProperty("sort");
  expect(el.querySelector("[data-query-unused]")?.textContent).toBe(
    "Views of Items cannot sort by these properties: Tag.",
  );
});

it("switches a view of Annotations to Items, saves it, and draws the Items in the Table", async () => {
  const { view, el, run, saved, settle } = await mount([
    result([row("ANNOTBBB")]),
    result([itemRow("ITEMAAAA", "Ten simple rules")]),
  ]);
  await act(() => view.setText(FILE));
  await settle();
  expect(cards(el)).toEqual(["ANNOTBBB"]);

  await act(() => view.document.setViewDataset(0, "items"));
  await settle();
  expect(saved.at(-1)).toContain("type: table");
  expect(saved.at(-1)).toContain("from: items");
  expect(run.mock.calls.at(-1)![0]).toMatchObject({ from: "items" });
  expect(cards(el)).toEqual([]);
  // A view with no visible properties shows the default fields of Items.
  const [header, first] = tableText(el);
  expect(header).toContain("Title");
  expect(first).toContain("Journal Article");
  expect(first).toContain("Ten simple rules");
  expect(first!.at(-1)).toBe("Create");
});

it("keeps what the new dataset lacks in the file, says the view does not use it, and uses it again on the old dataset", async () => {
  const { view, el, run, saved, settle } = await mount([
    result([row("ANNOTBBB")]),
    result([itemRow("ITEMAAAA", "Ten simple rules")]),
    result([row("ANNOTBBB")]),
  ]);
  await act(() =>
    view.setText(`views:
  - type: annotations
    name: Yellow
    from: annotations
    sort:
      - property: pageIndex
        direction: ASC
    groupBy:
      property: item.indexedKey
      direction: ASC
`),
  );
  await settle();

  await act(() => view.document.setViewDataset(0, "items"));
  await settle();
  // The file keeps the sort and the grouping; the Items run without them.
  expect(saved.at(-1)).toContain("property: pageIndex");
  expect(saved.at(-1)).toContain("property: item.indexedKey");
  const items = run.mock.calls.at(-1)![0];
  expect(items).toMatchObject({ from: "items" });
  expect(items).not.toHaveProperty("sort");
  expect(view.state.getState().problems).toEqual([]);
  expect(tableText(el)[1]).toContain("Ten simple rules");
  expect(el.querySelector("[data-query-unused]")?.textContent).toBe(
    "Items have none of these properties, so this view does not use them: Page, Parent item.",
  );
  await act(() =>
    el.querySelector<HTMLElement>('[data-query-toolbar="sort"]')!.click(),
  );
  expect(
    document.body
      .querySelector('[data-sort-row="pageIndex"]')
      ?.hasAttribute("data-sort-unused"),
  ).toBe(true);
  await act(() =>
    el.querySelector<HTMLElement>('[data-query-toolbar="group"]')!.click(),
  );
  expect(document.body.querySelector("[data-group-unused]")).not.toBeNull();

  await act(() => view.document.setViewDataset(0, "annotations"));
  await settle();
  expect(run.mock.calls.at(-1)![0]).toMatchObject({
    from: "annotations",
    sort: [{ field: "pageIndex", direction: "asc" }],
  });
  expect(el.querySelector("[data-query-unused]")).toBeNull();
  expect(
    view.state.getState().results!.groups.map((group) => group.label),
  ).toEqual(["Ten simple rules"]);
});

it("shows no rows of the old dataset when the filters fail on the new one", async () => {
  const { view, el, settle } = await mount([
    result([row("ANNOTBBB")]),
    filterFault(0, 9),
  ]);
  await act(() => view.setText(FILE));
  await settle();

  await act(() => {
    view.document.setViewDataset(0, "items");
  });
  await settle();
  expect(view.state.getState()).toMatchObject({
    phase: "failed",
    results: null,
  });
  expect(cards(el)).toEqual([]);
});

const FORMULA_FILE = `formulas:
  year: date.year
  short: title.nope()
  unused: title
views:
  - type: table
    name: Reading list
    from: items
    order:
      - title
      - formula.year
      - formula.short
`;

function formulaRow(key: string, title: string, year: number): QueryViewRow {
  return { indexedKey: key, values: { title, "formula.year": year } };
}

it("runs a view with every Formula of the file, and shows the values of those it shows", async () => {
  const { view, el, run, settle } = await mount([
    result([formulaRow("ITEMAAAA", "Ten simple rules", 2014)]),
  ]);
  await act(() =>
    view.setText(FORMULA_FILE.replace("      - formula.short\n", "")),
  );
  await settle();

  expect(run).toHaveBeenCalledTimes(1);
  const [request] = run.mock.calls[0]!;
  expect(request.formulas).toEqual({
    year: "date.year",
    short: "title.nope()",
    unused: "title",
  });
  expect(request.fields).toEqual(expect.arrayContaining(["formula.year"]));
  expect(request.fields).not.toContain("formula.short");
  expect(tableText(el)).toEqual([
    ["", "Title", "formula.year"],
    ["", "Ten simple rules", "2014"],
  ]);
});

/** The Diagnostic of a Formula that ZotLit Query left out. */
type Diagnostic = FormulaDiagnostics[string];

/** `outcome` with the Formulas that ZotLit Query left out. */
function withFaults(
  outcome: QueryViewOutcome,
  faults: Record<string, Diagnostic>,
): QueryViewOutcome {
  const formulaDiagnostics = nameDictionary(Object.entries(faults));
  if (outcome.kind === "result")
    return { ...outcome, result: { ...outcome.result, formulaDiagnostics } };
  if (outcome.kind === "failed") return { ...outcome, formulaDiagnostics };
  return outcome;
}

/** The Diagnostic of a Formula that reads the wrong Formula `name`. */
function readsFault(reader: string, name: string, root: string): Diagnostic {
  return {
    code: "reads-faulted-formula",
    message: `formula.${reader} reads formula.${name}, which has a mistake.`,
    hint: `Correct the mistake in formula.${root}.`,
    severity: "error",
    report: [],
    location: {
      argument: "formulas",
      path: reader,
      span: { from: 0, to: 9 + name.length },
    },
    found: `formula.${name}`,
    expected: ["a Formula without a mistake"],
    suggestions: [],
  };
}

it("marks a wrong Formula at its column from the one run, and shows the other columns", async () => {
  const { view, el, run, settle } = await mount([
    withFaults(result([formulaRow("ITEMAAAA", "Ten simple rules", 2014)]), {
      short: {
        code: "unknown-function",
        message: "In formula.short: nope is not a method of string.",
        hint: "Use slice.",
        severity: "error",
        report: [],
        location: {
          argument: "formulas",
          path: "short",
          span: { from: 6, to: 10 },
        },
        found: "nope",
        expected: [],
        suggestions: [],
      },
    }),
  ]);
  await act(() => view.setText(FORMULA_FILE));
  await settle();

  expect(run).toHaveBeenCalledTimes(1);
  expect(view.state.getState()).toMatchObject({
    phase: "ready",
    results: {
      formulaIssues: {
        short: {
          message:
            "In formula.short: nope is not a method of string. Use slice.",
        },
      },
    },
  });
  // The formula page underlines the Fault at its place in the text the run
  // planned.
  expect(formulaIssuesOf(view.state.getState())).toEqual({
    short: {
      message: "In formula.short: nope is not a method of string. Use slice.",
      place: { text: "title.nope()", span: { from: 6, to: 10 } },
    },
  });
  expect(tableText(el)).toEqual([
    ["", "Title", "formula.year", "formula.short"],
    ["", "Ten simple rules", "2014", ""],
  ]);
  expect(
    el
      .querySelector('[data-query-column="formula.short"]')
      ?.getAttribute("data-query-formula-issue"),
  ).toBe("In formula.short: nope is not a method of string. Use slice.");

  // The same text runs as it did; a fixed Formula runs again.
  await act(() => view.setText(FORMULA_FILE));
  await settle();
  expect(run).toHaveBeenCalledTimes(1);
  await act(() =>
    view.setText(FORMULA_FILE.replace("title.nope()", "title.slice(0, 3)")),
  );
  await settle();
  expect(run).toHaveBeenCalledTimes(2);
  expect(formulaIssuesOf(view.state.getState())).toEqual({});
});

it("keeps the count, the Formula marks and the Error Values with the last results on a filter error", async () => {
  const wrong = {
    kind: "error",
    code: "unparseable-text",
    message: 'number() cannot read "x" as a number.',
  };
  const { view, el, settle } = await mount(
    [
      withFaults(
        result([
          {
            indexedKey: "ITEMAAAA",
            values: { title: "Ten simple rules", "formula.year": wrong },
          },
        ]),
        {
          short: {
            code: "unknown-function",
            message: "In formula.short: nope is not a method of string.",
            hint: "Use slice.",
            severity: "error",
            report: [],
            location: {
              argument: "formulas",
              path: "short",
              span: { from: 6, to: 10 },
            },
            found: "nope",
            expected: [],
            suggestions: [],
          },
        },
      ),
      filterFault(1, 11),
    ],
    () => {},
  );
  await act(() => view.setText(FORMULA_FILE));
  await settle();
  await act(() => {
    view.document.setFilters("view", {
      and: ['colourName == "yellow"', 'title.contains("rules")'],
    });
  });
  await settle();

  expect(view.state.getState()).toMatchObject({
    phase: "failed",
    results: {
      count: 1,
      formulaIssues: {
        short: {
          message:
            "In formula.short: nope is not a method of string. Use slice.",
        },
      },
    },
  });
  expect(el.querySelector("[data-query-filter-error]")).not.toBeNull();
  expect(el.querySelector("[data-query-count]")?.textContent).toBe("1 result");
  expect(
    el
      .querySelector('[data-query-column="formula.short"]')
      ?.getAttribute("data-query-formula-issue"),
  ).toBe("In formula.short: nope is not a method of string. Use slice.");
  expect(
    el
      .querySelector('[data-query-table-row="item"] [data-query-error]')
      ?.getAttribute("data-query-error"),
  ).toBe("unparseable-text");
});

it("keeps the warnings of the last results on a filter error, and shows them", async () => {
  const warned = result([row("ANNOTBBB")]);
  if (warned.kind !== "result") throw new Error("unreachable");
  const warning: QuerySummary["warnings"][number] = {
    code: "never-true",
    severity: "warning",
    message: "colorName == 1 is never true.",
    hint: "Compare values of the same type.",
    report: [],
    found: "colorName == 1",
    expected: ["true"],
    suggestions: [],
  };
  const { view, el, settle } = await mount(
    [
      { kind: "result", result: { ...warned.result, warnings: [warning] } },
      filterFault(1, 11),
    ],
    () => {},
  );
  await act(() => view.setText(FILE));
  await settle();
  await act(() => {
    view.document.setFilters("view", {
      and: ['colourName == "yellow"', 'tags.contains("figure")'],
    });
  });
  await settle();

  expect(view.state.getState()).toMatchObject({
    phase: "failed",
    results: {
      warnings: [
        { code: "never-true", message: "colorName == 1 is never true." },
      ],
    },
  });
  expect(
    el.querySelector('[data-query-warning="never-true"]')?.textContent,
  ).toBe("colorName == 1 is never true.");
});

it("keeps the Formula marks of the cards on screen when it keeps back a run", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  cleanup.defer(() => {
    vi.useRealTimers();
  });
  const fault = (message: string): Diagnostic => ({
    code: "unknown-function",
    message,
    hint: "",
    severity: "error",
    report: [],
    found: "nope",
    expected: [],
    suggestions: [],
  });
  const { view, run, repository, setList, settle } = await mount(
    [
      withFaults(result([row("ANNOTBBB")]), { short: fault("First run.") }),
      // Zotero's database does not hold the new Annotation yet.
      withFaults(result([row("ANNOTBBB")]), { short: fault("Second run.") }),
    ],
    undefined,
    { layout: { showNewRecords: true } },
  );
  await act(() => view.setText(`formulas:\n  short: title.nope()\n${FILE}`));
  await settle();

  setList({
    ...LIST,
    annotations: [...LIST.annotations, record("ANNOTCCC", "PDFAAAAA")],
  });
  repository.emit("annotations-changed", "PDFAAAAA");
  await settle();
  await act(() => {
    vi.advanceTimersByTime(RERUN_DELAY_MS);
  });
  await settle();

  expect(run).toHaveBeenCalledTimes(2);
  expect(formulaIssuesOf(view.state.getState())).toEqual({
    short: { message: "First run." },
  });
});

const DEPENDENT_FILE = `formulas:
  year: date.year
  next: formula.year + 1
  after: formula.next * 2
  short: title.slice(0, 3)
views:
  - type: table
    name: Reading list
    from: items
    order:
      - title
      - formula.year
      - formula.next
      - formula.after
      - formula.short
`;

const YEAR_FAULT: Diagnostic = {
  code: "unknown-field",
  message: "In formula.year: dat is not a field of Items.",
  hint: "Use date.",
  severity: "error",
  report: [],
  location: { argument: "formulas", path: "year", span: { from: 0, to: 3 } },
  found: "dat",
  expected: [],
  suggestions: ["date"],
};

const DEPENDENT_FAULTS = {
  year: YEAR_FAULT,
  next: readsFault("next", "year", "year"),
  after: readsFault("after", "next", "year"),
};

it("marks a wrong Formula and each Formula that reads it with its own reason", async () => {
  const { view, el, run, settle } = await mount([
    withFaults(
      result([
        {
          indexedKey: "ITEMAAAA",
          values: { title: "Ten simple rules", "formula.short": "Ten" },
        },
      ]),
      DEPENDENT_FAULTS,
    ),
  ]);
  await act(() => view.setText(DEPENDENT_FILE));
  await settle();

  expect(run).toHaveBeenCalledTimes(1);
  expect(view.state.getState()).toMatchObject({
    phase: "ready",
    results: {
      formulaIssues: {
        year: {
          message: "In formula.year: dat is not a field of Items. Use date.",
        },
        next: {
          message:
            "formula.next reads formula.year, which has a mistake. Correct the mistake in formula.year.",
        },
        after: {
          message:
            "formula.after reads formula.next, which has a mistake. Correct the mistake in formula.year.",
        },
      },
    },
  });
  expect(tableText(el)).toEqual([
    [
      "",
      "Title",
      "formula.year",
      "formula.next",
      "formula.after",
      "formula.short",
    ],
    ["", "Ten simple rules", "", "", "", "Ten"],
  ]);
});

it("marks the condition that reads a wrong Formula, and shows no rows until it is fixed", async () => {
  const filtered = DEPENDENT_FILE.replace(
    "      - formula.short\n",
    "      - formula.short\n    filters: formula.next > 2000\n",
  );
  const { view, el, run, settle } = await mount([
    result([formulaRow("ITEMAAAA", "Ten simple rules", 2014)]),
    withFaults(
      {
        kind: "failed",
        diagnostic: {
          code: "reads-faulted-formula",
          message: "The filter reads formula.next, which has a mistake.",
          hint: "Correct the mistake in formula.year.",
          severity: "error",
          report: [],
          location: { argument: "filter", span: { from: 0, to: 12 } },
          found: "formula.next",
          expected: ["a Formula without a mistake"],
          suggestions: [],
        },
      },
      DEPENDENT_FAULTS,
    ),
    result([formulaRow("ITEMAAAA", "Ten simple rules", 2014)]),
  ]);
  await act(() => view.setText(filtered));
  await settle();
  expect(tableText(el)).toHaveLength(2);

  await act(() => view.setText(filtered.replace("date.year", "dat.year")));
  await settle();

  expect(run).toHaveBeenCalledTimes(2);
  expect(view.state.getState()).toMatchObject({
    phase: "failed",
    results: null,
    failure: {
      filterIssue: {
        section: "view",
        path: [0],
        message:
          "The filter reads formula.next, which has a mistake. Correct the mistake in formula.year.",
      },
      formulaIssues: {
        year: {
          message: "In formula.year: dat is not a field of Items. Use date.",
        },
        next: {
          message:
            "formula.next reads formula.year, which has a mistake. Correct the mistake in formula.year.",
        },
      },
    },
  });
  expect(el.querySelector('[data-query-table-row="item"]')).toBeNull();

  await act(() => view.setText(filtered));
  await settle();
  expect(run).toHaveBeenCalledTimes(3);
  expect(view.state.getState()).toMatchObject({
    phase: "ready",
    failure: null,
    results: { formulaIssues: {} },
  });
  expect(tableText(el)).toHaveLength(2);
});

it("shows no rows while the filters read a Formula that the file no longer defines", async () => {
  const file = `formulas:
  year: date.year
views:
  - type: table
    name: Reading list
    from: items
    filters: formula . year > 2000
    order:
      - title
`;
  const { view, el, run, settle } = await mount([
    result([formulaRow("ITEMAAAA", "Ten simple rules", 2014)]),
    {
      kind: "failed",
      diagnostic: {
        code: "unknown-formula",
        message:
          '"formula.year" reads the Formula "year", which the request does not define.',
        hint: "Define the Formula in formulas.",
        severity: "error",
        report: [],
        location: { argument: "filter", span: { from: 0, to: 14 } },
        found: "year",
        expected: [],
        suggestions: [],
      },
    },
  ]);
  await act(() => view.setText(file));
  await settle();
  expect(run.mock.calls[0]![0].formulas).toEqual({ year: "date.year" });
  expect(tableText(el)).toHaveLength(2);

  await act(() =>
    view.setText(file.replace("formulas:\n  year: date.year\n", "")),
  );
  await settle();
  expect(run).toHaveBeenCalledTimes(2);
  expect(view.state.getState()).toMatchObject({
    phase: "failed",
    results: null,
    failure: {
      filterIssue: {
        section: "view",
        path: [0],
        message:
          '"formula.year" reads the Formula "year", which the request does not define. Define the Formula in formulas.',
      },
    },
  });
  expect(el.querySelector('[data-query-table-row="item"]')).toBeNull();
});

it("marks a Formula whose name is also an object member, such as __proto__", async () => {
  const { view, el, run, settle } = await mount([
    withFaults(result([formulaRow("ITEMAAAA", "Ten simple rules", 2014)]), {
      ["__proto__"]: {
        code: "unknown-field",
        message: "In formula.__proto__: dat is not a field of Items.",
        hint: "",
        severity: "error",
        report: [],
        location: { argument: "formulas", path: "__proto__" },
        found: "dat",
        expected: [],
        suggestions: [],
      },
    }),
  ]);
  await act(() =>
    view.setText(`formulas:
  __proto__: dat.year
  constructor: title
views:
  - type: table
    name: Reading list
    from: items
    order:
      - title
      - formula.__proto__
      - formula.constructor
`),
  );
  await settle();
  expect(Object.entries(run.mock.calls[0]![0].formulas ?? {})).toEqual([
    ["__proto__", "dat.year"],
    ["constructor", "title"],
  ]);
  expect(Object.entries(formulaIssuesOf(view.state.getState()))).toEqual([
    [
      "__proto__",
      { message: "In formula.__proto__: dat is not a field of Items." },
    ],
  ]);
  expect(
    el
      .querySelector('[data-query-column="formula.__proto__"]')
      ?.getAttribute("data-query-formula-issue"),
  ).toBe("In formula.__proto__: dat is not a field of Items.");
});

it("sends a sort by a Formula to ZotLit Query, and shows a grouping by a Formula as the view's problem", async () => {
  const file = `formulas:
  year: date.year
views:
  - type: table
    name: Reading list
    from: items
    sort:
      - property: formula.year
        direction: DESC
    order:
      - title
`;
  const { view, run, settle } = await mount([result([])]);
  await act(() => view.setText(file));
  await settle();
  expect(view.state.getState().problems).toEqual([]);
  expect(run.mock.calls[0]![0].sort).toEqual([
    { field: "formula.year", direction: "desc" },
  ]);

  await act(() =>
    view.setText(
      file.replace(
        "    order:",
        "    groupBy:\n      property: formula.year\n      direction: ASC\n    order:",
      ),
    ),
  );
  await settle();
  expect(view.state.getState().problems).toEqual([
    'This view cannot group by "formula.year".',
  ]);
});

it("shows each Error Value element of a list cell as a warning icon in the Table, the List and the Cards", async () => {
  const wrong = (text: string) => ({
    kind: "error",
    code: "unparseable-text",
    message: `number() cannot read "${text}" as a number.`,
  });
  const parts = [1, wrong("a"), null, wrong("b")];
  const shown = result([
    {
      indexedKey: "ITEMAAAA",
      values: { title: "Ten simple rules", "formula.parts": parts },
    },
  ]);
  // The List and the Cards ask for other fields than the Table.
  const { view, el, settle } = await mount([shown, shown, shown]);
  await act(() =>
    view.setText(`formulas:
  parts: '[1, number("a"), null, number("b")]'
views:
  - type: table
    name: Reading list
    from: items
    order:
      - title
      - formula.parts
`),
  );
  await settle();
  const marks = (root: Element) =>
    [...root.querySelectorAll("[data-query-error]")].map((n) => [
      n.getAttribute("data-query-error"),
      n.getAttribute("aria-label"),
    ]);
  const expected = [
    ["unparseable-text", 'number() cannot read "a" as a number.'],
    ["unparseable-text", 'number() cannot read "b" as a number.'],
  ];

  const cell = el.querySelector('[data-query-table-row="item"]')!.children[2]!;
  expect(marks(cell)).toEqual(expected);
  expect(cell.textContent).toBe("1, , ");
  for (const layout of ["list", "cards"] as const) {
    await act(() => view.document.setViewLayout(0, layout));
    await settle();
    const row = el.querySelector("[data-query-row]")!;
    expect(marks(row)).toEqual(expected);
    expect(row.textContent).not.toContain("Error");
  }
  // Copy and CSV write each Error Value as its message.
  expect(view.table().body).toEqual([
    [
      "Ten simple rules",
      '1, Error: number() cannot read "a" as a number., Error: number() cannot read "b" as a number.',
    ],
  ]);
});

it("ticks the default properties of a view without order, and a tick writes them with it", async () => {
  const written: string[] = [];
  const { view, el, settle } = await mount([result([]), result([])], (text) =>
    written.push(text),
  );
  await act(() =>
    view.setText(`views:
  - type: table
    name: Reading list
    from: items
`),
  );
  await settle();
  await act(() => {
    el.querySelector<HTMLElement>("[data-query-properties]")!.click();
    // happy-dom has no popover, so the test sends the event that opens it.
    document
      .querySelector("[data-query-properties-popup]")!
      .dispatchEvent(
        Object.assign(new Event("beforetoggle"), { newState: "open" }),
      );
  });
  const rows = [
    ...document.querySelectorAll<HTMLElement>("[data-query-property]"),
  ];
  expect(
    rows
      .slice(0, 5)
      .map((row) => [row.dataset.queryProperty, row.dataset.hidden]),
  ).toEqual([
    ["itemType", undefined],
    ["title", undefined],
    ["dateModified", undefined],
    // The Table shows the Literature Note Property after the default fields.
    ["vault.literatureNote", undefined],
    ["abstractNote", ""],
  ]);
  await act(() => rows[4]!.click());
  await settle();
  expect(written.at(-1)).toContain(
    "order:\n      - itemType\n      - title\n      - dateModified\n      - vault.literatureNote\n      - abstractNote\n",
  );
});

it("offers the Literature Note Property in the Properties popover of a Table that hides it, and a tick shows it again", async () => {
  const written: string[] = [];
  const { view, el, settle } = await mount(
    [result([itemRow("ITEMAAAA", "Ten simple rules")])],
    (text) => written.push(text),
  );
  await act(() =>
    view.setText(`views:
  - type: table
    name: Reading list
    from: items
    order:
      - title
`),
  );
  await settle();
  expect(tableText(el)[0]).toEqual(["", "Title"]);
  await act(() => {
    el.querySelector<HTMLElement>("[data-query-properties]")!.click();
    // happy-dom has no popover, so the test sends the event that opens it.
    document
      .querySelector("[data-query-properties-popup]")!
      .dispatchEvent(
        Object.assign(new Event("beforetoggle"), { newState: "open" }),
      );
  });
  // Its path has a dot, as the fields of a parent record do, yet it shows
  // without a search.
  const row = document.querySelector<HTMLElement>(
    '[data-query-property="vault.literatureNote"]',
  );
  expect(row?.dataset.hidden).toBe("");
  expect(row?.textContent).toContain("Literature note");
  await act(() => row!.click());
  await settle();
  expect(written.at(-1)).toContain(
    "order:\n      - title\n      - vault.literatureNote\n",
  );
  expect(tableText(el)[0]).toEqual(["", "Title", "Literature note"]);
});

it("keeps the row of a nested property in the Properties popover when a tick hides it", async () => {
  const written: string[] = [];
  const { view, el, settle } = await mount([result([]), result([])], (text) =>
    written.push(text),
  );
  await act(() =>
    view.setText(`views:
  - type: annotations
    name: Everything
    from: annotations
    order:
      - type
      - item.title
`),
  );
  await settle();
  await act(() => {
    el.querySelector<HTMLElement>("[data-query-properties]")!.click();
    // happy-dom has no popover, so the test sends the event that opens it.
    document
      .querySelector("[data-query-properties-popup]")!
      .dispatchEvent(
        Object.assign(new Event("beforetoggle"), { newState: "open" }),
      );
  });
  const row = () =>
    document.querySelector<HTMLElement>('[data-query-property="item.title"]');
  const listed = () =>
    [...document.querySelectorAll<HTMLElement>("[data-query-property]")].map(
      (row) => row.dataset.queryProperty,
    );
  const before = listed();
  expect(row()?.dataset.hidden).toBe(undefined);
  await act(() => row()!.click());
  await settle();
  expect(written.at(-1)).toContain("order:\n      - type\n");
  expect(written.at(-1)).not.toContain("item.title");
  // A tick leaves its row in place, so a second tick shows it again.
  expect(row()?.dataset.hidden).toBe("");
  expect(listed()).toEqual(before);
});

it("keeps the row and the page of a typed path in the Properties popover when it hides the path", async () => {
  const written: string[] = [];
  const { view, el, settle } = await mount(
    [result([]), result([]), result([])],
    (text) => written.push(text),
  );
  await act(() =>
    view.setText(`views:
  - type: annotations
    name: Everything
    from: annotations
    order:
      - type
      - myField
      - comment
`),
  );
  await settle();
  await act(() => {
    el.querySelector<HTMLElement>("[data-query-properties]")!.click();
    // happy-dom has no popover, so the test sends the event that opens it.
    document
      .querySelector("[data-query-properties-popup]")!
      .dispatchEvent(
        Object.assign(new Event("beforetoggle"), { newState: "open" }),
      );
  });
  const row = () =>
    document.querySelector<HTMLElement>('[data-query-property="myField"]');
  await act(() => row()!.click());
  await settle();
  expect(written.at(-1)).not.toContain("myField");
  expect(row()?.dataset.hidden).toBe("");
  // Its page, opened from the row, stays open as it shows and hides the path.
  await act(() =>
    document
      .querySelector<HTMLElement>('[data-query-property-more="myField"]')!
      .click(),
  );
  const page = () =>
    document.querySelector('[data-query-property-page="myField"]');
  // happy-dom has no popover, so the menu's hidePopover does nothing here.
  const proto: Partial<HTMLElement> = HTMLElement.prototype;
  if (!proto.hidePopover) {
    proto.hidePopover = () => {};
    onTestFinished(() => {
      delete proto.hidePopover;
    });
  }
  const pick = (hook: string) =>
    document
      .querySelector<HTMLElement>(`[data-chooser-page-menu-item="${hook}"]`)!
      .click();
  expect(page()).not.toBe(null);
  await act(() => pick("show"));
  await settle();
  expect(written.at(-1)).toContain("myField");
  await act(() => pick("hide"));
  await settle();
  expect(written.at(-1)).not.toContain("myField");
  expect(page()).not.toBe(null);
});

const PAPERS_FILE = `views:
  - type: papers
    name: Papers
    from: items
`;

function paperRow(
  key: string,
  values: {
    title: string;
    creators?: { family: string; literal?: string; role: string }[];
    year?: number;
    publicationTitle?: string;
    publisher?: string;
    fileTypes?: string[];
    attachments?: string[];
    itemType?: string;
  },
): QueryViewRow {
  return {
    indexedKey: key,
    values: {
      title: values.title,
      creators: (values.creators ?? []).map(({ family, literal, role }) => ({
        family: literal ? "" : family,
        given: "",
        literal: literal ?? null,
        role,
        fullName: literal ?? family,
      })),
      date:
        values.year === undefined
          ? null
          : {
              kind: "year",
              value: null,
              year: values.year,
              month: null,
              day: null,
              text: null,
              raw: `${values.year}-00-00 ${values.year}`,
            },
      publicationTitle: values.publicationTitle ?? null,
      publisher: values.publisher ?? null,
      "attachments[].fileType": values.fileTypes ?? [],
      "attachments[].indexedKey": values.attachments ?? [],
      ...(values.itemType !== undefined && { itemType: values.itemType }),
    },
  };
}

/** Each Papers row on screen, as its lines and end marks read. */
function papers(el: HTMLElement) {
  return [...el.querySelectorAll<HTMLElement>("[data-query-papers-row]")].map(
    (node) => ({
      key: node.dataset.queryPapersRow,
      title: node.querySelector("[data-query-papers-title]")?.textContent,
      meta: node.querySelector("[data-query-papers-meta]")?.textContent,
      lines: node.querySelector("[data-query-papers-title]")?.parentElement
        ?.childElementCount,
      attachment:
        node.querySelector<HTMLElement>("[data-query-papers-attachment]")
          ?.dataset.queryPapersAttachment ?? null,
      note: node.querySelector("[data-query-papers-note]") !== null,
    }),
  );
}

it("ends a Papers row's second line with the reason its host gives for the row", async () => {
  const { view, el, settle } = await mount(
    [
      result([
        paperRow("ITEMAAAA", {
          title: "Annotated",
          creators: [{ family: "Rougier", role: "author" }],
          year: 2014,
        }),
        paperRow("ITEMBBBB", { title: "Untouched" }),
        paperRow("ITEMCCCC", { title: "No reason" }),
      ]),
    ],
    undefined,
    {
      reason: ({ indexedKey }) =>
        indexedKey === "ITEMCCCC" ? null : `edited ${indexedKey}`,
    },
  );
  await act(() => view.setText(PAPERS_FILE));
  await settle();
  expect(papers(el).map(({ meta, lines }) => [meta, lines])).toEqual([
    ["Rougier · 2014 · edited ITEMAAAA", 2],
    ["edited ITEMBBBB", 2],
    [undefined, 1],
  ]);
  await act(() =>
    view.setText(PAPERS_FILE.replace("type: papers", "type: table")),
  );
  await settle();
  expect(el.textContent).not.toContain("edited ITEM");
});

it("expands a Papers row into its Attachments, Child Notes and Literature Note, and an Attachment into its Annotations, each opening its own target", async () => {
  const openWindow = vi.spyOn(window, "open").mockImplementation(() => null);
  onTestFinished(() => openWindow.mockRestore());
  const item = paperRow("ITEMAAAA", {
    title: "Ten simple rules for better figures",
    attachments: ["PDFAAAAA"],
  });
  const { view, el, run, settle, readers, literatureNotes } = await mount(
    [
      result([
        {
          ...item,
          values: {
            ...item.values,
            notes: [{ indexedKey: "NXTEAAAA", title: "Reading notes" }],
          },
        },
        paperRow("ITEMBBBB", { title: "Nothing under it" }),
      ]),
      result([
        {
          indexedKey: "PDFAAAAA",
          values: {
            title: "Rougier et al. - 2014.pdf",
            "annotations[].indexedKey": ["ANNOTAAA"],
          },
        },
      ]),
      result([
        {
          indexedKey: "ANNOTAAA",
          values: {
            text: "Rule 1: know your audience",
            color: "#ffd400",
            pageLabel: "3",
            pageIndex: 2,
          },
        },
      ]),
    ],
    undefined,
    { notes: { ITEMAAAA: "Rougier 2014.md" } },
  );
  await act(() => view.setText(PAPERS_FILE));
  await settle();
  const children = () =>
    [...el.querySelectorAll<HTMLElement>("[data-query-papers-child]")].map(
      (node) => [node.dataset.queryPapersChild, node.textContent?.trim()],
    );

  // Only an Item with something under it can expand.
  expect(
    [...el.querySelectorAll("[data-query-expand]")].map((node) =>
      node.getAttribute("data-query-expand"),
    ),
  ).toEqual(["item:ITEMAAAA"]);
  await act(async () => {
    el.querySelector<HTMLElement>(
      '[data-query-expand="item:ITEMAAAA"]',
    )!.click();
  });
  await act(async () => {});
  expect(run.mock.calls[1]![0]).toMatchObject({
    from: "attachments",
    filter: 'item.indexedKey == "ITEMAAAA"',
  });
  await act(async () => {
    el.querySelector<HTMLElement>(
      '[data-query-expand="attachment:PDFAAAAA"]',
    )!.click();
  });
  await act(async () => {});
  expect(children()).toEqual([
    ["attachment", "Rougier et al. - 2014.pdf"],
    ["annotation", "Rule 1: know your audiencePage 3"],
    ["note", "Reading notes"],
    ["literature-note", "Rougier 2014"],
  ]);

  const child = (kind: string) =>
    el.querySelector<HTMLElement>(
      `[data-query-papers-child="${kind}"] a, [data-query-papers-child="${kind}"] [data-query-note]`,
    )!;
  await act(() => child("attachment").click());
  expect(readers.open).toHaveBeenLastCalledWith(
    { kind: "attachment", attachmentKey: "PDFAAAAA" },
    false,
  );
  await act(() => child("annotation").click());
  expect(readers.open).toHaveBeenLastCalledWith(
    {
      kind: "annotation",
      attachmentKey: "PDFAAAAA",
      annotationKey: "ANNOTAAA",
      pageIndex: 2,
      pageLabel: "3",
    },
    false,
  );
  // A Child Note lives in Zotero, which shows it from its link.
  await act(() => child("note").click());
  expect(openWindow).toHaveBeenCalledWith(
    "zotero://select/library/items/NXTEAAAA",
  );
  await act(() => child("literature-note").click());
  expect(literatureNotes.open).toHaveBeenCalledWith(
    expect.objectContaining({ path: "Rougier 2014.md" }),
    expect.anything(),
  );
});

describe("vault properties", () => {
  const VAULT_FILE = `views:
  - type: table
    name: Reading list
    from: items
    order:
      - title
      - vault.status
`;
  /** The vault cell of each row: its state and its text. */
  const vaultCells = (el: HTMLElement) =>
    [...el.querySelectorAll("[data-query-vault]")].map((cell) => [
      cell.getAttribute("data-query-vault"),
      cell.textContent,
    ]);

  it("shows each Item's value, an empty cell for a missing or null key, and a placeholder where it has no note", async () => {
    const { view, el, run, settle } = await mount(
      [
        result([
          itemRow("ITEMAAAA", "Ten simple rules"),
          itemRow("ITEMBBBB", "Deep learning"),
          itemRow("ITEMCCCC", "Attention"),
          itemRow("ITEMDDDD", "Transformers"),
        ]),
      ],
      undefined,
      {
        notes: { ITEMAAAA: "A.md", ITEMBBBB: "B.md", ITEMCCCC: "C.md" },
        frontmatter: {
          "A.md": { status: "reading" },
          "B.md": { status: null },
          "C.md": {},
        },
      },
    );
    await act(() => view.setText(VAULT_FILE));
    await settle();

    expect(vaultCells(el)).toEqual([
      ["value", "reading"],
      ["empty", ""],
      ["empty", ""],
      ["no-note", m.query_view_vault_no_note()],
    ]);
    // ZotLit Query is not asked for the vault property.
    expect(run.mock.calls[0]![0].fields).not.toContain("vault.status");
  });

  it("reads the note that holds a Query Block for its own Item, though the Note Index ranks another first", async () => {
    const { view, el, settle, literatureNotes } = await mount(
      [
        result([
          itemRow("ITEMAAAA", "Ten simple rules"),
          itemRow("ITEMBBBB", "Deep learning"),
        ]),
      ],
      undefined,
      {
        notes: { ITEMAAAA: "A.md", ITEMBBBB: "B.md" },
        frontmatter: {
          "A.md": { status: "reading" },
          "A (copy).md": { status: "read" },
          "B.md": { status: "unread" },
        },
        sourcePath: "A (copy).md",
        context: () => ({ item: "ITEMAAAA" }),
        contextSource: "note",
      },
    );
    await act(() => view.setText(VAULT_FILE));
    await settle();

    expect(vaultCells(el)).toEqual([
      ["value", "read"],
      ["value", "unread"],
    ]);
    expect(literatureNotes.read).toHaveBeenCalledWith("ITEMAAAA", "status", {
      path: "A (copy).md",
      itemKey: "ITEMAAAA",
    });
  });

  it("shows a value changed in the note's frontmatter without running the query again", async () => {
    const frontmatter: Record<string, Record<string, unknown>> = {
      "A.md": { status: "reading" },
    };
    const { view, el, run, settle, literatureNotes } = await mount(
      [result([itemRow("ITEMAAAA", "Ten simple rules")])],
      undefined,
      { notes: { ITEMAAAA: "A.md" }, frontmatter },
    );
    await act(() => view.setText(VAULT_FILE));
    await settle();

    frontmatter["A.md"] = { status: "read" };
    await act(() => literatureNotes.emit("frontmatter-changed"));

    expect(vaultCells(el)).toEqual([["value", "read"]]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each(["cards", "list"])(
    "shows the value and the placeholder in the %s layout",
    async (layout) => {
      const frontmatter: Record<string, Record<string, unknown>> = {
        "A.md": { status: "reading" },
      };
      const { view, el, settle, literatureNotes } = await mount(
        [
          result([
            itemRow("ITEMAAAA", "Ten simple rules"),
            itemRow("ITEMBBBB", "Deep learning"),
          ]),
        ],
        undefined,
        { notes: { ITEMAAAA: "A.md" }, frontmatter },
      );
      await act(() =>
        view.setText(VAULT_FILE.replace("type: table", `type: ${layout}`)),
      );
      await settle();

      expect(vaultCells(el)).toEqual([
        ["value", "reading"],
        ["no-note", m.query_view_vault_no_note()],
      ]);

      frontmatter["A.md"] = { status: "read" };
      await act(() => literatureNotes.emit("frontmatter-changed"));
      expect(vaultCells(el)[0]).toEqual(["value", "read"]);
    },
  );

  it("marks a vault column's header with the type its values show as", async () => {
    const frontmatter: Record<string, Record<string, unknown>> = {
      "A.md": { status: ["reading"], pages: 12 },
    };
    const { view, el, settle, literatureNotes } = await mount(
      [result([itemRow("ITEMAAAA", "Ten simple rules")])],
      undefined,
      { notes: { ITEMAAAA: "A.md" }, frontmatter },
    );
    await act(() =>
      view.setText(`${VAULT_FILE}      - vault.pages
      - vault.due
`),
    );
    await settle();
    const icon = (path: string) =>
      el
        .querySelector(`[data-query-column="${path}"] [data-query-icon]`)
        ?.getAttribute("data-query-icon");

    expect(icon("vault.status")).toBe("list");
    expect(icon("vault.pages")).toBe("binary");
    expect(icon("vault.due")).toBe("text");

    frontmatter["A.md"] = { ...frontmatter["A.md"], due: "2024-05-01" };
    await act(() => literatureNotes.emit("frontmatter-changed"));
    expect(icon("vault.due")).toBe("calendar");
  });

  it("finds an Item by its vault values from the Table's toolbar search, those of the note that holds the view for its own Item", async () => {
    const { view, el, settle } = await mount(
      [
        result([
          itemRow("ITEMAAAA", "Ten simple rules"),
          itemRow("ITEMBBBB", "Deep learning"),
          itemRow("ITEMCCCC", "Attention"),
        ]),
      ],
      undefined,
      {
        notes: { ITEMAAAA: "A.md", ITEMBBBB: "B.md" },
        frontmatter: {
          "A.md": { status: "skimmed" },
          "A (copy).md": { status: "reading" },
          "B.md": { status: "reading" },
        },
        sourcePath: "A (copy).md",
        context: () => ({ item: "ITEMAAAA" }),
        contextSource: "note",
      },
    );
    await act(() => view.setText(VAULT_FILE));
    await settle();

    await act(() =>
      el.querySelector<HTMLElement>('[data-query-toolbar="search"]')!.click(),
    );
    const input = el.querySelector<HTMLInputElement>("[data-query-search]")!;
    const search = (text: string) =>
      act(() => {
        input.value = text;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    const rows = () =>
      [...el.querySelectorAll('[data-query-table-row="item"]')].map((row) =>
        row.getAttribute("data-query-key"),
      );

    await search("READING");
    expect(rows()).toEqual(["ITEMAAAA", "ITEMBBBB"]);
    await search("skimmed");
    expect(rows()).toEqual([]);
  });

  it("names a vault column's header by the property name, as Bases does, with the icon of tags and aliases", async () => {
    const { view, el, settle } = await mount(
      [result([itemRow("ITEMAAAA", "Ten simple rules")])],
      undefined,
      {
        notes: { ITEMAAAA: "A.md" },
        frontmatter: { "A.md": { status: "read", tags: ["hci"] } },
        types: { tags: "tags", aliases: "aliases" },
      },
    );
    await act(() =>
      view.setText(`${VAULT_FILE}      - vault.tags
      - vault.aliases
`),
    );
    await settle();
    const header = (path: string) =>
      el.querySelector(`[data-query-column="${path}"]`);
    const icon = (path: string) =>
      header(path)
        ?.querySelector("[data-query-icon]")
        ?.getAttribute("data-query-icon");

    expect(header("vault.status")?.textContent).toBe(
      m.query_view_vault_property_label({ name: "status" }),
    );
    expect(icon("vault.tags")).toBe("tags");
    expect(icon("vault.aliases")).toBe("forward");
  });

  it("writes vault values in copy and CSV, and no text where an Item has no note", async () => {
    const { view, settle } = await mount(
      [
        result([
          itemRow("ITEMAAAA", "Ten simple rules"),
          itemRow("ITEMBBBB", "Deep learning"),
        ]),
      ],
      undefined,
      {
        notes: { ITEMAAAA: "A.md" },
        frontmatter: { "A.md": { status: ["reading", "to cite"] } },
      },
    );
    await act(() =>
      view.setText(`${VAULT_FILE}      - vault.literatureNote\n`),
    );
    await settle();

    expect(view.table()).toEqual({
      header: ["Title", m.query_view_vault_property_label({ name: "status" })],
      body: [
        ["Ten simple rules", "reading, to cite"],
        ["Deep learning", ""],
      ],
    });
  });

  describe("in the filters", () => {
    const filtered = (filters: string) => `views:
  - type: table
    name: Reading list
    from: items
    limit: 20
    filters:
${filters}
`;
    const NOTES = {
      notes: { ITEMAAAA: "A.md", ITEMBBBB: "B.md" },
      frontmatter: {
        "A.md": { "reading-status": "read" },
        "B.md": { "reading-status": "unread" },
      },
    };

    it("asks ZotLit Query for the Items whose note passes, beside the Zotero condition and under the limit", async () => {
      const { view, run, settle } = await mount([], undefined, NOTES);
      await act(() =>
        view.setText(
          filtered(`      and:
        - itemType == "book"
        - vault["reading-status"] == "read"`),
        ),
      );
      await settle();

      const request = run.mock.calls[0]![0];
      expect(request.filter).toBe(
        '(itemType == "book")\n&& (["ITEMAAAA"].contains(indexedKey))',
      );
      expect(request.limit).toBe(20);
    });

    it.each([
      [
        'vault["reading-status"] == null',
        '!["ITEMAAAA", "ITEMBBBB"].contains(indexedKey)',
      ],
      [
        'vault["reading-status"] != "read"',
        '!["ITEMAAAA"].contains(indexedKey)',
      ],
    ])("keeps the Items without a note for %s", async (condition, expected) => {
      const { view, run, settle } = await mount([], undefined, NOTES);
      await act(() =>
        view.setText(
          filtered(`      - ${JSON.stringify(condition)}`.replace("- ", "")),
        ),
      );
      await settle();

      expect(run.mock.calls[0]![0].filter).toBe(expected);
    });

    it("runs again with the Items whose note passes once a note's frontmatter changes", async () => {
      const frontmatter: Record<string, Record<string, unknown>> = {
        ...NOTES.frontmatter,
      };
      const { view, run, settle, literatureNotes } = await mount(
        [],
        undefined,
        { notes: NOTES.notes, frontmatter },
      );
      await act(() =>
        view.setText(filtered(`      'vault["reading-status"] == "read"'`)),
      );
      await settle();
      await act(() => literatureNotes.emit("frontmatter-changed"));
      await settle();
      expect(run).toHaveBeenCalledTimes(1);

      frontmatter["B.md"] = { "reading-status": "read" };
      await act(() => literatureNotes.emit("frontmatter-changed"));
      await settle();

      expect(run).toHaveBeenCalledTimes(2);
      expect(run.mock.calls[1]![0].filter).toBe(
        '["ITEMAAAA", "ITEMBBBB"].contains(indexedKey)',
      );
    });

    it("marks a vault condition inside an or group and runs nothing", async () => {
      const { view, el, run, settle } = await mount([], undefined, NOTES);
      await act(() =>
        view.setText(
          filtered(`      or:
        - itemType == "book"
        - vault["reading-status"] == "read"`),
        ),
      );
      await settle();

      expect(run).not.toHaveBeenCalled();
      expect(view.state.getState().failure?.filterIssue).toEqual({
        section: "view",
        path: [1],
        message: `${m.query_view_vault_filter_nested()} ${m.query_view_vault_filter_nested_hint()}`,
      });
      expect(
        el
          .querySelector("[data-query-diagnostic]")
          ?.getAttribute("data-query-diagnostic"),
      ).toBe("vault-filter-nested");
    });
  });

  describe("edited in place in the Table", () => {
    /** One row of Item ITEMAAAA, whose note `A.md` has `status: unread`. */
    async function editable(options: Parameters<typeof mount>[2] = {}) {
      const mounted = await mount(
        [
          result([
            itemRow("ITEMAAAA", "Ten simple rules"),
            itemRow("ITEMBBBB", "Deep learning"),
          ]),
        ],
        undefined,
        {
          notes: { ITEMAAAA: "A.md" },
          frontmatter: { "A.md": { status: "unread" } },
          ...options,
        },
      );
      await act(() => mounted.view.setText(VAULT_FILE));
      await mounted.settle();
      const cell = (itemKey: string) =>
        mounted.el.querySelector<HTMLElement>(
          `[data-query-key="${itemKey}"] [data-query-vault-cell]`,
        )!;
      const input = () =>
        mounted.el.querySelector<HTMLInputElement>("[data-query-vault-input]");
      const type = (text: string) =>
        act(() => {
          const field = input()!;
          field.value = text;
          field.dispatchEvent(new Event("input", { bubbles: true }));
        });
      const press = (key: string) =>
        act(() => {
          input()!.dispatchEvent(
            new KeyboardEvent("keydown", { key, bubbles: true }),
          );
        });
      return { ...mounted, cell, input, type, press };
    }

    it("enters edit on a click, which goes no further than the cell, and commits on Enter", async () => {
      const { el, cell, input, type, press, literatureNotes } =
        await editable();
      const outside = vi.fn();
      el.addEventListener("click", outside);

      await act(() => cell("ITEMAAAA").click());
      expect(input()?.value).toBe("unread");
      expect(outside).not.toHaveBeenCalled();

      await type("read");
      await press("Enter");

      expect(literatureNotes.write).toHaveBeenCalledWith({
        itemKey: "ITEMAAAA",
        name: "status",
        value: "read",
        host: null,
      });
      expect(input()).toBeNull();
      expect(vaultCells(el)[0]).toEqual(["value", "read"]);
    });

    it("commits when the cell loses focus", async () => {
      const { cell, input, type, literatureNotes } = await editable();

      await act(() => cell("ITEMAAAA").click());
      await type("read");
      await act(() => {
        input()!.dispatchEvent(new FocusEvent("blur"));
        input()!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      });

      expect(literatureNotes.write).toHaveBeenCalledTimes(1);
      expect(literatureNotes.write).toHaveBeenCalledWith({
        itemKey: "ITEMAAAA",
        name: "status",
        value: "read",
        host: null,
      });
    });

    it("cancels on Escape, and writes nothing", async () => {
      const { el, cell, input, type, press, literatureNotes } =
        await editable();

      await act(() => cell("ITEMAAAA").click());
      await type("read");
      await press("Escape");

      expect(input()).toBeNull();
      expect(vaultCells(el)[0]).toEqual(["value", "unread"]);
      expect(literatureNotes.write).not.toHaveBeenCalled();
    });

    it("writes no value, keeping the key, when the cell is cleared", async () => {
      const { el, cell, type, press, literatureNotes } = await editable();

      await act(() => cell("ITEMAAAA").click());
      await type("");
      await press("Enter");

      expect(literatureNotes.write).toHaveBeenCalledWith({
        itemKey: "ITEMAAAA",
        name: "status",
        value: null,
        host: null,
      });
      expect(vaultCells(el)[0]).toEqual(["empty", ""]);
    });

    it("writes nothing when the text is unchanged", async () => {
      const { cell, press, literatureNotes } = await editable();

      await act(() => cell("ITEMAAAA").click());
      await press("Enter");

      expect(literatureNotes.write).not.toHaveBeenCalled();
    });

    it("keeps a key the note's Profile replaces read-only, with the managed marker", async () => {
      const { cell, input, literatureNotes } = await editable({
        managed: { "A.md": ["status"] },
      });

      expect(
        cell("ITEMAAAA").querySelector("[data-query-vault-managed]"),
      ).not.toBeNull();
      await act(() => cell("ITEMAAAA").click());

      expect(input()).toBeNull();
      expect(literatureNotes.write).not.toHaveBeenCalled();
    });

    it("turns a cell read-only when its note's Profile comes to replace the key", async () => {
      const managed: Record<string, string[]> = {};
      const { cell, input, literatureNotes } = await editable({ managed });
      expect(
        cell("ITEMAAAA").querySelector("[data-query-vault-managed]"),
      ).toBeNull();

      // The note's stamp now names a Profile that replaces the key.
      managed["A.md"] = ["status"];
      await act(() => literatureNotes.emit("frontmatter-changed"));

      expect(
        cell("ITEMAAAA").querySelector("[data-query-vault-managed]"),
      ).not.toBeNull();
      await act(() => cell("ITEMAAAA").click());
      expect(input()).toBeNull();
    });

    it("makes the whole cell, empty or not, an edit target the keyboard reaches", async () => {
      const { cell, input } = await editable({ frontmatter: { "A.md": {} } });
      const target = cell("ITEMAAAA");

      expect(target.getAttribute("role")).toBe("button");
      expect(target.tabIndex).toBe(0);
      // Named without an `aria-label`, which Obsidian would show as a
      // tooltip over the next row.
      const name = (el: Element | null | undefined) =>
        el?.ownerDocument.getElementById(
          el.getAttribute("aria-labelledby") ?? "",
        )?.textContent;
      expect(target.hasAttribute("aria-label")).toBe(false);
      expect(name(target)).toBe(m.query_view_vault_edit({ name: "status" }));
      await act(() => {
        target.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });
      expect(input()?.value).toBe("");
      expect(input()?.hasAttribute("aria-label")).toBe(false);
      expect(name(input())).toBe(m.query_view_vault_edit({ name: "status" }));
    });

    describe("on a row with no note", () => {
      it("opens the editor, empty, and creates nothing", async () => {
        const { cell, input, literatureNotes } = await editable();

        await act(() => cell("ITEMBBBB").click());

        expect(input()?.value).toBe("");
        expect(literatureNotes.write).not.toHaveBeenCalled();
        expect(literatureNotes.create).not.toHaveBeenCalled();
      });

      it("creates nothing when the editor closes with no value", async () => {
        const { cell, press, literatureNotes } = await editable();

        await act(() => cell("ITEMBBBB").click());
        await press("Enter");

        expect(literatureNotes.write).not.toHaveBeenCalled();
      });

      it("writes on commit, which creates the note, and shows the value", async () => {
        const { el, cell, type, press, literatureNotes } = await editable();

        await act(() => cell("ITEMBBBB").click());
        await type("to read");
        await press("Enter");

        expect(literatureNotes.write).toHaveBeenCalledWith({
          itemKey: "ITEMBBBB",
          name: "status",
          value: "to read",
          host: null,
        });
        expect(vaultCells(el)[1]).toEqual(["value", "to read"]);
        await expect(
          literatureNotes.write.mock.results[0]!.value,
        ).resolves.toBe("created");
      });

      it("keeps the row with no note when the Profile prompt is cancelled", async () => {
        const { el, cell, type, press, literatureNotes } = await editable({
          creation: "cancelled",
        });

        await act(() => cell("ITEMBBBB").click());
        await type("to read");
        await press("Enter");

        await expect(
          literatureNotes.write.mock.results[0]!.value,
        ).resolves.toBe("cancelled");
        expect(vaultCells(el)[1]).toEqual([
          "no-note",
          m.query_view_vault_no_note(),
        ]);
      });
    });

    it("writes the note that holds a Query Block for its own Item", async () => {
      const { cell, type, press, literatureNotes } = await editable({
        frontmatter: {
          "A.md": { status: "unread" },
          "A (copy).md": { status: "unread" },
        },
        sourcePath: "A (copy).md",
        context: () => ({ item: "ITEMAAAA" }),
        contextSource: "note",
      });

      await act(() => cell("ITEMAAAA").click());
      await type("read");
      await press("Enter");

      expect(literatureNotes.write).toHaveBeenCalledWith({
        itemKey: "ITEMAAAA",
        name: "status",
        value: "read",
        host: { path: "A (copy).md", itemKey: "ITEMAAAA" },
      });
    });
  });

  describe("edited in place by type", () => {
    /** One row of Item ITEMAAAA, whose note `A.md` holds `frontmatter`. */
    async function typed(
      order: string[],
      frontmatter: Record<string, unknown>,
      {
        types = {},
        values = {},
        managed = [],
      }: {
        /** The type Obsidian assigns each property, by name. */
        types?: Record<string, VaultPropertyType>;
        /** The values the vault holds for each property, by name. */
        values?: Record<string, string[]>;
        /** The properties the note's Profile replaces. */
        managed?: string[];
      } = {},
    ) {
      const mounted = await mount(
        [result([itemRow("ITEMAAAA", "Ten simple rules")])],
        undefined,
        {
          notes: { ITEMAAAA: "A.md" },
          frontmatter: { "A.md": frontmatter },
          types,
          values,
          managed: { "A.md": managed },
        },
      );
      await act(() =>
        mounted.view.setText(`views:
  - type: table
    name: Reading list
    from: items
    order:
${order.map((path) => `      - ${path}\n`).join("")}`),
      );
      await mounted.settle();
      const cell = (name: string) =>
        mounted.el.querySelector<HTMLElement>(
          `[data-query-vault-cell][data-query-vault-name="${name}"]`,
        )!;
      const input = () =>
        mounted.el.querySelector<HTMLInputElement>("[data-query-vault-input]");
      const type = (text: string) =>
        act(() => {
          const field = input()!;
          field.value = text;
          field.dispatchEvent(new Event("input", { bubbles: true }));
        });
      const press = (key: string, init: KeyboardEventInit = {}) =>
        act(() => {
          input()!.dispatchEvent(
            new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
          );
        });
      const icon = (name: string) =>
        mounted.el
          .querySelector(
            `[data-query-column="vault.${name}"] [data-query-icon]`,
          )
          ?.getAttribute("data-query-icon");
      return { ...mounted, cell, input, type, press, icon };
    }
    const edit = (name: string, value: unknown) => ({
      itemKey: "ITEMAAAA",
      name,
      value,
      host: null,
    });

    it("toggles a checkbox on a click, without entering edit, and writes a boolean", async () => {
      const { cell, input, literatureNotes } = await typed(["vault.read"], {
        read: false,
      });
      const box = () =>
        cell("read").querySelector<HTMLInputElement>(
          "[data-query-vault-checkbox]",
        )!;

      expect(box().checked).toBe(false);
      await act(() => box().click());

      expect(input()).toBeNull();
      expect(literatureNotes.write).toHaveBeenLastCalledWith(
        edit("read", true),
      );
      expect(box().checked).toBe(true);

      await act(() => box().click());
      expect(literatureNotes.write).toHaveBeenLastCalledWith(
        edit("read", false),
      );
    });

    it("checks a checkbox of a row with no note on a click, writing true", async () => {
      const mounted = await mount(
        [result([itemRow("ITEMBBBB", "Deep learning")])],
        undefined,
        { types: { read: "checkbox" } },
      );
      await act(() =>
        mounted.view.setText(`views:
  - type: table
    name: Reading list
    from: items
    order:
      - vault.read
`),
      );
      await mounted.settle();

      await act(() =>
        mounted.el
          .querySelector<HTMLElement>('[data-query-vault-name="read"]')!
          .click(),
      );

      expect(mounted.literatureNotes.write).toHaveBeenCalledWith({
        itemKey: "ITEMBBBB",
        name: "read",
        value: true,
        host: null,
      });
    });

    it("writes a number as a number, no value when cleared, and nothing for text that is no number", async () => {
      const { cell, input, type, press, literatureNotes } = await typed(
        ["vault.pages"],
        { pages: 12 },
        // A cleared value shows no type, so the number type is assigned.
        { types: { pages: "number" } },
      );

      await act(() => cell("pages").click());
      expect(input()?.inputMode).toBe("decimal");
      expect(input()?.value).toBe("12");
      await type("320");
      await press("Enter");
      expect(literatureNotes.write).toHaveBeenLastCalledWith(
        edit("pages", 320),
      );

      await act(() => cell("pages").click());
      await type("");
      await press("Enter");
      expect(literatureNotes.write).toHaveBeenLastCalledWith(
        edit("pages", null),
      );

      literatureNotes.write.mockClear();
      await act(() => cell("pages").click());
      await type("many");
      await press("Enter");
      expect(literatureNotes.write).not.toHaveBeenCalled();
    });

    it("writes a date as the date string the Properties panel reads", async () => {
      const { cell, input, type, press, literatureNotes, icon } = await typed(
        ["vault.due"],
        { due: "2024-05-01" },
      );

      expect(icon("due")).toBe("calendar");
      await act(() => cell("due").click());
      expect(input()?.type).toBe("date");
      expect(input()?.value).toBe("2024-05-01");
      await type("2024-06-30");
      await press("Enter");

      expect(literatureNotes.write).toHaveBeenLastCalledWith(
        edit("due", "2024-06-30"),
      );
    });

    it("shows a date and time in an inert native field, edits it in one, and writes nothing when it is unchanged", async () => {
      const { cell, input, type, press, literatureNotes, icon } = await typed(
        ["vault.met"],
        { met: "2024-05-01T10:30:00" },
        { types: { met: "datetime" } },
      );

      expect(icon("met")).toBe("clock");
      const shown = cell("met").querySelector<HTMLInputElement>(
        "[data-query-vault-date]",
      );
      expect(shown?.type).toBe("datetime-local");
      expect(shown?.hasAttribute("inert")).toBe(true);
      expect(shown?.value).toBe("2024-05-01T10:30");
      await act(() => cell("met").click());
      expect(input()?.type).toBe("datetime-local");
      // The native field leaves out seconds that are none.
      expect(input()?.value).toBe("2024-05-01T10:30");
      await press("Enter");
      expect(literatureNotes.write).not.toHaveBeenCalled();

      await act(() => cell("met").click());
      await type("2024-05-02T09:00");
      await press("Enter");
      expect(literatureNotes.write).toHaveBeenLastCalledWith(
        edit("met", "2024-05-02T09:00:00"),
      );
    });

    it("shows a missing or null checkbox as indeterminate, and false as an empty box", async () => {
      const { view, el, settle } = await mount(
        [
          result([
            itemRow("ITEMAAAA", "Ten simple rules"),
            itemRow("ITEMBBBB", "Deep learning"),
            itemRow("ITEMCCCC", "Attention"),
          ]),
        ],
        undefined,
        {
          notes: { ITEMAAAA: "A.md", ITEMBBBB: "B.md", ITEMCCCC: "C.md" },
          frontmatter: { "A.md": { done: false }, "B.md": { done: null } },
          types: { done: "checkbox" },
        },
      );
      await act(() =>
        view.setText(`views:
  - type: table
    name: Reading list
    from: items
    order:
      - vault.done
`),
      );
      await settle();
      const box = (itemKey: string) =>
        el.querySelector<HTMLInputElement>(
          `[data-query-key="${itemKey}"] [data-query-vault-checkbox]`,
        )!;

      expect(box("ITEMAAAA").checked).toBe(false);
      expect(box("ITEMAAAA").hasAttribute("data-indeterminate")).toBe(false);
      for (const key of ["ITEMBBBB", "ITEMCCCC"]) {
        expect(box(key).checked).toBe(false);
        expect(box(key).getAttribute("data-indeterminate")).toBe("true");
        expect(box(key).getAttribute("aria-checked")).toBe("mixed");
      }
    });

    it("shows a whole link as a link that opens its note, and a click on it starts no edit", async () => {
      const mounted = await mount(
        [result([itemRow("ITEMAAAA", "Ten simple rules")])],
        undefined,
        {
          notes: { ITEMAAAA: "A.md" },
          frontmatter: {
            "A.md": { related: "[[Memex|the memex]]", other: "[[Nowhere]]" },
          },
          notePaths: ["Memex"],
        },
      );
      await act(() =>
        mounted.view.setText(`views:
  - type: table
    name: Reading list
    from: items
    order:
      - vault.related
      - vault.other
`),
      );
      await mounted.settle();
      const link = (name: string) =>
        mounted.el.querySelector<HTMLAnchorElement>(
          `[data-query-vault-name="${name}"] a.internal-link`,
        )!;

      expect(link("related").textContent).toBe("the memex");
      expect(link("related").hasAttribute("data-unresolved")).toBe(false);
      expect(link("other").hasAttribute("data-unresolved")).toBe(true);
      await act(() => link("related").click());

      expect(mounted.literatureNotes.openLink).toHaveBeenCalledWith(
        { target: "Memex", itemKey: "ITEMAAAA", host: null },
        expect.any(MouseEvent),
      );
      expect(mounted.el.querySelector("[data-query-vault-input]")).toBeNull();
    });

    it("tells a truncated chip by the window it stands in, after the view moves to another", async () => {
      // Each element's listener for the view moving to another window.
      const migrated = new Map<HTMLElement, (win: Window) => void>();
      // oxlint-disable-next-line typescript/unbound-method -- saved to restore after the test
      const original = HTMLElement.prototype.onWindowMigrated;
      HTMLElement.prototype.onWindowMigrated = function (listener) {
        migrated.set(this, listener);
        return () => migrated.delete(this);
      };
      onTestFinished(() => {
        HTMLElement.prototype.onWindowMigrated = original;
      });
      const disconnect = vi.spyOn(
        window.ResizeObserver.prototype,
        "disconnect",
      );
      const { cell } = await typed(["vault.authors"], {
        authors: ["A long name of an author"],
      });
      const chip = cell("authors").querySelector<HTMLElement>(
        "[data-query-vault-chip]",
      )!;
      const label = chip.firstElementChild as HTMLElement;
      /** The observers of the other window, and what each observes. */
      const observers: { listener: () => void; observed: Element[] }[] = [];
      const other = {
        ResizeObserver: class {
          readonly observed: Element[] = [];
          constructor(readonly listener: () => void) {
            observers.push(this);
          }
          observe(el: Element) {
            this.observed.push(el);
          }
          disconnect() {}
        },
      } as unknown as Window;

      expect(migrated.has(label)).toBe(true);
      await act(() => migrated.get(label)!(other));
      expect(disconnect).toHaveBeenCalled();
      expect(observers.map(({ observed }) => observed)).toEqual([[label]]);
      Object.defineProperty(label, "scrollWidth", { value: 200 });
      Object.defineProperty(label, "clientWidth", { value: 100 });
      await act(() => observers[0]!.listener());
      expect(chip.getAttribute("aria-label")).toBe("A long name of an author");
    });

    it("shows tags without their #, and aliases as items", async () => {
      const { cell } = await typed(
        ["vault.tags", "vault.aliases"],
        { tags: ["#reading/done", "hci"], aliases: ["Memex essay"] },
        { types: { tags: "tags", aliases: "aliases" } },
      );
      const shown = (name: string) =>
        [...cell(name).querySelectorAll("[data-query-vault-chip]")].map(
          (chip) => chip.textContent,
        );

      expect(shown("tags")).toEqual(["reading/done", "hci"]);
      expect(shown("aliases")).toEqual(["Memex essay"]);
    });

    it("commits on Tab and moves to the next vault cell of the row, and returns focus to the cell after Enter", async () => {
      const { cell, type, press, input, literatureNotes } = await typed(
        ["vault.status", "vault.note"],
        { status: "unread", note: "" },
      );

      await act(() => cell("status").click());
      await type("read");
      await press("Tab");
      expect(literatureNotes.write).toHaveBeenLastCalledWith(
        edit("status", "read"),
      );
      expect(input()).toBeNull();
      expect(document.activeElement).toBe(cell("note"));

      await act(() => cell("note").click());
      await type("short");
      await press("Enter");
      expect(literatureNotes.write).toHaveBeenLastCalledWith(
        edit("note", "short"),
      );
      expect(document.activeElement).toBe(cell("note"));

      // Shift+Tab goes back, and Escape drops the edit and stays.
      await act(() => cell("note").click());
      await press("Tab", { shiftKey: true });
      expect(document.activeElement).toBe(cell("status"));
      await act(() => cell("status").click());
      await type("unread");
      await press("Escape");
      expect(literatureNotes.write).toHaveBeenCalledTimes(2);
      expect(document.activeElement).toBe(cell("status"));
    });

    it("shows a list as chips, keeps an item with a comma whole, and adds and removes items", async () => {
      const { cell, type, press, literatureNotes } = await typed(
        ["vault.authors"],
        { authors: ["Doe, J", "Roe"] },
      );
      const chips = () =>
        [...cell("authors").querySelectorAll("[data-query-vault-chip]")].map(
          (chip) => chip.getAttribute("data-query-vault-chip"),
        );

      expect(chips()).toEqual(["Doe, J", "Roe"]);

      await act(() => cell("authors").click());
      await type("Poe, E");
      await press("Enter");
      expect(chips()).toEqual(["Doe, J", "Roe", "Poe, E"]);
      await act(() =>
        cell("authors")
          .querySelector<HTMLElement>(
            '[data-query-vault-chip="Roe"] [data-query-vault-chip-remove]',
          )!
          .click(),
      );
      await press("Enter");

      expect(literatureNotes.write).toHaveBeenCalledTimes(1);
      expect(literatureNotes.write).toHaveBeenLastCalledWith(
        edit("authors", ["Doe, J", "Poe, E"]),
      );
      expect(chips()).toEqual(["Doe, J", "Poe, E"]);
    });

    it("commits the list when focus leaves the editor from a chip", async () => {
      const { cell, type, press, literatureNotes } = await typed(
        ["vault.authors"],
        { authors: ["Doe, J"] },
      );

      await act(() => cell("authors").click());
      await type("Roe");
      await press("Enter");
      // Shift+Tab moved focus to a chip's remove button; a click outside
      // takes it out of the editor.
      const remove = cell("authors").querySelector<HTMLElement>(
        '[data-query-vault-chip="Roe"] [data-query-vault-chip-remove]',
      )!;
      await act(() => {
        remove.dispatchEvent(
          new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
        );
      });

      expect(literatureNotes.write).toHaveBeenCalledTimes(1);
      expect(literatureNotes.write).toHaveBeenLastCalledWith(
        edit("authors", ["Doe, J", "Roe"]),
      );
    });

    it("edits each cell with the editor its own value infers, where no type is assigned", async () => {
      const { view, el, settle } = await mount(
        [
          result([
            itemRow("ITEMAAAA", "Ten simple rules"),
            itemRow("ITEMBBBB", "Deep learning"),
          ]),
        ],
        undefined,
        {
          notes: { ITEMAAAA: "A.md", ITEMBBBB: "B.md" },
          // The property's first value is a checkbox.
          frontmatter: { "B.md": { flag: true }, "A.md": { flag: "maybe" } },
        },
      );
      await act(() =>
        view.setText(`views:
  - type: table
    name: Reading list
    from: items
    order:
      - vault.flag
`),
      );
      await settle();
      const cell = (itemKey: string) =>
        el.querySelector<HTMLElement>(
          `[data-query-key="${itemKey}"] [data-query-vault-cell]`,
        )!;

      expect(
        cell("ITEMBBBB").querySelector("[data-query-vault-checkbox]"),
      ).not.toBeNull();
      expect(
        cell("ITEMAAAA").querySelector("[data-query-vault-checkbox]"),
      ).toBeNull();
      await act(() => cell("ITEMAAAA").click());
      expect(
        el.querySelector<HTMLInputElement>("[data-query-vault-input]")?.value,
      ).toBe("maybe");
    });

    it("keeps the list's edits on Escape, with what was typed added, as Bases does", async () => {
      const { cell, type, press, literatureNotes } = await typed(
        ["vault.authors"],
        { authors: ["Doe, J"] },
      );

      await act(() => cell("authors").click());
      await type("Roe");
      await press("Enter");
      await type("Poe");
      await press("Escape");

      expect(literatureNotes.write).toHaveBeenLastCalledWith(
        edit("authors", ["Doe, J", "Roe", "Poe"]),
      );
      expect(document.activeElement).toBe(cell("authors"));
    });

    it("leaves Enter and Escape to the input method while it composes, in every field", async () => {
      const { cell, input, type, press, literatureNotes } = await typed(
        ["vault.status", "vault.authors"],
        { status: "unread", authors: ["Doe, J"] },
      );
      // Enter that takes a candidate, and Escape that drops one; Chromium
      // reports either as key 229 too.
      const composing = [{ isComposing: true }, { keyCode: 229 }] as const;

      await act(() => cell("status").click());
      await type("読");
      for (const init of composing) {
        await press("Enter", init);
        await press("Escape", init);
      }
      expect(input()).not.toBeNull();
      await press("Enter");
      expect(literatureNotes.write).toHaveBeenLastCalledWith(
        edit("status", "読"),
      );

      await act(() => cell("authors").click());
      await type("Roe");
      for (const init of composing) {
        await press("Enter", init);
        await press("Escape", init);
      }
      expect(
        cell("authors").querySelector('[data-query-vault-chip="Roe"]'),
      ).toBeNull();
      expect(input()).not.toBeNull();

      // An item that edits in place, from its menu.
      await type("");
      await press("Backspace");
      Menu.instances.length = 0;
      await act(() => {
        cell("authors")
          .querySelector<HTMLElement>('[data-query-vault-chip="Doe, J"]')!
          .dispatchEvent(
            new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true }),
          );
      });
      await act(() =>
        Menu.instances
          .at(-1)!
          .items.find((entry) => entry.title === "Edit")!
          .click(),
      );
      const chipInput = () =>
        cell("authors").querySelector<HTMLInputElement>(
          "[data-query-vault-chip-input]",
        );
      for (const init of composing)
        for (const key of ["Enter", "Escape"])
          await act(() => {
            chipInput()!.dispatchEvent(
              new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
            );
          });
      expect(chipInput()).not.toBeNull();
    });

    it("keeps the view's own keys off a list editor while focus stands in it", async () => {
      const { cell, input, app, el, scope } = await typed(["vault.authors"], {
        authors: ["Doe, J", "Roe"],
      });
      // The view's keys go on the keymap as a note holds the view: while
      // focus stands inside it, and not from a text field.
      using _held = new QueryCardFocus(app as unknown as App).hold(
        el,
        scope,
        {} as HistorySurface,
      );
      await act(() => cell("authors").click());
      // The edit opens in the field, so a Scope of the editor's own alone
      // stands on the keymap.
      expect(app.scopes).toHaveLength(1);
      const editor = app.scopes[0];

      // Focus on a pill pushes the view's Scope as the event comes down,
      // and the editor's goes back on top of it.
      const pill = cell("authors").querySelector<HTMLElement>(
        '[data-query-vault-chip="Roe"]',
      )!;
      await act(() => pill.focus());
      expect(app.scopes).toEqual([scope, editor]);

      // The editor's Scope takes no key, so Escape reaches the pill rather
      // than the view's Escape, and the pill gives focus back to the field.
      await act(() => {
        pressTop(app, { key: "Escape" }, pill);
      });
      expect(document.activeElement).toBe(input());

      // Focus that leaves the editor gives the Scope back.
      await act(() => input()!.blur());
      expect(app.scopes).not.toContain(editor);
    });

    it("holds the keys in an item's menu while it stands, and gives them back to the pill as it hides", async () => {
      const { cell, input, app } = await typed(["vault.authors"], {
        authors: ["Doe, J", "Roe"],
      });
      await act(() => cell("authors").click());
      const pill = () =>
        cell("authors").querySelector<HTMLElement>(
          '[data-query-vault-chip="Roe"]',
        );
      await act(() => pill()!.focus());
      // Menus push their Scope on this keymap as they load, a timer after
      // they show, as Obsidian's push theirs on its own.
      Menu.keymap = (app as unknown as App)
        .keymap as unknown as typeof Menu.keymap;
      onTestFinished(() => {
        Menu.keymap = null;
      });
      Menu.instances.length = 0;
      await act(() => {
        pressTop(app, { key: "ContextMenu" }, pill()!);
      });
      await act(
        () => new Promise((resolve) => pill()!.win.setTimeout(resolve, 0)),
      );
      expect(Menu.instances).toHaveLength(1);
      // The Scope that takes the menu's Escape stands above the menu's own.
      expect(app.scopes.at(-2)).toBe(Menu.instances[0]!.scope);
      const menu = app.scopes.at(-1);

      // A key the menu leaves alone stops at it: Delete removes no item the
      // menu still offers to remove.
      await act(() => {
        pressTop(app, { key: "Delete" }, pill()!);
      });
      expect(pill()).not.toBeNull();

      // Escape hides the menu alone, and focus stays on the pill.
      await act(() => {
        pressTop(app, { key: "Escape" }, pill()!);
      });
      expect(app.scopes).not.toContain(menu);
      expect(document.activeElement).toBe(pill());

      // The next Escape is the pill's, which gives focus back to the field.
      await act(() => {
        pressTop(app, { key: "Escape" }, pill()!);
      });
      expect(document.activeElement).toBe(input());
    });

    it("moves between pills with the arrows, and removes the last with Backspace from an empty field", async () => {
      const { cell, input, press, literatureNotes } = await typed(
        ["vault.authors"],
        { authors: ["Doe, J", "Roe", "Poe"] },
      );
      const pill = (item: string) =>
        cell("authors").querySelector<HTMLElement>(
          `[data-query-vault-chip="${item}"]`,
        )!;
      const pressOn = (el: Element, key: string) =>
        act(() => {
          el.dispatchEvent(
            new KeyboardEvent("keydown", { key, bubbles: true }),
          );
        });

      await act(() => cell("authors").click());
      await press("Backspace");
      expect(document.activeElement).toBe(pill("Poe"));
      await pressOn(pill("Poe"), "ArrowLeft");
      expect(document.activeElement).toBe(pill("Roe"));
      await pressOn(pill("Roe"), "ArrowRight");
      expect(document.activeElement).toBe(pill("Poe"));
      await pressOn(pill("Poe"), "ArrowRight");
      expect(document.activeElement).toBe(input());

      await press("Backspace");
      await pressOn(pill("Poe"), "Backspace");
      expect(document.activeElement).toBe(pill("Roe"));
      await pressOn(pill("Roe"), "ArrowDown");
      expect(document.activeElement).toBe(input());
      await press("Enter");

      expect(literatureNotes.write).toHaveBeenLastCalledWith(
        edit("authors", ["Doe, J", "Roe"]),
      );
    });

    describe("a chip's menu", () => {
      /** The list `authors`, and the gestures on its chips. */
      async function chips(authors: string[]) {
        const mounted = await typed(["vault.authors"], { authors });
        const chip = (item: string) =>
          mounted
            .cell("authors")
            .querySelector<HTMLElement>(`[data-query-vault-chip="${item}"]`)!;
        const shown = () =>
          [
            ...mounted
              .cell("authors")
              .querySelectorAll("[data-query-vault-chip]"),
          ].map((el) => el.getAttribute("data-query-vault-chip"));
        /** Right-click `item`, or press the menu key on it, and read the menu. */
        const menuOn = (item: string, init: MouseEventInit = {}) => {
          Menu.instances.length = 0;
          void act(() => {
            chip(item).dispatchEvent(
              new MouseEvent("contextmenu", {
                bubbles: true,
                cancelable: true,
                ...init,
              }),
            );
          });
          return Menu.instances.at(-1);
        };
        const choose = (item: string, title: string) =>
          act(() => {
            menuOn(item, { clientX: 10, clientY: 10 })!
              .items.find((entry) => entry.title === title)!
              .click();
          });
        const chipInput = () =>
          mounted.el.querySelector<HTMLInputElement>(
            "[data-query-vault-chip-input]",
          );
        const typeChip = (text: string) =>
          act(() => {
            const field = chipInput()!;
            field.value = text;
            field.dispatchEvent(new Event("input", { bubbles: true }));
          });
        const pressChip = (key: string) =>
          act(() => {
            chipInput()!.dispatchEvent(
              new KeyboardEvent("keydown", { key, bubbles: true }),
            );
          });
        return {
          ...mounted,
          chip,
          shown,
          menuOn,
          choose,
          chipInput,
          typeChip,
          pressChip,
        };
      }

      it("offers Edit, Copy and Remove from list, at the pointer or under the chip", async () => {
        const { cell, menuOn, chip } = await chips(["Doe, J", "Roe"]);
        using clipboard = vi
          .spyOn(navigator.clipboard, "writeText")
          .mockResolvedValue();

        // At rest, as on a Bases list cell.
        const atRest = menuOn("Roe", { clientX: 10, clientY: 10 })!;
        expect(
          atRest.items.map((item) => [item.title, item.icon] as const),
        ).toEqual([
          ["Edit", "pencil"],
          ["Copy", "copy"],
          ["Remove from list", "trash-2"],
        ]);
        expect(atRest.mouseEvent).not.toBeNull();
        atRest.items.find((item) => item.title === "Copy")!.click();
        expect(clipboard).toHaveBeenLastCalledWith("Roe");

        // In the editor, the menu key on a focused chip opens it under the
        // chip, as no pointer says where.
        await act(() => cell("authors").click());
        chip("Roe").focus();
        const byKey = menuOn("Roe")!;
        expect(byKey.items.map((item) => item.title)).toEqual([
          "Edit",
          "Copy",
          "Remove from list",
        ]);
        expect(byKey.mouseEvent).toBeNull();
        expect(byKey.position).not.toBeNull();
      });

      it("opens from the keyboard on a list at rest: an item's menu, or one entry an item", async () => {
        const { cell, literatureNotes } = await chips(["Doe, J", "Roe"]);
        const menuKey = (key: string, init: KeyboardEventInit = {}) => {
          Menu.instances.length = 0;
          void act(() => {
            cell("authors").focus();
            cell("authors").dispatchEvent(
              new KeyboardEvent("keydown", {
                key,
                bubbles: true,
                cancelable: true,
                ...init,
              }),
            );
          });
          // The first: a submenu is a menu of its own.
          return Menu.instances[0];
        };

        const menu = menuKey("F10", { shiftKey: true })!;
        expect(menu.items.map((entry) => entry.title)).toEqual([
          "Doe, J",
          "Roe",
        ]);
        expect(menu.mouseEvent).toBeNull();
        expect(menu.position).not.toBeNull();
        expect(
          menu.items[1]!.submenu!.items.map((entry) => entry.title),
        ).toEqual(["Edit", "Copy", "Remove from list"]);
        await act(() =>
          menu.items[1]!.submenu!.items.find(
            (entry) => entry.title === "Remove from list",
          )!.click(),
        );
        expect(literatureNotes.write).toHaveBeenLastCalledWith(
          edit("authors", ["Doe, J"]),
        );

        // A list of one opens the item's own menu.
        expect(
          menuKey("ContextMenu")!.items.map((entry) => entry.title),
        ).toEqual(["Edit", "Copy", "Remove from list"]);
      });

      it("copies each item from the keyboard on a list the Profile replaces, which stays read-only", async () => {
        const { cell } = await typed(
          ["vault.authors"],
          { authors: ["Doe, J", "Roe"] },
          { managed: ["authors"] },
        );
        using clipboard = vi
          .spyOn(navigator.clipboard, "writeText")
          .mockResolvedValue();
        const el = cell("authors");

        // A stop for the keys, which edits nothing.
        expect(el.tabIndex).toBe(0);
        expect(el.getAttribute("role")).toBeNull();
        Menu.instances.length = 0;
        await act(() => {
          el.focus();
          el.dispatchEvent(
            new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true }),
          );
        });
        const menu = Menu.instances.at(-1)!;
        expect(menu.items.map((entry) => [entry.title, entry.icon])).toEqual([
          ["Copy “Doe, J”", "copy"],
          ["Copy “Roe”", "copy"],
        ]);
        menu.items[1]!.click();
        expect(clipboard).toHaveBeenLastCalledWith("Roe");
        await act(() => {
          el.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
          );
        });
        expect(el.querySelector("[data-query-vault-editor]")).toBeNull();
      });

      it("removes the item at rest, writing the list at once", async () => {
        const { choose, literatureNotes } = await chips(["Doe, J", "Roe"]);

        await choose("Roe", "Remove from list");

        expect(literatureNotes.write).toHaveBeenLastCalledWith(
          edit("authors", ["Doe, J"]),
        );
      });

      it("removes the item in the editor, which writes with the edit", async () => {
        const { cell, choose, shown, press, literatureNotes } = await chips([
          "Doe, J",
          "Roe",
        ]);

        await act(() => cell("authors").click());
        await choose("Doe, J", "Remove from list");
        expect(shown()).toEqual(["Roe"]);
        expect(literatureNotes.write).not.toHaveBeenCalled();
        await press("Enter");

        expect(literatureNotes.write).toHaveBeenLastCalledWith(
          edit("authors", ["Roe"]),
        );
      });

      it("edits a chip in place: Enter keeps a comma inside the item, Escape reverts, and an empty value removes it", async () => {
        const {
          cell,
          choose,
          shown,
          chipInput,
          typeChip,
          pressChip,
          press,
          literatureNotes,
        } = await chips(["Doe, J", "Roe", "Poe"]);

        await act(() => cell("authors").click());
        await choose("Roe", "Edit");
        expect(chipInput()?.value).toBe("Roe");
        expect(document.activeElement).toBe(chipInput());
        // The chip keeps its place in the list while it edits.
        expect(shown()).toEqual(["Doe, J", "Roe", "Poe"]);
        await typeChip("Roe, R");
        await pressChip("Enter");
        expect(chipInput()).toBeNull();
        expect(shown()).toEqual(["Doe, J", "Roe, R", "Poe"]);

        await choose("Poe", "Edit");
        await typeChip("Moe");
        await pressChip("Escape");
        expect(shown()).toEqual(["Doe, J", "Roe, R", "Poe"]);

        await choose("Doe, J", "Edit");
        await typeChip("  ");
        await pressChip("Enter");
        expect(shown()).toEqual(["Roe, R", "Poe"]);

        expect(literatureNotes.write).not.toHaveBeenCalled();
        await press("Enter");
        expect(literatureNotes.write).toHaveBeenCalledTimes(1);
        expect(literatureNotes.write).toHaveBeenLastCalledWith(
          edit("authors", ["Roe, R", "Poe"]),
        );
      });

      it("keeps an item that edits in place when another item is removed, by its x or its menu", async () => {
        const { cell, choose, typeChip, shown, press, literatureNotes } =
          await chips(["A", "B", "C", "D"]);
        const removeButton = (item: string) =>
          cell("authors").querySelector<HTMLElement>(
            `[data-query-vault-chip="${item}"] [data-query-vault-chip-remove]`,
          )!;

        await act(() => cell("authors").click());
        await choose("B", "Edit");
        await typeChip("BB");
        await act(() => removeButton("A").click());
        expect(shown()).toEqual(["BB", "C", "D"]);

        await choose("D", "Edit");
        await typeChip("DD");
        await choose("BB", "Remove from list");
        expect(shown()).toEqual(["C", "DD"]);

        await press("Enter");
        expect(literatureNotes.write).toHaveBeenLastCalledWith(
          edit("authors", ["C", "DD"]),
        );
      });

      it("keeps an item edited unchanged, a repeated one too, and puts back one edited to repeat another", async () => {
        const { cell, choose, typeChip, pressChip, shown, chip } = await chips([
          "A",
          "A",
          "B",
        ]);

        await act(() => cell("authors").click());
        // The second A: its menu opens on the pill in its place.
        Menu.instances.length = 0;
        await act(() => {
          cell("authors")
            .querySelectorAll<HTMLElement>('[data-query-vault-chip="A"]')[1]!
            .dispatchEvent(
              new MouseEvent("contextmenu", {
                bubbles: true,
                cancelable: true,
                clientX: 10,
                clientY: 10,
              }),
            );
        });
        await act(() => {
          Menu.instances
            .at(-1)!
            .items.find((entry) => entry.title === "Edit")!
            .click();
        });
        await pressChip("Enter");
        expect(shown()).toEqual(["A", "A", "B"]);

        await choose("B", "Edit");
        await typeChip("A");
        await pressChip("Enter");
        expect(shown()).toEqual(["A", "A", "B"]);
        expect(chip("B")).not.toBeNull();
      });

      it("edits a chip at rest in place, and writes the edit when focus leaves", async () => {
        const { cell, choose, chipInput, typeChip, literatureNotes } =
          await chips(["Doe, J", "Roe"]);

        await choose("Roe", "Edit");
        expect(chipInput()?.value).toBe("Roe");
        expect(document.activeElement).toBe(chipInput());
        await typeChip("Roe, Rita");
        await act(() => {
          chipInput()!.dispatchEvent(
            new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
          );
        });

        expect(literatureNotes.write).toHaveBeenLastCalledWith(
          edit("authors", ["Doe, J", "Roe, Rita"]),
        );
        expect(
          cell("authors").querySelector("[data-query-vault-editor]"),
        ).toBeNull();
      });
    });

    describe("with the vault's values suggested", () => {
      /** The suggestions on the page, a highlighted one marked with `*`. */
      const suggested = () => {
        const popover = document.querySelector(".suggestion-container");
        if (!popover) return null;
        return [...popover.querySelectorAll(".suggestion-item")].map(
          (item) =>
            `${item.textContent}${item.classList.contains("is-selected") ? " *" : ""}`,
        );
      };
      const PROJECTS = [
        "thesis, ch. 3",
        "memex",
        "zettelkasten",
        "a very long project name that should wrap or truncate",
        "hypertext history",
        "citations",
        "Thesis 10",
        "thesis",
        "Thesis 9",
        "hypertext",
      ];
      const projects = () =>
        typed(
          ["vault.projects"],
          { projects: ["zettelkasten"] },
          { types: { projects: "multitext" }, values: { projects: PROJECTS } },
        );

      it("opens on a list's every vault value as its edit starts, in order, less the list's own, none highlighted", async () => {
        const { cell } = await projects();

        await act(() => cell("projects").click());

        expect(suggested()).toEqual([
          "a very long project name that should wrap or truncate",
          "citations",
          "hypertext",
          "hypertext history",
          "memex",
          "thesis",
          "Thesis 9",
          "Thesis 10",
          "thesis, ch. 3",
        ]);
      });

      it("narrows to the values that match what is typed, the first highlighted", async () => {
        const { cell, type } = await projects();

        await act(() => cell("projects").click());
        await type("hyper");

        expect(suggested()).toEqual(["hypertext *", "hypertext history"]);
        await type("nothing like it");
        expect(suggested()).toBeNull();
      });

      it("adds the highlighted value on Enter, the raw text on Shift+Enter, and opens again without them", async () => {
        const { cell, type, press, literatureNotes } = await projects();
        const chips = () =>
          [...cell("projects").querySelectorAll("[data-query-vault-chip]")].map(
            (chip) => chip.getAttribute("data-query-vault-chip"),
          );

        await act(() => cell("projects").click());
        await press("ArrowDown");
        await press("ArrowDown");
        expect(suggested()?.slice(0, 2)).toEqual([
          "a very long project name that should wrap or truncate",
          "citations *",
        ]);
        await press("Enter");
        expect(chips()).toEqual(["zettelkasten", "citations"]);
        expect(suggested()).not.toContain("citations");
        expect(suggested()?.[0]).toBe(
          "a very long project name that should wrap or truncate",
        );

        await type("hyp");
        await press("Enter", { shiftKey: true });
        expect(chips()).toEqual(["zettelkasten", "citations", "hyp"]);

        // The first Escape closes the suggestions, the second ends the edit.
        await press("Escape");
        expect(suggested()).toBeNull();
        expect(literatureNotes.write).not.toHaveBeenCalled();
        await press("Escape");
        expect(literatureNotes.write).toHaveBeenLastCalledWith(
          edit("projects", ["zettelkasten", "citations", "hyp"]),
        );
      });

      it("suggests a removed item again, whichever item is removed and however", async () => {
        const { cell, press } = await typed(
          ["vault.projects"],
          { projects: ["zettelkasten", "memex", "citations"] },
          { types: { projects: "multitext" }, values: { projects: PROJECTS } },
        );
        const pill = (item: string) =>
          cell("projects").querySelector<HTMLElement>(
            `[data-query-vault-chip="${item}"]`,
          )!;
        const pressOn = (el: Element, key: string) =>
          act(() => {
            el.dispatchEvent(
              new KeyboardEvent("keydown", { key, bubbles: true }),
            );
          });

        await act(() => cell("projects").click());
        expect(suggested()).not.toContain("zettelkasten");
        // The first item, by its x.
        await act(() =>
          pill("zettelkasten")
            .querySelector<HTMLElement>("[data-query-vault-chip-remove]")!
            .click(),
        );
        expect(suggested()).toContain("zettelkasten");

        // The first item again, from the keyboard: focus goes back to the
        // field, whose suggestions hold it.
        await press("Backspace");
        await pressOn(pill("citations"), "ArrowUp");
        expect(document.activeElement).toBe(pill("memex"));
        await pressOn(pill("memex"), "Backspace");
        expect(suggested()).toContain("memex");
      });

      it("opens no suggestions before a key is typed where Obsidian cannot clear their highlight", async () => {
        hideSuggestChooser(true);
        onTestFinished(() => hideSuggestChooser(false));
        const { cell, type, press, literatureNotes } = await projects();

        await act(() => cell("projects").click());
        expect(suggested()).toBeNull();
        // Enter on the empty field ends the edit, taking no value.
        await press("Enter");
        expect(literatureNotes.write).not.toHaveBeenCalled();

        await act(() => cell("projects").click());
        await type("hyper");
        expect(suggested()).toEqual(["hypertext *", "hypertext history"]);
      });

      it("adds a value clicked in the suggestions", async () => {
        const { cell } = await projects();

        await act(() => cell("projects").click());
        await act(() =>
          [...document.querySelectorAll<HTMLElement>(".suggestion-item")]
            .find((item) => item.textContent === "memex")!
            .click(),
        );

        expect(
          cell("projects").querySelector('[data-query-vault-chip="memex"]'),
        ).not.toBeNull();
      });

      it("opens a text edit on the values that match its text, and writes the one picked", async () => {
        const { cell, press, literatureNotes } = await typed(
          ["vault.status"],
          { status: "read" },
          { values: { status: ["unread", "read", "reading", "skimmed"] } },
        );

        await act(() => cell("status").click());
        expect(suggested()).toEqual(["read *", "reading", "unread"]);
        await press("ArrowDown");
        await press("Enter");

        expect(literatureNotes.write).toHaveBeenLastCalledWith(
          edit("status", "reading"),
        );
        expect(suggested()).toBeNull();
      });

      it("opens tags on the vault's tags, in order, less those the list holds; aliases suggest nothing, as in Bases", async () => {
        const { cell, press } = await typed(
          ["vault.tags", "vault.aliases"],
          { tags: ["pkm"], aliases: ["Memex essay"] },
          {
            types: { tags: "tags", aliases: "aliases" },
            values: {
              tags: ["reading/done", "pkm", "hci", "bibliometrics", "reading"],
              aliases: ["Memex essay", "As we may think"],
            },
          },
        );

        await act(() => cell("tags").click());
        expect(suggested()).toEqual([
          "bibliometrics",
          "hci",
          "reading",
          "reading/done",
        ]);
        await press("Escape");
        await press("Escape");

        await act(() => cell("aliases").click());
        expect(suggested()).toBeNull();
      });

      it("opens nothing where the vault offers no values", async () => {
        const { cell, input } = await typed(
          ["vault.projects"],
          { projects: ["zettelkasten"] },
          { types: { projects: "multitext" } },
        );

        await act(() => cell("projects").click());

        expect(input()).not.toBeNull();
        expect(suggested()).toBeNull();
      });
    });

    it("gives a property the editor and icon of its assigned type, whatever its value shows as", async () => {
      const { cell, input, type, press, literatureNotes, icon } = await typed(
        ["vault.pages", "vault.read"],
        { pages: "12", read: "yes" },
        { types: { pages: "number", read: "checkbox" } },
      );

      expect(icon("pages")).toBe("binary");
      expect(icon("read")).toBe("check-square");
      expect(
        cell("read").querySelector<HTMLInputElement>(
          "[data-query-vault-checkbox]",
        )?.checked,
      ).toBe(false);

      await act(() => cell("pages").click());
      expect(input()?.inputMode).toBe("decimal");
      await type("13");
      await press("Enter");
      expect(literatureNotes.write).toHaveBeenLastCalledWith(edit("pages", 13));
    });
  });

  describe("in the Properties popover", () => {
    async function popover(written: string[]) {
      const mounted = await mount(
        [result([itemRow("ITEMAAAA", "Ten simple rules")])],
        (text) => written.push(text),
        { propertyNames: ["rating", "status"] },
      );
      await act(() => mounted.view.setText(VAULT_FILE));
      await mounted.settle();
      await act(() => {
        mounted.el
          .querySelector<HTMLElement>("[data-query-properties]")!
          .click();
        // happy-dom has no popover, so the test sends the event that opens it.
        document
          .querySelector("[data-query-properties-popup]")!
          .dispatchEvent(
            Object.assign(new Event("beforetoggle"), { newState: "open" }),
          );
      });
      const type = async (text: string) => {
        const input = document.querySelector<HTMLInputElement>(
          "[data-query-properties-popup] input",
        )!;
        await act(() => {
          input.value = text;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
      };
      const actions = () =>
        [
          ...document.querySelectorAll<HTMLElement>(
            "[data-query-properties-action]",
          ),
        ].map((node) => node.textContent);
      return { ...mounted, type, actions };
    }

    it("lists the property names of the Literature Notes", async () => {
      await popover([]);

      const listed = [
        ...document.querySelectorAll<HTMLElement>("[data-query-property]"),
      ].map((row) => [row.dataset.queryProperty, row.dataset.hidden]);
      expect(listed).toEqual(
        expect.arrayContaining([
          ["vault.status", undefined],
          ["vault.rating", ""],
        ]),
      );
    });

    it("adds a typed new name as a vault property", async () => {
      const written: string[] = [];
      const { type, actions, settle } = await popover(written);

      await type("progress");
      expect(actions()).toContain(
        m.query_view_properties_add_vault({ name: "progress" }),
      );
      await act(() =>
        document
          .querySelector<HTMLElement>(
            '[data-query-properties-action="add-vault-property"]',
          )!
          .click(),
      );
      await settle();
      expect(written.at(-1)).toContain(
        "order:\n      - title\n      - vault.status\n      - vault.progress\n",
      );
    });

    it.each(["tags", "zotero-key", "vault.aliases", "vault.zotlit-profile"])(
      "refuses the reserved or system key %s",
      async (typed) => {
        const { type, actions } = await popover([]);

        await type(typed);
        const name = typed.replace(/^vault\./, "");
        expect(actions()).not.toContain(
          m.query_view_properties_add_vault({ name }),
        );
        expect(actions()).not.toContain(
          m.query_view_properties_add({ name: `vault.${name}` }),
        );
      },
    );
  });
});

describe("sorted by a vault property", () => {
  const sortedFile = (sort: string, extra = "") => `views:
  - type: table
    name: Reading list
    from: items
    limit: 2
${extra}    order:
      - title
      - vault.status
    sort:
${sort}`;
  const BY_STATUS = `      - property: vault.status
        direction: ASC
`;
  const FOUR = () =>
    result([
      itemRow("ITEMAAAA", "Ten simple rules"),
      itemRow("ITEMBBBB", "Deep learning"),
      itemRow("ITEMCCCC", "Attention"),
      itemRow("ITEMDDDD", "Transformers"),
    ]);
  const VAULT = {
    notes: { ITEMAAAA: "A.md", ITEMBBBB: "B.md", ITEMCCCC: "C.md" },
    frontmatter: {
      "A.md": { status: "unread" },
      "B.md": { status: "reading" },
      "C.md": { status: "done" },
    },
  };
  /** The titles of the rows on screen, in order. */
  const titles = (view: QueryView) =>
    (view.state.getState().results?.rows ?? []).map(
      (row) => row.values["title"],
    );

  it("asks ZotLit Query for every match up to the cap, and shows exactly `limit` rows in the vault order", async () => {
    const { view, run, settle } = await mount([FOUR()], undefined, VAULT);
    await act(() =>
      view.setText(
        sortedFile(`${BY_STATUS}      - property: dateAdded
        direction: DESC
`),
      ),
    );
    await settle();

    const request = run.mock.calls[0]![0];
    expect(request.limit).toBe(5000);
    expect(request.sort).toEqual([{ field: "dateAdded", direction: "desc" }]);
    // The engine sort field comes back, though no column shows it.
    expect(request.fields).toContain("dateAdded");
    expect(request.fields).not.toContain("vault.status");
    expect(titles(view)).toEqual(["Attention", "Deep learning"]);
    expect(view.state.getState().results).toMatchObject({
      count: 2,
      matched: 4,
      truncated: true,
    });
  });

  it("puts an Item with no note or no value last, descending as well", async () => {
    const { view, settle } = await mount([FOUR()], undefined, {
      ...VAULT,
      frontmatter: { ...VAULT.frontmatter, "B.md": { status: null } },
    });
    await act(() =>
      view.setText(
        sortedFile(BY_STATUS.replace("ASC", "DESC")).replace(
          "limit: 2",
          "limit: 10",
        ),
      ),
    );
    await settle();

    expect(titles(view)).toEqual([
      "Ten simple rules",
      "Attention",
      "Deep learning",
      "Transformers",
    ]);
    expect(view.state.getState().results?.truncated).toBe(false);
  });

  it("keeps `limit` rows in each group after the sort", async () => {
    const rows = [
      itemRow("ITEMAAAA", "Ten simple rules"),
      itemRow("ITEMBBBB", "Deep learning"),
      itemRow("ITEMCCCC", "Attention"),
      {
        ...itemRow("ITEMDDDD", "Transformers"),
        values: {
          ...itemRow("ITEMDDDD", "Transformers").values,
          itemType: "book",
        },
      },
    ];
    const { view, settle } = await mount([result(rows)], undefined, VAULT);
    await act(() =>
      view.setText(
        sortedFile(
          BY_STATUS,
          `    groupBy:
      property: itemType
      direction: ASC
`,
        ).replace("limit: 2", "limit: 1"),
      ),
    );
    await settle();

    expect(
      view.state
        .getState()
        .results?.records.map(({ row, group }) => [
          row.values["title"],
          group?.key,
        ]),
    ).toEqual([
      ["Transformers", "book"],
      ["Attention", "journalArticle"],
    ]);
  });

  it("shows that more matched when ZotLit Query stops at the cap", async () => {
    const { view, settle } = await mount(
      [result([itemRow("ITEMAAAA", "Ten simple rules")], 5001)],
      undefined,
      VAULT,
    );
    await act(() =>
      view.setText(sortedFile(BY_STATUS).replace("limit: 2", "limit: 10")),
    );
    await settle();

    expect(view.state.getState().results).toMatchObject({
      count: 1,
      matched: 5001,
      truncated: true,
    });
  });

  it("sends the view's limit when no sort key is a vault property", async () => {
    const { view, run, settle } = await mount([FOUR()], undefined, VAULT);
    await act(() =>
      view.setText(
        sortedFile(`      - property: title
        direction: ASC
`),
      ),
    );
    await settle();

    expect(run.mock.calls[0]![0].limit).toBe(2);
  });

  it("runs again when the limit changes", async () => {
    const { view, run, settle } = await mount(
      [FOUR(), FOUR()],
      undefined,
      VAULT,
    );
    await act(() => view.setText(sortedFile(BY_STATUS)));
    await settle();
    await act(() =>
      view.setText(sortedFile(BY_STATUS).replace("limit: 2", "limit: 3")),
    );
    await settle();

    expect(run).toHaveBeenCalledTimes(2);
    expect(titles(view)).toEqual([
      "Attention",
      "Deep learning",
      "Ten simple rules",
    ]);
  });

  it("names a saved sort on a vault property no note holds as the note's, not by its path", async () => {
    const { view, el, settle } = await mount([FOUR()], undefined, {
      ...VAULT,
      propertyNames: ["pages"],
    });
    await act(() => view.setText(sortedFile(BY_STATUS)));
    await settle();
    await act(() =>
      el.querySelector<HTMLElement>('[data-query-toolbar="sort"]')!.click(),
    );

    const select = document.body.querySelector(
      '[data-sort-row="vault.status"] [data-sort-property]',
    )!;
    expect(select.textContent).toContain(
      m.query_view_vault_property_label({ name: "status" }),
    );
  });

  it("offers the vault properties in the Sort control of an Items view", async () => {
    const { view, el, settle } = await mount([FOUR()], undefined, {
      ...VAULT,
      propertyNames: ["status", "pages"],
    });
    await act(() => view.setText(sortedFile(BY_STATUS)));
    await settle();
    await act(() =>
      el.querySelector<HTMLElement>('[data-query-toolbar="sort"]')!.click(),
    );

    const select = document.body.querySelector(
      '[data-sort-row="vault.status"] [data-sort-property]',
    )!;
    const options = (await selectOptions(select)).map((o) => o.value);
    expect(options).toContain("vault.status");
    expect(options).toContain("vault.pages");
    expect(options).not.toContain("vault.literatureNote");
    expect(
      document.body
        .querySelector('[data-sort-row="vault.status"]')
        ?.hasAttribute("data-sort-unused"),
    ).toBe(false);
  });
});
