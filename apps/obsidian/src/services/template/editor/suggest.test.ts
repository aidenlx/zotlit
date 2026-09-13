import { TFile } from "obsidian";
import type { App, Editor } from "obsidian";
import { describe, expect, it } from "vitest";

import { EtaSuggest } from "./suggest";

function makeFile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  return file;
}

const editorStub = { getLine: () => "<%" } as unknown as Editor;
const cursor = { line: 0, ch: 2 };

describe("EtaSuggest.onTrigger", () => {
  it("triggers for an .eta.md template path", () => {
    const suggest = new EtaSuggest({} as unknown as App);
    const file = makeFile("templates/zotlit-note.eta.md");

    expect(suggest.onTrigger(cursor, editorStub, file)).not.toBeNull();
  });

  it("does not trigger for a .liquid.md template path", () => {
    const suggest = new EtaSuggest({} as unknown as App);
    const file = makeFile("templates/zotlit-note.liquid.md");

    expect(suggest.onTrigger(cursor, editorStub, file)).toBeNull();
  });

  it("does not trigger for a non-template path", () => {
    const suggest = new EtaSuggest({} as unknown as App);
    const file = makeFile("note.md");

    expect(suggest.onTrigger(cursor, editorStub, file)).toBeNull();
  });

  it("does not trigger when there is no file", () => {
    const suggest = new EtaSuggest({} as unknown as App);

    expect(suggest.onTrigger(cursor, editorStub, null)).toBeNull();
  });
});
