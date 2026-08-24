// One note's own `lang`, as every Citation Presentation surface and the built-in export read it.
// Runs in the happy-dom-native-response vitest project (vitest.config.ts).

import { describe, expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import {
  EXPORT_NOTE,
  openCitationVault,
  TIMEOUT,
} from "./__fixtures__/citation-surfaces";

const VAULT_STYLE_ID = "http://www.zotero.org/styles/vault-localized";
const NOTE_STYLE_ID = "http://www.zotero.org/styles/note-numbered";

/** The term both styles render, per Citation Locale. */
const EDITOR = { "en-US": "editor", "de-DE": "Herausgeber" };

/** One word of the vault style's own, so a rendered line says which style wrote it. */
const VAULT_WORD = "vault";

/** The Entry Marker the numbering style stands for the one cited work. */
const MARKER = "[1]";

/**
 * The vault selection, which declares a default locale of its own: a note that
 * names no language and a vault that names no Citation Locale both leave this
 * style's own locale in charge.
 */
const VAULT_STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0" default-locale="de-DE">
  <info>
    <title>Vault localized</title>
    <id>${VAULT_STYLE_ID}</id>
    <updated>2020-01-01T00:00:00+00:00</updated>
  </info>
  <citation>
    <layout>
      <text term="editor" form="long"/>
      <text value="${VAULT_WORD}" prefix=" "/>
    </layout>
  </citation>
  <bibliography>
    <layout>
      <text term="editor" form="long"/>
      <text value="${VAULT_WORD}" prefix=" "/>
    </layout>
  </bibliography>
</style>`;

/**
 * A numbering style a note can name for itself: its citations are bracketed
 * Entry Markers, and its flush bibliography stands the same number beside a
 * localized term. It declares no default locale, so it renders in whichever
 * Citation Locale the document is under.
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
      <text term="editor" form="long" prefix=" "/>
    </layout>
  </bibliography>
</style>`;

const STYLES = {
  "vault-localized.csl": VAULT_STYLE,
  "note-numbered.csl": NOTE_STYLE,
};

/**
 * @param locale the vault Citation Locale; `null` leaves it at Style default.
 * @param documentStyle the `zotlit-csl` both notes carry.
 * @param documentLanguage the `lang` both notes carry.
 */
function openVault({
  locale = null,
  documentStyle,
  documentLanguage,
}: {
  locale?: string | null;
  documentStyle?: unknown;
  documentLanguage?: unknown;
} = {}) {
  return openCitationVault({
    styles: STYLES,
    settings: {
      "citation.references-style": VAULT_STYLE_ID,
      "citation.locale": locale,
    },
    documentStyle,
    documentLanguage,
  });
}

describe("Document Language", { timeout: TIMEOUT }, () => {
  it("leaves a note that declares none to the vault Citation Locale", async () => {
    await using vault = await openVault({ locale: "en-US" });

    await expect(vault.citationText()).resolves.toBe(
      `${EDITOR["en-US"]} ${VAULT_WORD}`,
    );
    await expect(vault.sidebarText()).resolves.toContain(EDITOR["en-US"]);
    await expect(vault.popoverText()).resolves.toContain(EDITOR["en-US"]);
    await expect(vault.copiedBibliography()).resolves.toContain(
      EDITOR["en-US"],
    );

    const exported = await vault.exportNote();
    expect(exported.html).toContain(EDITOR["en-US"]);
    // The vault locale controls citeproc without becoming a Document Language.
    expect(exported.html).not.toMatch(/<html[^>]*lang=/);
  });

  it("leaves a note under a vault at Style default to the style's own locale", async () => {
    await using vault = await openVault();

    await expect(vault.citationText()).resolves.toBe(
      `${EDITOR["de-DE"]} ${VAULT_WORD}`,
    );
    await expect(vault.sidebarText()).resolves.toContain(EDITOR["de-DE"]);
    await expect(vault.copiedBibliography()).resolves.toContain(
      EDITOR["de-DE"],
    );
    await expect(vault.exportNote()).resolves.toMatchObject({
      html: expect.stringContaining(EDITOR["de-DE"]),
    });
  });

  it("overrides the vault Citation Locale on every surface", async () => {
    await using vault = await openVault({
      locale: "en-US",
      documentLanguage: "de-DE",
    });

    await expect(vault.citationText()).resolves.toBe(
      `${EDITOR["de-DE"]} ${VAULT_WORD}`,
    );
    const sidebar = await vault.sidebarText();
    expect(sidebar).toContain(EDITOR["de-DE"]);
    expect(sidebar).not.toContain(EDITOR["en-US"]);
    await expect(vault.popoverText()).resolves.toContain(EDITOR["de-DE"]);
    await expect(vault.copiedBibliography()).resolves.toContain(
      EDITOR["de-DE"],
    );

    // Both effects of the same property: citeproc renders in that language, and
    // the writer carries it as the document's own.
    const exported = await vault.exportNote();
    expect(exported.html).toContain(EDITOR["de-DE"]);
    expect(exported.html).toMatch(/<html[^>]*lang="de-DE"/);
  });

  it("carries a note's own style and language together", async () => {
    await using vault = await openVault({
      locale: "en-US",
      documentStyle: NOTE_STYLE_ID,
      documentLanguage: "de-DE",
    });

    await expect(vault.citationText()).resolves.toBe(MARKER);
    const sidebar = await vault.sidebarText();
    expect(sidebar).toContain(MARKER);
    expect(sidebar).toContain(EDITOR["de-DE"]);
    expect(sidebar).not.toContain(VAULT_WORD);
    const copied = await vault.copiedBibliography();
    expect(copied).toContain(MARKER);
    expect(copied).toContain(EDITOR["de-DE"]);

    const exported = await vault.exportNote();
    expect(exported.openedOn).toBe(NOTE_STYLE_ID);
    expect(exported.html).toContain(MARKER);
    expect(exported.html).toContain(EDITOR["de-DE"]);
    expect(exported.html).toMatch(/<html[^>]*lang="de-DE"/);
    expect(vault.vaultStyleMissing()).toBe(null);
  });

  it.each([
    ["is written as a POSIX locale", "de_DE"],
    ["carries no language tag at all", ["de-DE"]],
  ])("stops the note where its language %s", async (_name, language) => {
    await using vault = await openVault({
      locale: "en-US",
      documentLanguage: language,
    });

    // Nothing formatted stands in for the citation, so every reading surface
    // keeps the source the author wrote.
    await expect(vault.citationText()).resolves.toBe(undefined);
    const sidebar = await vault.minimalSidebarText();
    expect(sidebar).toContain(m.references_document_language_failed_title());
    expect(sidebar).not.toContain(EDITOR["en-US"]);
    expect(sidebar).not.toContain(EDITOR["de-DE"]);
    expect(vault.copyOffered()).toBe(false);
    // The export stops with the note as well, rather than writing a document
    // the vault Citation Locale formatted.
    await expect(vault.exportNote()).resolves.toMatchObject({ html: null });
    // The vault selection is available, so nothing about it is at fault.
    expect(vault.vaultStyleMissing()).toBe(null);
  });

  it("moves every surface together when the note's language changes", async () => {
    await using vault = await openVault({ documentStyle: NOTE_STYLE_ID });
    await expect(vault.sidebarText()).resolves.toContain(EDITOR["en-US"]);
    // This popover stays open across the change, as a hovered one would.
    using popover = vault.showPopover();
    const shown = await popover.text();
    expect(shown).toContain(EDITOR["en-US"]);

    await vault.setNoteLanguage("de-DE");

    // Copy stays out of reach until the new language's render lands.
    expect(vault.copyOffered()).toBe(false);
    // The numbering style keeps its in-text number and its Entry Marker across
    // the change, so the one cited work still reads as 1 wherever it is shown.
    await expect(vault.citationText()).resolves.toBe(MARKER);
    const sidebar = await vault.sidebarText();
    expect(sidebar).toContain(MARKER);
    expect(sidebar).toContain(EDITOR["de-DE"]);
    await expect(popover.text(shown)).resolves.toContain(EDITOR["de-DE"]);
    await expect(vault.copiedBibliography()).resolves.toContain(
      EDITOR["de-DE"],
    );
  });

  it("moves every surface with the one update the action writes", async () => {
    await using vault = await openVault({ locale: "en-US" });
    await expect(vault.citationText()).resolves.toBe(
      `${EDITOR["en-US"]} ${VAULT_WORD}`,
    );

    // What a confirmed Set citation presentation dialog writes: the note's own
    // style and its own Document Language, in one property update.
    await vault.setPresentation({ styleId: NOTE_STYLE_ID, language: "de-DE" });

    await expect(vault.citationText()).resolves.toBe(MARKER);
    const sidebar = await vault.sidebarText();
    expect(sidebar).toContain(MARKER);
    expect(sidebar).toContain(EDITOR["de-DE"]);
    await expect(vault.copiedBibliography()).resolves.toContain(
      EDITOR["de-DE"],
    );
    const exported = await vault.exportNote();
    expect(exported.openedOn).toBe(NOTE_STYLE_ID);
    expect(exported.html).toContain(MARKER);
    expect(exported.html).toMatch(/<html[^>]*lang="de-DE"/);

    // Inheriting the style and resetting the language hands the note back to
    // both vault selections at once.
    await vault.setPresentation({ styleId: null, language: null });

    await expect(vault.citationText()).resolves.toBe(
      `${EDITOR["en-US"]} ${VAULT_WORD}`,
    );
    await expect(vault.sidebarText()).resolves.toContain(EDITOR["en-US"]);
    expect(vault.noteStyle(EXPORT_NOTE)).toBe(undefined);
  });
});
