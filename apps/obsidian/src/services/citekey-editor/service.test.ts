import type { Extension } from "@codemirror/state";
import { MarkdownView } from "obsidian";
import type { HoverLinkSource } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { getItemsByID } from "@zotlit/db";
import type { Item } from "@zotlit/db";

import type { CitekeyResolution } from "@/services/citation-index/service";
import type { DocumentCitations } from "@/services/citation-text/service";
import { CITEKEY_HOVER_SOURCE } from "@/services/citekey-navigation";
import type { AvailableLibrary } from "@/services/library-scope/scope";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";

import { CitekeyEditor } from "./service";
import type { AmbiguousCitekey } from "./service";

vi.mock("@zotlit/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@zotlit/db")>();
  return { ...actual, getItemsByID: vi.fn(() => []) };
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

describe("CitekeyEditor index-change broadcast", () => {
  it("asks every open markdown editor to restyle when the citekey resolution snapshot rebuilds", async () => {
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
    expect(requests).toBe(1);
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
      { itemID: 11, libraryID: 1, key: "DOE2024", indexedKey: "DOE2024" },
      { itemID: 22, libraryID: 4, key: "ROE2025", indexedKey: "ROE2025g7" },
    ],
  };

  function zoteroItem(itemID: number, title: string, lastName: string): Item {
    return {
      itemID,
      libraryID: itemID === 11 ? 1 : 4,
      key: itemID === 11 ? "DOE2024" : "ROE2025",
      creators: [{ creatorType: "author", lastName, firstName: "A" }],
      primaryCreatorType: "author",
      fields: { itemType: "journalArticle", title, date: "2024" },
    } as unknown as Item;
  }

  async function openEditor(
    notes: Record<string, { path: string }[]> = {},
    opened: { path: string; pane: unknown }[] = [],
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
      db: { state: "ready", client: {} },
      settings: new SettingsStub(),
    } as never);
    await service.ready;
    service.on("citekey-ambiguous", (ambiguous) => ambiguities.push(ambiguous));
    return { service, citationIndex, ambiguities };
  }

  it("reports every candidate with its summary, Library name, and bare Zotero item key", async () => {
    vi.mocked(getItemsByID).mockReturnValue([
      zoteroItem(11, "A study of citations", "Doe"),
      zoteroItem(22, "Another study", "Roe"),
    ]);
    const opened: { path: string; pane: unknown }[] = [];
    const { service, ambiguities } = await openEditor({}, opened);

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
        key: "DOE2024",
      },
      {
        summary: "Roe (2024): Another study",
        library: "Shared group",
        key: "ROE2025",
      },
    ]);
    await service[Symbol.asyncDispose]();
  });

  it("opens a chosen candidate by its exact Indexed Key without resolving the key again", async () => {
    vi.mocked(getItemsByID).mockReturnValue([]);
    const opened: { path: string; pane: unknown }[] = [];
    const { service, citationIndex, ambiguities } = await openEditor(
      { ROE2025g7: [{ path: "Roe 2025.md" }] },
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

  resolveCitekey(citekey: string): CitekeyResolution {
    this.citekeysResolved.push(citekey);
    return this.#resolutions[citekey] ?? { kind: "missing" };
  }

  whenResolved(): Promise<void> {
    return Promise.resolve();
  }

  on(_event: "resolution-changed", cb: () => void): () => void {
    this.#listeners.add(cb);
    return () => this.#listeners.delete(cb);
  }

  emit(): void {
    for (const cb of this.#listeners) cb();
  }
}

class NoteIndexStub {
  readonly #notes: Record<string, { path: string }[]>;
  readonly #listeners: Record<"changed" | "rebuilt", Set<() => void>> = {
    changed: new Set(),
    rebuilt: new Set(),
  };

  constructor(notes: Record<string, { path: string }[]> = {}) {
    this.#notes = notes;
  }

  getNotesByItemKey(indexedKey: string): { path: string }[] {
    return this.#notes[indexedKey] ?? [];
  }

  whenIndexed(): Promise<void> {
    return Promise.resolve();
  }

  on(event: "changed" | "rebuilt", cb: () => void): () => void {
    this.#listeners[event].add(cb);
    return () => this.#listeners[event].delete(cb);
  }

  emit(event: "changed" | "rebuilt"): void {
    for (const cb of this.#listeners[event]) cb();
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
