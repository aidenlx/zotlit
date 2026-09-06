import type { Extension } from "@codemirror/state";
import { MarkdownView } from "obsidian";
import { describe, expect, it } from "vitest";

import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";

import { WikilinkEditor } from "./service";

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

interface Harness extends AsyncDisposable {
  service: WikilinkEditor;
  settings: SettingsStub;
  noteIndex: NoteIndexStub;
  citationText: CitationTextStub;
  citationIndex: CitationIndexStub;
  registered: Extension[];
  reconfigures: () => number;
  dispatched: string[];
}

async function harness(overrides: Partial<Settings> = {}): Promise<Harness> {
  const settings = new SettingsStub(overrides);
  const noteIndex = new NoteIndexStub();
  const citationText = new CitationTextStub();
  const citationIndex = new CitationIndexStub();
  const dispatched: string[] = [];
  let registered: Extension[] = [];
  let reconfigures = 0;
  const service = new WikilinkEditor({
    app: {
      workspace: {
        updateOptions: () => reconfigures++,
        getLeavesOfType: () => leaves(dispatched),
      },
    },
    plugin: {
      registerEditorExtension: (extension: Extension) => {
        registered = extension as Extension[];
      },
    },
    noteIndex,
    citationText,
    citationIndex,
    settings,
  } as never);
  await service.ready;
  return {
    service,
    settings,
    noteIndex,
    citationText,
    citationIndex,
    registered,
    reconfigures: () => reconfigures,
    dispatched,
    [Symbol.asyncDispose]: () => service[Symbol.asyncDispose](),
  };
}

describe("WikilinkEditor registration", () => {
  it("installs the extension once so source settings can change live", async () => {
    const { service, registered, reconfigures } = await harness({
      "citation.wikilink-citations": false,
      "citation.show-formatted": false,
    });

    expect(registered).toHaveLength(1);
    expect(reconfigures()).toBe(1);

    await service[Symbol.asyncDispose]();
    expect(registered).toEqual([]);
    expect(reconfigures()).toBe(2);
  });
});

describe("WikilinkEditor redraw", () => {
  it("redraws every open editor when a Literature Note changes", async () => {
    await using harnessed = await harness();
    const { noteIndex, dispatched } = harnessed;

    noteIndex.emit("changed");
    expect(dispatched).toEqual(["note.md", "other.md"]);
  });

  it("redraws when a gating setting changes", async () => {
    await using harnessed = await harness({
      "citation.wikilink-citations": false,
    });
    const { settings, dispatched } = harnessed;

    settings.update({ "citation.wikilink-citations": true });
    expect(dispatched).toEqual(["note.md", "other.md"]);

    dispatched.length = 0;
    settings.update({ "citation.show-formatted": false });
    expect(dispatched).toEqual(["note.md", "other.md"]);
  });

  it("redraws when the Hover Action changes who answers a hover", async () => {
    await using harnessed = await harness();
    const { settings, dispatched } = harnessed;

    settings.update({ "citation.hover-action": "off" });
    expect(dispatched).toEqual(["note.md", "other.md"]);

    // Which mode holds a hover back for a modifier is read at hover time, so
    // nothing drawn depends on it.
    dispatched.length = 0;
    settings.update({ "citation.hover-require-mod-live-preview": true });
    expect(dispatched).toEqual([]);
  });

  it("redraws every open editor when the citekey resolution snapshot rebuilds", async () => {
    await using harnessed = await harness();
    const { citationIndex, dispatched } = harnessed;

    citationIndex.emit("resolution-changed");
    expect(dispatched).toEqual(["note.md", "other.md"]);
  });

  it("leaves the editors alone when an unrelated setting changes", async () => {
    await using harnessed = await harness();
    const { settings, dispatched } = harnessed;

    settings.update({ "citation.open-as-links": false });
    expect(dispatched).toEqual([]);
  });

  it("redraws the one document whose citation text landed", async () => {
    await using harnessed = await harness();
    const { citationText, dispatched } = harnessed;

    citationText.emit("changed", "note.md");
    expect(dispatched).toEqual(["note.md"]);

    dispatched.length = 0;
    citationText.emit("invalidated");
    expect(dispatched).toEqual(["note.md", "other.md"]);
  });

  it("leaves the editors alone when Wikilink Citations is off and formatted presentation changes", async () => {
    await using harnessed = await harness({
      "citation.wikilink-citations": false,
    });
    const { settings, dispatched } = harnessed;

    settings.update({ "citation.show-formatted": false });
    expect(dispatched).toEqual([]);
  });
});

class NoteIndexStub {
  readonly #listeners: Record<"changed", Set<() => void>> = {
    changed: new Set(),
  };

  on(event: "changed", cb: () => void): () => void {
    this.#listeners[event].add(cb);
    return () => this.#listeners[event].delete(cb);
  }

  emit(event: "changed"): void {
    for (const cb of this.#listeners[event]) cb();
  }
}

class CitationTextStub {
  readonly #listeners: Record<
    "changed" | "invalidated",
    Set<(path?: string) => void>
  > = { changed: new Set(), invalidated: new Set() };

  peek(): null {
    return null;
  }

  load(): Promise<never[]> {
    return Promise.resolve([]);
  }

  on(
    event: "changed" | "invalidated",
    cb: (path?: string) => void,
  ): () => void {
    this.#listeners[event].add(cb);
    return () => this.#listeners[event].delete(cb);
  }

  emit(event: "changed" | "invalidated", path?: string): void {
    for (const cb of this.#listeners[event]) cb(path);
  }
}

class CitationIndexStub {
  readonly #listeners = new Set<() => void>();

  citekeyOf(): string | null {
    return null;
  }

  on(event: "resolution-changed", cb: () => void): () => void {
    this.#listeners.add(cb);
    return () => this.#listeners.delete(cb);
  }

  emit(_event: "resolution-changed"): void {
    for (const cb of this.#listeners) cb();
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
