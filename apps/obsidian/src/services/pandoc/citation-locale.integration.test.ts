// @vitest-environment happy-dom
// One vault Citation Locale, as every Citation Presentation surface renders it.

import { describe, expect, it } from "vitest";

import { openCitationVault, TIMEOUT } from "./__fixtures__/citation-surfaces";

const STYLE_ID = "http://www.zotero.org/styles/localized";

/**
 * Both layouts render one localized term and nothing else, so an in-text
 * citation and a bibliography entry each say which locale formatted it.
 */
const STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info>
    <title>Localized</title>
    <id>${STYLE_ID}</id>
    <updated>2020-01-01T00:00:00+00:00</updated>
  </info>
  <citation><layout><text term="editor" form="long"/></layout></citation>
  <bibliography><layout><text term="editor" form="long"/></layout></bibliography>
</style>`;

/** The term the style renders, per Citation Locale. */
const EDITOR = { en: "editor", "de-DE": "Herausgeber" };

/** @param locale the vault Citation Locale; `null` leaves it at Style default. */
function openVault(locale: string | null) {
  return openCitationVault({
    styles: { "localized.csl": STYLE },
    settings: {
      "citation.references-style": STYLE_ID,
      "citation.locale": locale,
    },
  });
}

describe("vault Citation Locale", { timeout: TIMEOUT }, () => {
  it("formats every in-app surface and the built-in export in it", async () => {
    await using vault = await openVault("de-DE");

    await expect(vault.citationText()).resolves.toBe(EDITOR["de-DE"]);
    await expect(vault.sidebarText()).resolves.toContain(EDITOR["de-DE"]);
    await expect(vault.popoverText()).resolves.toContain(EDITOR["de-DE"]);
    await expect(vault.copiedBibliography()).resolves.toContain(
      EDITOR["de-DE"],
    );

    const exported = await vault.exportNote();
    expect(exported.html).toContain(EDITOR["de-DE"]);
    // The locale controls citeproc without becoming the document's language.
    expect(exported.html).not.toMatch(/<html[^>]*lang=/);
  });

  it("leaves Style default to the selected style", async () => {
    await using vault = await openVault(null);

    await expect(vault.citationText()).resolves.toBe(EDITOR.en);
    await expect(vault.sidebarText()).resolves.toContain(EDITOR.en);
    await expect(vault.popoverText()).resolves.toContain(EDITOR.en);
    await expect(vault.copiedBibliography()).resolves.toContain(EDITOR.en);
    const exported = await vault.exportNote();
    expect(exported.html).toContain(EDITOR.en);
  });

  it("moves every surface together when the setting changes", async () => {
    await using vault = await openVault(null);
    await expect(vault.sidebarText()).resolves.toContain(EDITOR.en);
    // This popover stays open across the change, as a hovered one would.
    using popover = vault.showPopover();
    const shown = await popover.text();
    expect(shown).toContain(EDITOR.en);

    await vault.setSettings({ "citation.locale": "de-DE" });

    // Copy stays out of reach until the new locale's render lands.
    expect(vault.copyOffered()).toBe(false);
    await expect(vault.citationText()).resolves.toBe(EDITOR["de-DE"]);
    await expect(vault.sidebarText()).resolves.toContain(EDITOR["de-DE"]);
    await expect(popover.text(shown)).resolves.toContain(EDITOR["de-DE"]);
    await expect(vault.copiedBibliography()).resolves.toContain(
      EDITOR["de-DE"],
    );
    const exported = await vault.exportNote();
    expect(exported.html).toContain(EDITOR["de-DE"]);
  });
});
