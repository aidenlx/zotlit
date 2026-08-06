import { type Extension } from "@codemirror/state";
import { describe, expect, it } from "vitest";

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
      },
      settings,
    } as never);
    service.on("missing-property", (property) => notices.push(property));
    await service.ready;

    expect(registered).toEqual([]);
    settings.update({ "citation.citekey-editor": true });
    expect(registered).toHaveLength(1);
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
      },
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
