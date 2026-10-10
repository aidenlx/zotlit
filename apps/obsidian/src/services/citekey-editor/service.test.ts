import type { Extension } from "@codemirror/state";
import { MarkdownView } from "obsidian";
import type { HoverLinkSource } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { ProfileId } from "@/lib/profile-stamp";
import { lookupForWorks } from "@/services/citation-index/__fixtures__/lookup";
import { CitationLookupAnswer } from "@/services/citation-index/lookup";
import type { CitekeyResolution } from "@/services/citation-index/service";
import type { DocumentCitations } from "@/services/citation-text/service";
import { CITEKEY_HOVER_SOURCE } from "@/services/citekey-navigation";
import type { AvailableLibrary } from "@/services/library-scope/scope";
import type { CreationProfileSelection } from "@/services/note-feature";
import { NoteIndexStub } from "@/services/note-index/test-stub";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";
import {
  inProcessReadsService,
  memoryOpener,
  seedWorksSql,
  withState,
} from "@/services/zotero-reads/test-utils";
import type { SeededWork } from "@/services/zotero-reads/test-utils";
import { chooseLiteratureNoteProfile } from "@/views/quick-switch/profile-picker";
import type { LiteratureNoteProfileChoice } from "@/views/quick-switch/profile-picker";

import { CitekeyEditor } from "./service";
import type { AmbiguousCitekey } from "./service";

/** Every reads stand-in a test opened, disposed after it. */
const opened: AsyncDisposable[] = [];
afterEach(async () => {
  for (const reads of opened.splice(0)) await reads[Symbol.asyncDispose]();
});

/**
 * ZoteroReads on the in-process adapter over My Library and the Shared group
 * (group 7, Library 4), holding `works`.
 */
function reads(works: readonly SeededWork[] = []) {
  const sql = `${seedWorksSql(works)}
    insert into libraries (libraryID, type) values (4, 'group');
    insert into groups (groupID, libraryID, name) values (7, 4, 'Shared group');`;
  const service = inProcessReadsService(memoryOpener(() => sql).open);
  opened.push(service);
  return withState(service, "ready");
}

vi.mock("@/views/quick-switch/profile-picker", () => ({
  chooseLiteratureNoteProfile: vi.fn(),
}));

describe("CitekeyEditor Profile creation", () => {
  const books = "Bk3Qn7XvT2Lp" as ProfileId;
  const item = {
    itemID: 11,
    libraryID: 1,
    indexedKey: "PAPER234",
    key: "PAPER234",
  };
  function fixture(
    selection: CreationProfileSelection = {
      selector: "default",
      source: "bound",
      shouldAsk: true,
    },
  ) {
    const create = vi.fn(async () => ({
      outcome: "created",
      file: { path: "Books/Paper.md" },
    }));
    const openLinkText = vi.fn(async () => {});
    const citationIndex = new CitationIndexStub({
      paper2024: { kind: "unique", item },
    });
    const service = new CitekeyEditor({
      app: {
        workspace: {
          updateOptions: () => {},
          getLeavesOfType: () => [],
          openLinkText,
        },
      },
      plugin: {
        registerEditorExtension: () => {},
        registerHoverLinkSource: () => {},
      },
      settings: new SettingsStub(),
      noteIndex: new NoteIndexStub(),
      citationIndex,
      citationText: new CitationTextStub(),
      zoteroPref: { dataDir: null },
      db: reads([{ itemID: item.itemID, key: item.key }]),
      noteFeature: {
        resolveCreationProfile: async () => selection,
        prepareCreationProfiles: async () => [
          {
            selector: "default",
            label: undefined,
            folder: "Literature",
            citationStyle: null,
            document: undefined,
            path: "Literature/Paper.md",
            create: vi.fn(),
          },
          {
            selector: books,
            label: "Books",
            folder: "Books",
            citationStyle: null,
            document: undefined,
            path: "Books/Paper.md",
            create,
          },
        ],
      },
    } as never);
    return { service, create, openLinkText, citationIndex };
  }

  it("waits for the Profile choice before creating and preserves the requested pane", async () => {
    const h = fixture();
    await using service = h.service;
    await service.ready;
    const choice = Promise.withResolvers<
      LiteratureNoteProfileChoice | undefined
    >();
    vi.mocked(chooseLiteratureNoteProfile).mockReturnValue(choice.promise);
    const opening = service.openCitekey("paper2024", "tab");
    await vi.waitFor(() =>
      expect(chooseLiteratureNoteProfile).toHaveBeenCalledOnce(),
    );
    expect(h.create).not.toHaveBeenCalled();
    expect(h.openLinkText).not.toHaveBeenCalled();
    choice.resolve({ id: books, label: "Books" });
    await opening;
    expect(h.create).toHaveBeenCalledOnce();
    expect(h.openLinkText).toHaveBeenCalledWith("Books/Paper.md", "", "tab", {
      active: true,
    });
  });

  it("creates directly under a match-selected Profile without the picker", async () => {
    const h = fixture({
      selector: books,
      source: "match",
      shouldAsk: true,
      reason: m.profile_match_selected({ profile: "Books" }),
    });
    await using service = h.service;
    await service.ready;
    vi.mocked(chooseLiteratureNoteProfile).mockClear();
    await service.openCitekey("paper2024", "tab");
    expect(chooseLiteratureNoteProfile).not.toHaveBeenCalled();
    expect(h.create).toHaveBeenCalledOnce();
    expect(h.openLinkText).toHaveBeenCalledWith("Books/Paper.md", "", "tab", {
      active: true,
    });
  });

  it("keeps hover read-only and dismissal silent", async () => {
    const h = fixture();
    await using service = h.service;
    await service.ready;
    expect(service.hoverNotePath("paper2024")).toBeNull();
    expect(chooseLiteratureNoteProfile).not.toHaveBeenCalled();
    vi.mocked(chooseLiteratureNoteProfile).mockResolvedValue(undefined);
    await service.openCitekey("paper2024", false);
    expect(h.create).not.toHaveBeenCalled();
    expect(h.openLinkText).not.toHaveBeenCalled();
  });

  it("asks for a Profile after an exact ambiguous-citekey candidate is selected", async () => {
    const h = fixture();
    await using service = h.service;
    await service.ready;
    vi.mocked(chooseLiteratureNoteProfile).mockResolvedValue({
      id: books,
      label: "Books",
    });
    await service.openCandidate(
      { ...item, summary: "A study of citations", library: null },
      true,
    );
    expect(h.citationIndex.citekeysResolved).toEqual([]);
    expect(chooseLiteratureNoteProfile).toHaveBeenCalledOnce();
    expect(h.openLinkText).toHaveBeenCalledWith("Books/Paper.md", "", true, {
      active: true,
    });
  });
});

