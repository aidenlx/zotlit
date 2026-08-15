import type { Extension } from "@codemirror/state";
import { MarkdownView } from "obsidian";
import type { HoverLinkSource } from "obsidian";
import { describe, expect, it } from "vitest";

import type { DocumentCitations } from "@/services/citation-text/service";
import { CITEKEY_HOVER_SOURCE } from "@/services/citekey-navigation";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";

import { CitekeyEditor } from "./service";

describe("CitekeyEditor settings lifecycle", () => {
  it("registers the extension while formatting or navigation is enabled", async () => {
    const settings = new SettingsStub({
      "citation.show-formatted": false,
      "citation.open-pandoc-links": false,
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

    settings.update({ "citation.open-pandoc-links": true });
    expect(registered).toHaveLength(1);
    expect(service.navigationEnabled).toBe(true);
    expect(reconfigures).toBe(1);

    settings.update({ "citation.show-formatted": false });
    expect(registered).toHaveLength(1);
    expect(service.navigationEnabled).toBe(true);
    settings.update({ "citation.open-pandoc-links": false });
    expect(registered).toEqual([]);
    expect(service.navigationEnabled).toBe(false);

    await service[Symbol.asyncDispose]();
    expect(registered).toEqual([]);
  });

  it("stays off while Pandoc citations are off, whatever the editor toggle says", async () => {
    const settings = new SettingsStub({
      "citation.pandoc-citations": false,
      "citation.open-pandoc-links": true,
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

describe("CitekeyEditor hover preview", () => {
  it("registers one hover-link source that previews on bare hover", async () => {
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
    expect(sources[CITEKEY_HOVER_SOURCE]?.defaultMod).toBe(false);
    expect(sources[CITEKEY_HOVER_SOURCE]?.display).toBeTruthy();
  });

  it("answers with a note path only while exactly one literature note matches", async () => {
    const citationIndex = new CitationIndexStub({
      doe2024: { itemID: 1, indexedKey: "ABCD2024" },
      smith2020: { itemID: 2, indexedKey: "ABCD2020" },
    });
    const notes: Record<string, { path: string }[]> = {
      ABCD2024: [{ path: "lit/doe2024.md" }],
      ABCD2020: [{ path: "lit/a.md" }, { path: "lit/b.md" }],
    };
    await using service = new CitekeyEditor({
      app: { workspace: { updateOptions: () => undefined } },
      plugin: {
        registerEditorExtension: () => undefined,
        registerHoverLinkSource: () => undefined,
      },
      noteIndex: new NoteIndexStub(notes),
      citationText: new CitationTextStub(),
      citationIndex,
      settings: new SettingsStub(),
    } as never);
    await service.ready;

    expect(service.hoverNotePath("doe2024")).toBe("lit/doe2024.md");
    expect(service.hoverNotePath("smith2020")).toBeNull();
    expect(service.hoverNotePath("nobody1999")).toBeNull();
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

interface SnapshotItemStub {
  itemID: number;
  indexedKey: string;
}

class CitationIndexStub {
  readonly #resolutions: Record<string, SnapshotItemStub>;
  readonly #listeners = new Set<() => void>();

  constructor(resolutions: Record<string, SnapshotItemStub> = {}) {
    this.#resolutions = resolutions;
  }

  resolveCitekey(citekey: string): SnapshotItemStub | null {
    return this.#resolutions[citekey] ?? null;
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
