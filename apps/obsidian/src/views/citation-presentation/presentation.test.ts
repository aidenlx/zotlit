import type { CachedMetadata, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { InstalledCslStyle } from "@/services/pandoc/styles";

import {
  applyCitationPresentation,
  declaredPresentation,
  STYLE_INHERITED,
  stylePickerOptions,
} from "./presentation";

const VAULT_STYLE_ID = "http://www.zotero.org/styles/vault-prose";
const NOTE_STYLE_ID = "http://www.zotero.org/styles/note-numbered";

const INSTALLED: InstalledCslStyle[] = [
  { id: VAULT_STYLE_ID, title: "Vault prose" },
  { id: NOTE_STYLE_ID, title: "Note numbered" },
];

function cacheOf(frontmatter: Record<string, unknown>): CachedMetadata {
  return { frontmatter } as CachedMetadata;
}

describe("what a note declares", () => {
  it("reads the style and the language the note carries", () => {
    expect(
      declaredPresentation(
        cacheOf({ "zotlit-csl": ` ${NOTE_STYLE_ID} `, lang: " de-DE " }),
      ),
    ).toEqual({ styleId: NOTE_STYLE_ID, language: "de-DE" });
  });

  it("inherits where the note carries neither property", () => {
    expect(declaredPresentation(cacheOf({}))).toEqual({
      styleId: null,
      language: "",
    });
    expect(declaredPresentation(null)).toEqual({ styleId: null, language: "" });
  });

  it("opens on the inherited value where a property holds no value it takes", () => {
    expect(
      declaredPresentation(cacheOf({ "zotlit-csl": [NOTE_STYLE_ID], lang: 7 })),
    ).toEqual({ styleId: null, language: "" });
  });
});

describe("the styles a note is offered", () => {
  it("names the vault style the note inherits", () => {
    const [inherited] = stylePickerOptions(INSTALLED, {
      selected: null,
      vaultStyleId: VAULT_STYLE_ID,
    });

    expect(inherited).toEqual({
      value: STYLE_INHERITED,
      label: m.citation_presentation_style_inherited({ style: "Vault prose" }),
    });
  });

  it("names the embedded default style where the vault selects none", () => {
    const [inherited] = stylePickerOptions(INSTALLED, {
      selected: null,
      vaultStyleId: null,
    });

    expect(inherited?.label).toBe(
      m.citation_presentation_style_inherited({
        style: m.settings_citation_references_style_default(),
      }),
    );
  });

  it("lists every installed style", () => {
    const options = stylePickerOptions(INSTALLED, {
      selected: NOTE_STYLE_ID,
      vaultStyleId: VAULT_STYLE_ID,
    });

    expect(options.slice(1)).toEqual([
      { value: VAULT_STYLE_ID, label: "Vault prose" },
      { value: NOTE_STYLE_ID, label: "Note numbered" },
    ]);
  });

  it("keeps a style Zotero no longer has, named as the missing one it is", () => {
    const missing = "http://www.zotero.org/styles/uninstalled";
    const options = stylePickerOptions(INSTALLED, {
      selected: missing,
      vaultStyleId: VAULT_STYLE_ID,
    });

    expect(options.at(-1)).toEqual({
      value: missing,
      label: m.settings_citation_references_style_missing({ id: missing }),
    });
  });
});

describe("the update a confirmed choice writes", () => {
  /** One note's properties, rewritten the way Obsidian rewrites them. */
  function noteProperties(frontmatter: Record<string, unknown>) {
    const processFrontMatter = vi.fn(
      (_file: TFile, edit: (fm: Record<string, unknown>) => void) => {
        edit(frontmatter);
        return Promise.resolve();
      },
    );
    return { frontmatter, fileManager: { processFrontMatter } };
  }

  it("writes both properties in one pass over the note", async () => {
    const note = noteProperties({ title: "Draft" });

    await applyCitationPresentation(note.fileManager, {} as TFile, {
      styleId: NOTE_STYLE_ID,
      language: "de-DE",
    });

    expect(note.frontmatter).toEqual({
      title: "Draft",
      "zotlit-csl": NOTE_STYLE_ID,
      lang: "de-DE",
    });
    expect(note.fileManager.processFrontMatter).toHaveBeenCalledTimes(1);
  });

  it("removes both properties for an inherited style and a reset language", async () => {
    const note = noteProperties({
      title: "Draft",
      "zotlit-csl": NOTE_STYLE_ID,
      lang: "de-DE",
    });

    await applyCitationPresentation(note.fileManager, {} as TFile, {
      styleId: null,
      language: null,
    });

    expect(note.frontmatter).toEqual({ title: "Draft" });
    expect(note.fileManager.processFrontMatter).toHaveBeenCalledTimes(1);
  });
});