describe("CitekeyEditor settings lifecycle", () => {
  it("registers the extension while formatting or navigation is enabled", async () => {
    const settings = new SettingsStub({
      "citation.show-formatted": false,
      "citation.open-as-links": false,
    });
    let registered: Extension[] = [];
    let reconfigures = 0;
    const service = new CitekeyEditor({
      app: {
        workspace: {
          updateOptions: () => reconfigures++,
          getLeavesOfType: () => [],
        },
      },
      plugin: {
        registerEditorExtension: (extension: Extension) => {
          registered = extension as Extension[];
        },
        registerHoverLinkSource: () => undefined,
      },
      noteIndex: new NoteIndexStub(),
      citationText: new CitationTextStub(),
      citationIndex: new CitationIndexStub(),
      settings,
    } as never);
    await service.ready;

    expect(registered).toEqual([]);
    expect(service.navigationEnabled).toBe(false);
    settings.update({ "citation.show-formatted": true });
    expect(registered).toHaveLength(1);
    expect(service.navigationEnabled).toBe(false);

    settings.update({ "citation.open-as-links": true });
    expect(registered).toHaveLength(1);
    expect(service.navigationEnabled).toBe(true);
    expect(reconfigures).toBe(1);

    settings.update({ "citation.show-formatted": false });
    expect(registered).toHaveLength(1);
    expect(service.navigationEnabled).toBe(true);
    settings.update({ "citation.open-as-links": false });
    expect(registered).toEqual([]);
    expect(service.navigationEnabled).toBe(false);

    await service[Symbol.asyncDispose]();
    expect(registered).toEqual([]);
  });

  it("stays off while Pandoc citations are off, whatever the editor toggle says", async () => {
    const settings = new SettingsStub({
      "citation.pandoc-citations": false,
      "citation.open-as-links": true,
    });
    let registered: Extension[] = [];
    await using service = new CitekeyEditor({
      app: { workspace: { updateOptions: () => undefined } },
      plugin: {
        registerEditorExtension: (extension: Extension) => {
          registered = extension as Extension[];
        },
        registerHoverLinkSource: () => undefined,
      },
      noteIndex: new NoteIndexStub(),
      citationText: new CitationTextStub(),
      citationIndex: new CitationIndexStub(),
      settings,
    } as never);
    await service.ready;

    expect(registered).toEqual([]);
    settings.update({ "citation.pandoc-citations": true });
    expect(registered).toHaveLength(1);
    settings.update({ "citation.pandoc-citations": false });
    expect(registered).toEqual([]);
  });
});

