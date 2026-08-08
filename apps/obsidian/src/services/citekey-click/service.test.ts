import type { Editor, EventRef } from "obsidian";
import { describe, expect, it } from "vitest";

import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";

import { CitekeyClick, findCitekeyToken } from "./service";

const editor = {
  getLine: () => "See [@doe2024].",
} as unknown as Editor;

describe("findCitekeyToken", () => {
  it("links directly when exactly one Literature Note has the citation key", () => {
    const token = findCitekeyToken(editor, { line: 0, ch: 8 }, {
      getNotesByCitationKey: () => [{ path: "Literature/Doe.md" }],
    } as never);

    expect(token).toMatchObject({
      type: "internal-link",
      text: "Literature/Doe.md",
      start: { line: 0, ch: 5 },
      end: { line: 0, ch: 13 },
    });
  });

  it("defers an ambiguous citation key to Zotero resolution", () => {
    const token = findCitekeyToken(editor, { line: 0, ch: 8 }, {
      getNotesByCitationKey: () => [
        { path: "Literature/One.md" },
        { path: "Literature/Two.md" },
      ],
    } as never);

    expect(token).toMatchObject({ text: "doe2024", citekey: "zotero" });
  });

  it("defers an index miss to Zotero resolution", () => {
    const token = findCitekeyToken(editor, { line: 0, ch: 8 }, {
      getNotesByCitationKey: () => [],
    } as never);

    expect(token).toMatchObject({ text: "doe2024", citekey: "zotero" });
  });
});

describe("CitekeyClick settings lifecycle", () => {
  it("installs only while enabled and notices each transition into enabled plus missing", async () => {
    const settings = new SettingsStub({
      "note.frontmatter-fields": defaults["note.frontmatter-fields"].filter(
        (field) => field.key !== "citekey",
      ),
    });
    const notices: string[] = [];
    let installs = 0;
    let uninstalls = 0;
    const workspace = {
      on: () => ({ e: workspace }) as unknown as EventRef,
      offref: () => {},
      onLayoutReady: (callback: () => void) => callback(),
    };
    const service = new CitekeyClick({
      app: { workspace },
      settings,
      install: async () => {
        installs++;
        return () => {
          uninstalls++;
        };
      },
    } as never);
    service.on("missing-property", (property) => notices.push(property));
    await service.ready;

    expect(installs).toBe(0);
    settings.update({ "citation.key-links": true });
    await Promise.resolve();
    expect(installs).toBe(1);
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

    settings.update({ "citation.key-links": false });
    expect(uninstalls).toBe(1);
    settings.update({ "citation.key-links": true });
    await Promise.resolve();
    expect(installs).toBe(2);
    expect(notices).toHaveLength(4);

    await service[Symbol.asyncDispose]();
    expect(uninstalls).toBe(2);
  });
});

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
