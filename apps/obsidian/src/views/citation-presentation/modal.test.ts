import {
  ButtonComponent,
  DropdownComponent,
  Modal,
  settingsOf,
  TextComponent,
} from "@mock/obsidian";
import type { App } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { InstalledCslStyle } from "@/services/pandoc/styles";

import { openCitationPresentationModal } from "./modal";
import type { CitationPresentationModalOptions } from "./modal";
import type { CitationPresentationChoice } from "./presentation";

/** The styles Zotero has installed while one dialog is open. */
const zotero = vi.hoisted(() => ({ styles: [] as InstalledCslStyle[] }));

vi.mock("@/services/pandoc/styles", () => ({
  listInstalledStyles: () => Promise.resolve(zotero.styles),
}));

const APA = { id: "http://www.zotero.org/styles/apa", title: "APA 7th" };
const IEEE = { id: "http://www.zotero.org/styles/ieee", title: "IEEE" };
const UNINSTALLED = "http://www.zotero.org/styles/gone";

/** One dialog on screen, read and driven the way the user reads and drives it. */
async function openDialog(options: Partial<CitationPresentationModalOptions>) {
  const choice = openCitationPresentationModal({} as App, {
    dataDir: "/zotero",
    vaultStyleId: null,
    vaultLocale: "",
    declared: { styleId: null, language: "" },
    ...options,
  });

  const modal = Modal.instances.at(-1)!;
  const rows = settingsOf(modal.contentEl);
  const style = componentOf(rows, DropdownComponent);
  // The listing is read after the dialog is built, so the entries the user
  // reads are the ones the resolved listing left in the picker.
  await vi.waitFor(() => expect(style.options.length).toBeGreaterThan(0));

  return {
    choice,
    style,
    language: componentOf(rows, TextComponent),
    isOpen: () => modal.isOpen,
    /** Dismiss the dialog without answering, as closing its window does. */
    dismiss: () => modal.close(),
    /** One button of the dialog, by the label the user reads on it. */
    button: (text: string) => {
      const button = rows
        .flatMap((row) => row.components)
        .find(
          (component) =>
            component instanceof ButtonComponent && component.text === text,
        );
      if (!button) throw new Error(`the dialog offers no "${text}" button`);
      return button as ButtonComponent;
    },
  };
}

/** The one component of its kind the dialog was built with. */
function componentOf<T>(
  rows: readonly { components: readonly unknown[] }[],
  kind: new (...args: never) => T,
): T {
  const found = rows
    .flatMap((row) => row.components)
    .filter((component): component is T => component instanceof kind);
  if (found.length !== 1) {
    throw new Error(`the dialog holds ${found.length} ${kind.name} components`);
  }
  return found[0]!;
}

/** The choice the dialog answered with, or `"pending"` while it has not. */
function settled(
  choice: Promise<CitationPresentationChoice | null>,
): Promise<CitationPresentationChoice | null | "pending"> {
  return Promise.race([
    choice,
    Promise.resolve().then((): "pending" => "pending"),
  ]);
}

beforeEach(() => {
  Modal.instances.length = 0;
  zotero.styles = [APA, IEEE];
});