describe("CitekeyEditor hover source", () => {
  it("registers one Mod-gated hover-link source for every citekey surface", async () => {
    const sources: Record<string, HoverLinkSource> = {};
    await using service = new CitekeyEditor({
      app: { workspace: { updateOptions: () => undefined } },
      plugin: {
        registerEditorExtension: () => undefined,
        registerHoverLinkSource: (id: string, info: HoverLinkSource) => {
          sources[id] = info;
        },
      },
      noteIndex: new NoteIndexStub(),
      citationText: new CitationTextStub(),
      citationIndex: new CitationIndexStub(),
      settings: new SettingsStub(),
    } as never);
    await service.ready;

    expect(Object.keys(sources)).toEqual([CITEKEY_HOVER_SOURCE]);
    // Mod is the platform convention, and this row is the Page preview
    // plugin's own gate on the Page preview Hover action.
    expect(sources[CITEKEY_HOVER_SOURCE]?.defaultMod).toBe(true);
    expect(sources[CITEKEY_HOVER_SOURCE]?.display).toBeTruthy();
  });
});

describe("CitekeyEditor lookup ownership", () => {
  it("leaves lookup redraws to each open editor view", async () => {
    const citationIndex = new CitationIndexStub();
    let requests = 0;
    await using service = new CitekeyEditor({
      app: {
        workspace: {
          updateOptions: () => undefined,
          getLeavesOfType: (type: string) => {
            if (type === "markdown") requests++;
            return [];
          },
        },
      },
      plugin: {
        registerEditorExtension: () => undefined,
        registerHoverLinkSource: () => undefined,
      },
      noteIndex: new NoteIndexStub(),
      citationText: new CitationTextStub(),
      citationIndex,
      settings: new SettingsStub(),
    } as never);
    await service.ready;

    citationIndex.emit();
    expect(requests).toBe(0);
  });
});

describe("CitekeyEditor citation text broadcast", () => {
  /** The markdown leaves two notes are open in, as the workspace hands them out. */
  const leaves = (dispatched: string[]) =>
    ["note.md", "other.md"].map((path) => ({
      // The service narrows a leaf's view with `instanceof`, so the stand-in
      // carries the prototype rather than running the real constructor.
      view: Object.assign(Object.create(MarkdownView.prototype) as object, {
        file: { path },
        editor: { cm: { dispatch: () => dispatched.push(path) } },
      }),
    }));

  const openEditors = async (dispatched: string[]) => {
    const citationText = new CitationTextStub();
    const service = new CitekeyEditor({
      app: {
        workspace: {
          updateOptions: () => undefined,
          getLeavesOfType: () => leaves(dispatched),
        },
      },
      plugin: {
        registerEditorExtension: () => undefined,
        registerHoverLinkSource: () => undefined,
      },
      noteIndex: new NoteIndexStub(),
      citationText,
      citationIndex: new CitationIndexStub(),
      settings: new SettingsStub(),
    } as never);
    await service.ready;
    return { service, citationText };
  };

  it("redraws only the editors showing the document whose text changed", async () => {
    const dispatched: string[] = [];
    const { service, citationText } = await openEditors(dispatched);

    citationText.emit("changed", "note.md");

    expect(dispatched).toEqual(["note.md"]);
    await service[Symbol.asyncDispose]();
  });

  it("redraws every editor when all citation text goes stale", async () => {
    const dispatched: string[] = [];
    const { service, citationText } = await openEditors(dispatched);

    citationText.emit("invalidated");

    expect(dispatched).toEqual(["note.md", "other.md"]);
    await service[Symbol.asyncDispose]();
  });
});

