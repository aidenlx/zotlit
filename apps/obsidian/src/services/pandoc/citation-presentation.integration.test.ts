// @vitest-environment happy-dom
// One note's own `zotlit-csl`, as every Citation Presentation surface renders it.

import { describe, expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import {
  EXPORT_BODY,
  EXPORT_NOTE,
  openCitationVault,
  TIMEOUT,
} from "./__fixtures__/citation-surfaces";

const VAULT_STYLE_ID = "http://www.zotero.org/styles/vault-prose";
const NOTE_STYLE_ID = "http://www.zotero.org/styles/note-numbered";
/** A CSL ID no Zotero install here carries. */
const UNINSTALLED_STYLE_ID = "http://www.zotero.org/styles/uninstalled";

/** What each style writes, so one rendered word says which style formatted it. */
const VAULT_WORD = "prose";
const NOTE_WORD = "numbered";

/** The Entry Marker the numbering style stands for the one cited work. */
const MARKER = "[1]";

/** Neither citation nor entry carries a number, so no gutter belongs to it. */
const VAULT_STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info>
    <title>Vault prose</title>
    <id>${VAULT_STYLE_ID}</id>
    <updated>2020-01-01T00:00:00+00:00</updated>
  </info>
  <citation><layout><text value="${VAULT_WORD}"/></layout></citation>
  <bibliography><layout><text value="${VAULT_WORD}"/></layout></bibliography>
</style>`;

/**
 * A numbering style: its citations are bracketed Entry Markers, and its flush
 * bibliography stands the same number in the entry's left margin.
 */
const NOTE_STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info>
    <title>Note numbered</title>
    <id>${NOTE_STYLE_ID}</id>
    <updated>2020-01-01T00:00:00+00:00</updated>
  </info>
  <citation><layout prefix="[" suffix="]"><text variable="citation-number"/></layout></citation>
  <bibliography second-field-align="flush">
    <layout>
      <text variable="citation-number" prefix="[" suffix="]"/>
      <text value="${NOTE_WORD}" prefix=" "/>
    </layout>
  </bibliography>
</style>`;

const STYLES = {
  "vault-prose.csl": VAULT_STYLE,
  "note-numbered.csl": NOTE_STYLE,
};

/** @param documentStyle the `zotlit-csl` both notes carry; `undefined` writes none. */
function openVault(documentStyle: unknown) {
  return openCitationVault({
    styles: STYLES,
    settings: { "citation.references-style": VAULT_STYLE_ID },
    documentStyle,
  });
}

describe("document Citation Presentation", { timeout: TIMEOUT }, () => {
  it("inherits the vault style where the note names none", async () => {
    await using vault = await openVault(undefined);

    await expect(vault.citationText()).resolves.toBe(VAULT_WORD);
    await expect(vault.sidebarText()).resolves.toContain(VAULT_WORD);
    await expect(vault.popoverText()).resolves.toContain(VAULT_WORD);
    await expect(vault.copiedBibliography()).resolves.toContain(VAULT_WORD);

    const exported = await vault.exportNote();
    expect(exported.openedOn).toBe(VAULT_STYLE_ID);
    expect(exported.html).toContain(VAULT_WORD);
  });

  it("formats every surface in the style the note names", async () => {
    await using vault = await openVault(NOTE_STYLE_ID);

    // The citation is the style's own Entry Marker, and every surface that
    // stands a gutter beside an entry stands the same number in it, so the one
    // cited work reads as 1 wherever it is shown.
    await expect(vault.citationText()).resolves.toBe(MARKER);
    const sidebar = await vault.sidebarText();
    expect(sidebar).toContain(MARKER);
    expect(sidebar).toContain(NOTE_WORD);
    expect(sidebar).not.toContain(VAULT_WORD);
    const popover = await vault.popoverText();
    expect(popover).toContain(MARKER);
    expect(popover).toContain(NOTE_WORD);
    const copied = await vault.copiedBibliography();
    expect(copied).toContain(MARKER);
    expect(copied).toContain(NOTE_WORD);

    const exported = await vault.exportNote();
    expect(exported.openedOn).toBe(NOTE_STYLE_ID);
    expect(exported.html).toContain(MARKER);
    expect(exported.html).toContain(NOTE_WORD);
    expect(vault.vaultStyleMissing()).toBe(null);
  });

  it("keeps a per-run export style off the note", async () => {
    await using vault = await openVault(NOTE_STYLE_ID);

    const exported = await vault.exportNote({ styleId: VAULT_STYLE_ID });
    expect(exported.openedOn).toBe(NOTE_STYLE_ID);
    expect(exported.html).toContain(VAULT_WORD);
    expect(vault.noteStyle(EXPORT_NOTE)).toBe(NOTE_STYLE_ID);
    expect(vault.noteBody(EXPORT_NOTE)).toBe(EXPORT_BODY);
    // The note itself never moved, so its own surfaces still read as they did.
    await expect(vault.citationText()).resolves.toBe(MARKER);
  });

  it.each([
    ["names a style Zotero does not have", UNINSTALLED_STYLE_ID],
    ["carries no style ID at all", [NOTE_STYLE_ID]],
  ])("stops the note where it %s", async (_name, declared) => {
    await using vault = await openVault(declared);

    // Nothing formatted stands in for the citation, so every reading surface
    // keeps the source the author wrote.
    await expect(vault.citationText()).resolves.toBe(undefined);
    const sidebar = await vault.minimalSidebarText();
    expect(sidebar).toContain(m.references_document_style_failed_title());
    expect(sidebar).not.toContain(VAULT_WORD);
    expect(sidebar).not.toContain(NOTE_WORD);
    expect(vault.copyOffered()).toBe(false);
    // The export stops with the note as well, rather than writing a document
    // the vault selection or the embedded default style formatted.
    await expect(vault.exportNote()).resolves.toMatchObject({ html: null });
    // The vault selection is available, so nothing about it is at fault.
    expect(vault.vaultStyleMissing()).toBe(null);
  });

  it("stops a note whose style is unavailable and whose works are not", async () => {
    // Zotero holds no Item the citation resolves to, so the sidebar formats an
    // empty bibliography — which the note's own unusable style still stops.
    await using vault = await openCitationVault({
      styles: STYLES,
      settings: { "citation.references-style": VAULT_STYLE_ID },
      documentStyle: UNINSTALLED_STYLE_ID,
      zoteroHoldsWork: false,
    });

    const sidebar = await vault.minimalSidebarText();
    expect(sidebar).toContain(m.references_document_style_failed_title());
    expect(vault.copyOffered()).toBe(false);
    expect(vault.vaultStyleMissing()).toBe(null);
  });

  it("moves every surface together when the note's style changes", async () => {
    await using vault = await openVault(undefined);
    await expect(vault.sidebarText()).resolves.toContain(VAULT_WORD);
    // This popover stays open across the change, as a hovered one would.
    using popover = vault.showPopover();
    const shown = await popover.text();
    expect(shown).toContain(VAULT_WORD);

    await vault.setNoteStyle(NOTE_STYLE_ID);

    // Copy stays out of reach until the new style's render lands.
    expect(vault.copyOffered()).toBe(false);
    await expect(vault.citationText()).resolves.toBe(MARKER);
    await expect(vault.sidebarText()).resolves.toContain(NOTE_WORD);
    await expect(popover.text(shown)).resolves.toContain(NOTE_WORD);
    await expect(vault.copiedBibliography()).resolves.toContain(NOTE_WORD);
  });
});