describe("the Citation presentation dialog", () => {
  it("lists the styles Zotero has installed, under the vault style", async () => {
    const dialog = await openDialog({ vaultStyleId: IEEE.id });

    expect(dialog.style.options).toEqual([
      {
        value: "",
        label: m.citation_presentation_style_inherited({ style: "IEEE" }),
      },
      { value: APA.id, label: "APA 7th" },
      { value: IEEE.id, label: "IEEE" },
    ]);
  });

  it("opens on the style the note names", async () => {
    const dialog = await openDialog({
      declared: { styleId: APA.id, language: "" },
      vaultStyleId: IEEE.id,
    });

    expect(dialog.style.getValue()).toBe(APA.id);
  });

  it("opens on the inherited style for a note that names none", async () => {
    const dialog = await openDialog({ vaultStyleId: IEEE.id });

    expect(dialog.style.getValue()).toBe("");
  });

  it("keeps a named style Zotero no longer has, marked as missing", async () => {
    const dialog = await openDialog({
      declared: { styleId: UNINSTALLED, language: "" },
    });

    expect(dialog.style.getValue()).toBe(UNINSTALLED);
    expect(dialog.style.options.at(-1)).toEqual({
      value: UNINSTALLED,
      label: m.settings_citation_references_style_missing({ id: UNINSTALLED }),
      disabled: true,
    });
  });

  it("refuses a style Zotero does not have as a selection of its own", async () => {
    const dialog = await openDialog({
      declared: { styleId: UNINSTALLED, language: "" },
    });

    dialog.style.choose(APA.id);
    dialog.style.choose(UNINSTALLED);
    dialog.button(m.citation_presentation_confirm()).click();

    await expect(dialog.choice).resolves.toEqual({
      styleId: APA.id,
      language: null,
    });
  });

  it("shows the Document language the note declares", async () => {
    const dialog = await openDialog({
      declared: { styleId: null, language: "de-DE" },
      vaultLocale: "en-GB",
    });

    expect(dialog.language.getValue()).toBe("de-DE");
    expect(dialog.language.inputEl.placeholder).toBe("en-GB");
  });

  it("falls back to the style's own locale where neither note nor vault names one", async () => {
    const dialog = await openDialog({ vaultLocale: "" });

    expect(dialog.language.getValue()).toBe("");
    expect(dialog.language.inputEl.placeholder).toBe(
      m.settings_citation_locale_default(),
    );
  });

  it("empties the language field from its reset", async () => {
    const dialog = await openDialog({
      declared: { styleId: null, language: "de-DE" },
    });
    // The reset says what emptying the field does, so the copy is part of it.
    const reset = dialog.button(
      "Use vault citation locale and remove document language",
    );

    reset.click();

    expect(dialog.language.getValue()).toBe("");
  });

  it("answers with the style and language the user chose", async () => {
    const dialog = await openDialog({});

    dialog.style.choose(APA.id);
    dialog.language.type(" de-DE ");
    dialog.button(m.citation_presentation_confirm()).click();

    await expect(dialog.choice).resolves.toEqual({
      styleId: APA.id,
      language: "de-DE",
    });
    expect(dialog.isOpen()).toBe(false);
  });

  it("answers with the removals an inherited style and an empty language ask for", async () => {
    const dialog = await openDialog({
      declared: { styleId: APA.id, language: "de-DE" },
    });

    dialog.style.choose("");
    dialog.language.type("");
    dialog.button(m.citation_presentation_confirm()).click();

    await expect(dialog.choice).resolves.toEqual({
      styleId: null,
      language: null,
    });
  });

  it("holds a language the citation processor cannot read at its field", async () => {
    const dialog = await openDialog({});

    dialog.language.type("not a language");
    dialog.button(m.citation_presentation_confirm()).click();

    expect(dialog.language.inputEl.validationMessage).toBe(
      m.settings_citation_locale_invalid(),
    );
    expect(dialog.isOpen()).toBe(true);
    await expect(settled(dialog.choice)).resolves.toBe("pending");

    dialog.language.type("de-DE");
    dialog.button(m.citation_presentation_confirm()).click();

    await expect(dialog.choice).resolves.toEqual({
      styleId: null,
      language: "de-DE",
    });
  });

  it("answers with nothing where the user cancelled", async () => {
    const dialog = await openDialog({
      declared: { styleId: APA.id, language: "de-DE" },
    });

    dialog.style.choose(IEEE.id);
    dialog.button(m.modal_cancel()).click();

    await expect(dialog.choice).resolves.toBeNull();
  });

  it("answers with nothing where the user dismissed the dialog", async () => {
    const dialog = await openDialog({});

    dialog.dismiss();

    await expect(dialog.choice).resolves.toBeNull();
  });
});
