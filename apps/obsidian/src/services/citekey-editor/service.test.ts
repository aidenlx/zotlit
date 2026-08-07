import { type Extension } from "@codemirror/state";
import { type HoverLinkSource } from "obsidian";
import { describe, expect, it } from "vitest";

import { CITEKEY_HOVER_SOURCE } from "@/services/citekey-navigation";
import { defaults, type Settings } from "@/services/settings/schema";

import { CitekeyEditor } from "./service";

describe("CitekeyEditor settings lifecycle", () => {
  it("registers the extension only while enabled and notices each transition into enabled plus missing", async () => {
    const settings = new SettingsStub({
      "citation.citekey-editor": false,
      "note.frontmatter-fields": defaults["note.frontmatter-fields"].filter(
        (field) => field.key !== "citekey",
      ),
    });
    const notices: string[] = [];
    let registered: Extension[] = [];
    let reconfigures = 0;
    const service = new CitekeyEditor({
      app: { workspace: { updateOptions: () => reconfigures++ } },
      plugin: {
        registerEditorExtension: (extension: Extension) => {
          registered = extension as Extension[];
        },
        registerHoverLinkSource: () => undefined,
      },
      noteIndex: new NoteIndexStub(),
      settings,
    } as never);
    service.on("missing-property", (property) => notices.push(property));
    await service.ready;

    expect(registered).toEqual([]);
    expect(service.enabled).toBe(false);
    settings.update({ "citation.citekey-editor": true });
    expect(registered).toHaveLength(1);
    expect(service.enabled).toBe(true);
    expect(reconfigures).toBe(1);
    expect(notices).toHaveLength(1);

    settings.update({ "citation.key-links-frontmatter-key": "bibkey" });
    expect(notices).toHaveLength(2);
    settings.update({
      "note.frontmatter-fields": [
        ...settings.current["note.frontmatter-fields"],
        {
          key: "bibkey",
          expr: "zt.citationKey",
          merge: "replace",
          language: "liquid",
        },
      ],
    });
    settings.update({
      "note.frontmatter-fields": settings.current[
        "note.frontmatter-fields"
      ].filter((field) => field.key !== "bibkey"),
    });
    expect(notices).toHaveLength(3);

    settings.update({ "citation.citekey-editor": false });
    expect(registered).toEqual([]);
    expect(service.enabled).toBe(false);
    settings.update({ "citation.citekey-editor": true });
    expect(registered).toHaveLength(1);
    expect(notices).toHaveLength(4);

    await service[Symbol.asyncDispose]();
    expect(registered).toEqual([]);
  });

  it("stays off while citekey indexing is off, whatever the editor toggle says", async () => {
    const settings = new SettingsStub({
      "citation.citekey-indexing": false,
      "citation.citekey-editor": true,
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
      settings,
    } as never);
    await service.ready;

    expect(registered).toEqual([]);
    settings.update({ "citation.citekey-indexing": true });
    expect(registered).toHaveLength(1);
    settings.update({ "citation.citekey-indexing": false });
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
      settings: new SettingsStub(),
    } as never);
    await service.ready;

    expect(Object.keys(sources)).toEqual([CITEKEY_HOVER_SOURCE]);
    expect(sources[CITEKEY_HOVER_SOURCE]?.defaultMod).toBe(false);
    expect(sources[CITEKEY_HOVER_SOURCE]?.display).toBeTruthy();
  });

  it("answers with a note path only while exactly one literature note matches", async () => {
    const notes: Record<string, { path: string }[]> = {
      doe2024: [{ path: "lit/doe2024.md" }],
      smith2020: [{ path: "lit/a.md" }, { path: "lit/b.md" }],
    };
    await using service = new CitekeyEditor({
      app: { workspace: { updateOptions: () => undefined } },
      plugin: {
        registerEditorExtension: () => undefined,
        registerHoverLinkSource: () => undefined,
      },
      noteIndex: new NoteIndexStub(notes),
      settings: new SettingsStub(),
    } as never);
    await service.ready;

    expect(service.hoverNotePath("doe2024")).toBe("lit/doe2024.md");
    expect(service.hoverNotePath("smith2020")).toBeNull();
    expect(service.hoverNotePath("nobody1999")).toBeNull();
  });
});

describe("CitekeyEditor index-change broadcast", () => {
  it("asks every open markdown editor to restyle when the Note Index changes", async () => {
    const noteIndex = new NoteIndexStub();
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
      noteIndex,
      settings: new SettingsStub(),
    } as never);
    await service.ready;

    noteIndex.emit("changed");
    expect(requests).toBe(1);
    noteIndex.emit("rebuilt");
    expect(requests).toBe(2);
  });
});

class NoteIndexStub {
  readonly #notes: Record<string, { path: string }[]>;
  readonly #listeners: Record<"changed" | "rebuilt", Set<() => void>> = {
    changed: new Set(),
    rebuilt: new Set(),
  };

  constructor(notes: Record<string, { path: string }[]> = {}) {
    this.#notes = notes;
  }

  getNotesByCitationKey(citekey: string): { path: string }[] {
    return this.#notes[citekey] ?? [];
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
