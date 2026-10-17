// @vitest-environment happy-dom
// The Query View runs one view of a Query File through ZotLit Query and shows
// its rows as live Annotation Cards. These tests drive it as a host does: the
// file's text in, the cards, the count and the messages out.
import { Menu, resetMockPlatform, setMockPlatform } from "@mock/obsidian";
import { Scope } from "obsidian";
import type { App } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { nameDictionary } from "@zotlit/item-query";
import type { FormulaDiagnostics, QueryContext } from "@zotlit/item-query";

import { Effect } from "@/lib/effect";
import * as m from "@/lib/i18n/generated/messages";
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
import { editorApp } from "@/views/annot-view/__fixtures__/editor-app";

import { requested } from "./__fixtures__/query-run";
import type { ContextSource } from "./context-hint";
import { groupOptions } from "./properties";
import { QUERY_FILE_DATASETS, serializeQueryFile } from "./query-file";
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
import { QueryView, RERUN_DELAY_MS } from "./view";
import type { QueryViewDeps } from "./view";

vi.mock("zustand", () => import("../__fixtures__/zustand"));
/** The text of each notice the view shows. */
const notices = vi.hoisted((): string[] => []);
vi.mock("obsidian", async (importOriginal) => {
  const obsidian = await importOriginal<typeof import("obsidian")>();
  return {
    ...obsidian,
    // A substring match, enough for a search of the Properties popover.
    prepareFuzzySearch: (query: string) => (text: string) =>
      text.includes(query) ? { score: 0, matches: [] } : null,
    Notice: class extends obsidian.Notice {
      constructor(message: string | DocumentFragment, duration?: number) {
        super(message, duration);
        notices.push(
          typeof message === "string" ? message : (message.textContent ?? ""),
        );
      }
    },
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
      query: {} as never,
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

let cleanup = new DisposableStack();
afterEach(() => {
  notices.length = 0;
  cleanup.dispose();
  cleanup = new DisposableStack();
  document.body.replaceChildren();
});

async function mount(
  answers: QueryViewOutcome[],
  onWrite?: (text: string) => void,
  {
    notes = {},
    frontmatter = {},
    managed = {},
    propertyNames = [],
    sourcePath = "query-files/Reading.zotquery",
    layout,
    write,
    canSave,
    context = () => undefined,
    contextSource,
    creation = "created",
  }: {
    notes?: Record<string, string>;
    /** The frontmatter of each note, by path. */
    frontmatter?: Record<string, Record<string, unknown>>;
    /** The keys each note's Profile manages with replace, by path. */
    managed?: Record<string, string[]>;
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
    /**
     * What the usual creation does for an edit of an Item with no note:
     * create its note at `<key>.md`, or have the Profile prompt cancelled.
     */
    creation?: "created" | "cancelled";
  } = {},
) {
  setMockPlatform({ isMacOS: true });
  cleanup.defer(resetMockPlatform);
  const reads = emitter();
  const libraryScope = emitter();
  const repository = emitter();
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
    propertyType: (name: string): VaultPropertyType => {
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
    open: vi.fn(),
    create: vi.fn(async (itemKey: string) => {
      notes[itemKey] = `${itemKey}.md`;
      notesChanged.emit("changed");
    }),
  };
  const deps = {
    app: editorApp() as unknown as App,
    reads: {
      on: reads.on,
      acquireRead: () =>
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
        }),
    },
    libraryScope: {
      on: libraryScope.on,
      current: {
        available: [
          { selector: { type: "personal" }, libraryID: 1, name: null },
          {
            selector: { type: "group", groupID: 4815 },
            libraryID: 2,
            name: "Lab",
          },
        ],
      },
    },
    query: { run },
    annotations: {
      read: () => Promise.resolve(list),
      peek: () => ({ value: list }),
      refresh: () => Promise.resolve(),
      capabilityFor: (): EditingCapability => ({ kind: "writable" }),
      textDraftFor: () => null,
      tagDraftFor: () => null,
      annotationState: () => ({
        mutation: IDLE,
        textDrafts: {},
        tagDraft: null,
        hidden: false,
        gone: false,
      }),
      on: repository.on,
      hold: (keys: Iterable<string>) => {
        const list = [...keys];
        held.push(list);
        return { [Symbol.dispose]: () => released.push(list) };
      },
    },
    zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
    excerptDisplay: { open: vi.fn(), refresh: vi.fn() },
    noteFeature: {},
    libraryTagNames: () => Promise.resolve([]),
    allowEditing: vi.fn(),
    reportBlockedGesture: vi.fn(),
    literatureNotes,
  } as unknown as QueryViewDeps;
  const save = vi.fn((_text: string) => {});
  const onSelectView = vi.fn((_name: string) => {});
  const view = new QueryView(deps, {
    scope: new Scope(),
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
  cleanup.defer(() => vi.useRealTimers());
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
  cleanup.defer(() => vi.useRealTimers());
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
          } as never,
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
  expect(el.querySelector("[data-query-empty]")).toBeNull();
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
    cleanup.defer(() => vi.useRealTimers());
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

function choose(select: HTMLSelectElement, value: string) {
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
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
    ...editor().querySelectorAll<HTMLSelectElement>("[data-sort-property]"),
  ];
  const options = [...properties()[0]!.options].map((o) => o.value);
  expect(options).not.toContain("text");
  expect(options).not.toContain("pageLabel");
  await act(() => choose(properties()[1]!, "dateAdded"));
  await act(() =>
    choose(
      editor().querySelectorAll<HTMLSelectElement>("[data-sort-direction]")[1]!,
      "DESC",
    ),
  );
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
  expect(properties().map((select) => select.value)).toEqual([
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
  await act(() =>
    choose(
      editor().querySelector<HTMLSelectElement>("[data-group-direction]")!,
      "MANUAL",
    ),
  );
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

function chooseValue(select: HTMLSelectElement, value: string) {
  select.value = value;
  select.dispatchEvent(new Event("input", { bubbles: true }));
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
  await act(() =>
    chooseValue(color!.querySelector('select[aria-label="Value"]')!, "red"),
  );
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
  await act(() =>
    chooseValue(
      placeholder!.querySelector('select[aria-label="Value"]')!,
      "blue",
    ),
  );
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
  const kind = status!.querySelector<HTMLSelectElement>("select")!;
  expect(kind.selectedOptions[0]?.textContent).toBe("reading-status");
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
  const kinds = [...color!.querySelectorAll("option")].map(
    (option) => option.textContent,
  );
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
  expect(card.textContent).toBe("Ten simple rulesdate.year2021");
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
function tableText(el: HTMLElement): string[][] {
  return [...el.querySelectorAll("[data-query-table] tr")].map((tr) =>
    [...tr.querySelectorAll("th, td")].map(
      (cell) => cell.textContent?.trim() ?? "",
    ),
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

it("shows a view of Items as a Table: one row for each Item, a column for each visible property", async () => {
  const { view, el, run, settle } = await mount([
    result([
      itemRow("ITEMAAAA", "Ten simple rules"),
      itemRow("ITEMBBBB", "Deep learning"),
    ]),
  ]);
  await act(() => view.setText(TABLE_FILE));
  await settle();

  expect(view.state.getState().problems).toEqual([]);
  expect(run.mock.calls[0]![0]).toMatchObject({ from: "items" });
  expect(run.mock.calls[0]![0].fields).toEqual(
    expect.arrayContaining(["title", "date"]),
  );
  expect(tableText(el)).toEqual([
    ["", "Title", "Date", "Literature note"],
    ["", "Ten simple rules", "2014", "Create"],
    ["", "Deep learning", "2014", "Create"],
  ]);
  expect(cards(el)).toEqual([]);
  expect(el.querySelector("[data-query-count]")?.textContent).toBe("2 results");
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
    ["", "Title", "vault.reading-status", "Literature note"],
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
  const group = document.querySelector("[data-group-editor]")!;
  expect(group.textContent).toContain("Item Type");
  expect(document.body.textContent).not.toContain("Attachment");
});

/**
 * Each grouping Group offers, with a row's values and the heading the row
 * stands under. A List that shows none of the grouping's fields still
 * gathers its rows by them.
 */
const GROUPINGS: {
  dataset: QueryFileDataset;
  path: string;
  values: QueryViewRow["values"];
  heading: string;
}[] = [
  {
    dataset: "annotations",
    path: "item.indexedKey",
    values: { "item.title": "Ten simple rules" },
    heading: "Ten simple rules",
  },
  {
    dataset: "annotations",
    path: "attachment.indexedKey",
    values: { "attachment.title": "Full text PDF" },
    heading: "Full text PDF",
  },
  {
    dataset: "annotations",
    path: "colorName",
    values: { color: "#ffd400", colorName: "yellow" },
    heading: "Yellow",
  },
  {
    dataset: "annotations",
    path: "tags[]",
    values: { tags: ["figure"] },
    heading: "figure",
  },
  {
    dataset: "annotations",
    path: "item.collections[]",
    values: { "item.collections": ["Thesis/Methods"] },
    heading: "Thesis/Methods",
  },
  {
    dataset: "attachments",
    path: "item.indexedKey",
    values: { "item.title": "Ten simple rules" },
    heading: "Ten simple rules",
  },
  {
    dataset: "attachments",
    path: "tags[]",
    values: { tags: ["figure"] },
    heading: "figure",
  },
  {
    dataset: "attachments",
    path: "item.collections[]",
    values: { "item.collections": ["Thesis/Methods"] },
    heading: "Thesis/Methods",
  },
  {
    dataset: "items",
    path: "itemType",
    values: { itemType: "journalArticle" },
    heading: "Journal Article",
  },
  {
    dataset: "items",
    path: "tags[]",
    // An Item's tags come as `{ name, type }`.
    values: { tags: [{ name: "read-later", type: "manual" }] },
    heading: "read-later",
  },
  {
    dataset: "items",
    path: "collections[]",
    values: { collections: ["Thesis/Methods"] },
    heading: "Thesis/Methods",
  },
];

it("lists a case for each grouping of each dataset", () => {
  for (const dataset of QUERY_FILE_DATASETS)
    expect(
      GROUPINGS.filter((entry) => entry.dataset === dataset).map(
        ({ path }) => path,
      ),
    ).toEqual(groupOptions(dataset).map(({ path }) => path));
});

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
        short: "In formula.short: nope is not a method of string. Use slice.",
      },
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
        short: "In formula.short: nope is not a method of string. Use slice.",
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
  const warning = {
    code: "never-true",
    severity: "warning",
    message: "colorName == 1 is never true.",
    hint: "Compare values of the same type.",
    report: [],
  } as never;
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
  cleanup.defer(() => vi.useRealTimers());
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
    short: "First run.",
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
        year: "In formula.year: dat is not a field of Items. Use date.",
        next: "formula.next reads formula.year, which has a mistake. Correct the mistake in formula.year.",
        after:
          "formula.after reads formula.next, which has a mistake. Correct the mistake in formula.year.",
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
        year: "In formula.year: dat is not a field of Items. Use date.",
        next: "formula.next reads formula.year, which has a mistake. Correct the mistake in formula.year.",
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
    ["__proto__", "In formula.__proto__: dat is not a field of Items."],
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
      header: ["Title", "vault.status"],
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
        expect(notices).toEqual([]);
      });

      it("says nothing was written when the Profile prompt is cancelled", async () => {
        const { el, cell, type, press } = await editable({
          creation: "cancelled",
        });

        await act(() => cell("ITEMBBBB").click());
        await type("to read");
        await press("Enter");

        expect(vaultCells(el)[1]).toEqual([
          "no-note",
          m.query_view_vault_no_note(),
        ]);
        expect(notices).toEqual([
          m.query_view_vault_not_written({ name: "status" }),
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

    const select = document.body.querySelector<HTMLSelectElement>(
      '[data-sort-row="vault.status"] [data-sort-property]',
    )!;
    const options = [...select.options].map((o) => o.value);
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
