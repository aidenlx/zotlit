import { stringifyYaml } from "obsidian";
import type { CachedMetadata } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { createObsidianHost } from "@/lib/__fixtures__/obsidian-host";
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

    // Shown as the selection it stands for, and out of reach as a choice: the
    // dialog writes a style Zotero owns or none at all.
    expect(options.at(-1)).toEqual({
      value: missing,
      label: m.settings_citation_references_style_missing({ id: missing }),
      disabled: true,
    });
  });
});

describe("the update a confirmed choice writes", () => {
  /** One note as text: its Properties block over an empty body. */
  function noteProperties(properties: Record<string, unknown>) {
    const host = createObsidianHost({
      "Draft.md": `---\n${stringifyYaml(properties)}---\n`,
    });
    const file = host.file("Draft.md");
    return {
      app: host.app,
      file,
      process: vi.spyOn(host.vault, "process"),
      /** The Properties the note carries now. */
      frontmatter: () => host.metadataCache.getFileCache(file)?.frontmatter,
    };
  }

  it("writes both properties in one pass over the note", async () => {
    const note = noteProperties({ title: "Draft" });

    await applyCitationPresentation(note.app, note.file, {
      styleId: NOTE_STYLE_ID,
      language: "de-DE",
    });

    expect(note.frontmatter()).toEqual({
      title: "Draft",
      "zotlit-csl": NOTE_STYLE_ID,
      lang: "de-DE",
    });
    expect(note.process).toHaveBeenCalledTimes(1);
  });

  it("removes both properties for an inherited style and a reset language", async () => {
    const note = noteProperties({
      title: "Draft",
      "zotlit-csl": NOTE_STYLE_ID,
      lang: "de-DE",
    });

    await applyCitationPresentation(note.app, note.file, {
      styleId: null,
      language: null,
    });

    expect(note.frontmatter()).toEqual({ title: "Draft" });
    expect(note.process).toHaveBeenCalledTimes(1);
  });
});