describe("CitekeyEditor ambiguous citation keys", () => {
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

  async function openEditor(
    notes: Record<string, { path: string }[]> = {},
    opened: { path: string; pane: unknown }[] = [],
    works: readonly SeededWork[] = [],
  ) {
    const citationIndex = new CitationIndexStub({ doe2024: AMBIGUOUS });
    const ambiguities: AmbiguousCitekey[] = [];
    const service = new CitekeyEditor({
      app: {
        workspace: {
          updateOptions: () => undefined,
          getLeavesOfType: () => [],
          openLinkText: (path: string, _from: string, pane: unknown) => {
            opened.push({ path, pane });
            return Promise.resolve();
          },
        },
      },
      plugin: {
        registerEditorExtension: () => undefined,
        registerHoverLinkSource: () => undefined,
      },
      noteIndex: new NoteIndexStub(notes),
      citationText: new CitationTextStub(),
      citationIndex,
      libraryScope: {
        current: {
          mode: "all",
          invalid: false,
          available: [MY_LIBRARY, GROUP_LIBRARY],
          unavailable: [],
        },
      },
      db: reads(works),
      settings: new SettingsStub(),
    } as never);
    await service.ready;
    service.on("citekey-ambiguous", (ambiguous) => ambiguities.push(ambiguous));
    return { service, citationIndex, ambiguities };
  }

  it("reports every candidate with its summary, Library name, and bare Zotero item key", async () => {
    const items = [
      zoteroItem(11, "A study of citations", "Doe"),
      zoteroItem(22, "Another study", "Roe"),
    ];
    const opened: { path: string; pane: unknown }[] = [];
    const { service, ambiguities } = await openEditor({}, opened, items);

    await service.openCitekey("doe2024", false);

    expect(opened).toEqual([]);
    expect(ambiguities).toHaveLength(1);
    expect(ambiguities[0]).toMatchObject({ citekey: "doe2024", pane: false });
    expect(
      ambiguities[0]!.candidates.map(({ summary, library, key }) => ({
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
    await service[Symbol.asyncDispose]();
  });

  // The page preview would have to pick one of the candidates to show, so it
  // shows none of them: a hover implies no identity the key does not carry.
  it("previews no note for a citekey that names several Items", async () => {
    const { service } = await openEditor({
      DEAA2345: [{ path: "Doe 2024.md" }],
      REBB3456g7: [{ path: "Roe 2025.md" }],
    });

    expect(service.hoverNotePath("doe2024")).toBeNull();
    await service[Symbol.asyncDispose]();
  });

  it("opens a chosen candidate by its exact Indexed Key without resolving the key again", async () => {
    const opened: { path: string; pane: unknown }[] = [];
    const { service, citationIndex, ambiguities } = await openEditor(
      { REBB3456g7: [{ path: "Roe 2025.md" }] },
      opened,
    );
    await service.openCitekey("doe2024", "tab");
    citationIndex.citekeysResolved.length = 0;

    await service.openCandidate(ambiguities[0]!.candidates[1]!, "tab");

    expect(opened).toEqual([{ path: "Roe 2025.md", pane: "tab" }]);
    expect(citationIndex.citekeysResolved).toEqual([]);
    await service[Symbol.asyncDispose]();
  });
});

class CitationTextStub {
  readonly #listeners: Record<string, Set<(path?: string) => void>> = {};

  peek(): DocumentCitations | null {
    return null;
  }

  load(): Promise<DocumentCitations> {
    return Promise.resolve({
      formatted: new Map(),
      entrySerials: false,
      summaries: new Map(),
      lookup: lookupForWorks(new Map()),
      literalWorks: new Map(),
    });
  }

  on(event: string, cb: (path?: string) => void): () => void {
    const listeners = (this.#listeners[event] ??= new Set());
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  emit(event: string, path?: string): void {
    for (const cb of this.#listeners[event] ?? []) cb(path);
  }
}

class CitationIndexStub {
  readonly #resolutions: Record<string, CitekeyResolution>;
  readonly #listeners = new Set<() => void>();
  readonly citekeysResolved: string[] = [];

  constructor(resolutions: Record<string, CitekeyResolution> = {}) {
    this.#resolutions = resolutions;
  }

  readLookup({ citekeys = [] }: { citekeys?: readonly string[] }) {
    this.citekeysResolved.push(...citekeys);
    return Promise.resolve(this.#answer(citekeys));
  }

  observeLookup(cb: () => void) {
    this.#listeners.add(cb);
    return {
      current: null,
      set: () => undefined,
      [Symbol.dispose]: () => this.#listeners.delete(cb),
    };
  }

  emit(): void {
    for (const cb of this.#listeners) cb();
  }

  #answer(citekeys: readonly string[]) {
    return new CitationLookupAnswer({
      revision: "test",
      citekeys: new Map(
        citekeys.map((citekey) => [
          citekey,
          this.#resolutions[citekey] ?? { kind: "missing" as const },
        ]),
      ),
      indexedKeys: new Map(),
    });
  }
}

class SettingsStub {
  current: Readonly<Settings>;
  readonly ready = Promise.resolve();
  readonly #listeners = new Set<
    (settings: Readonly<Settings> | null) => void
  >();

  constructor(overrides: Partial<Settings> = {}) {
    this.current = { ...defaults, ...overrides };
  }

  subscribe(
    listener: (settings: Readonly<Settings> | null) => void,
  ): () => void {
    this.#listeners.add(listener);
    listener(this.current);
    return () => this.#listeners.delete(listener);
  }

  update(overrides: Partial<Settings>): void {
    this.current = { ...this.current, ...overrides };
    for (const listener of this.#listeners) listener(this.current);
  }
}
