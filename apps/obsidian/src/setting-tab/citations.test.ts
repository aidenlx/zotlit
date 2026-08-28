// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";

import {
  citationLocaleError,
  citationsPageItems,
  referencesStyleDescription,
  referencesStyleOptions,
  STYLE_DEFAULT,
} from "./citations";
import type { SettingTabContext } from "./context";

const APA = { id: "http://www.zotero.org/styles/apa", title: "APA" };
const NATURE = { id: "http://www.zotero.org/styles/nature", title: "Nature" };

beforeAll(() => {
  globalThis.createEl = ((tag: string) =>
    document.createElement(tag)) as typeof createEl;
});

describe("citation source settings", () => {
  it("shows independent Pandoc and wikilink controls with the approved copy", () => {
    const ctx = {
      settings: { current: defaults },
      pandocEngine: { getStatus: () => ({ kind: "absent" }) },
      plugin: { manifest: { version: "test" } },
    } as unknown as SettingTabContext;
    const group = citationsPageItems(ctx).find(
      (item) =>
        "type" in item &&
        item.type === "group" &&
        item.heading === m.settings_citation_sources_heading(),
    );

    expect(group).toMatchObject({
      type: "group",
      heading: "Citation sources",
      items: [
        {
          name: "Pandoc citations",
          desc: "Include Pandoc citations such as `@doe2024` in the references sidebar and ZotLit’s in-text features. This setting does not change citation insertion or export.",
          control: { type: "toggle", key: "citation.pandoc-citations" },
        },
        {
          name: "Wikilink citations",
          desc: "Include unaliased links to literature notes in the references sidebar and ZotLit’s in-text features. Heading links, block links, and invalid citation fragments stay as links. This setting does not change export.",
          control: { type: "toggle", key: "citation.wikilink-citations" },
        },
      ],
    });
    if (!group || !("type" in group) || group.type !== "group") {
      throw new Error("source group missing");
    }
    expect(group.items?.every((item) => !("visible" in item))).toBe(true);
  });
});

describe("in-text citation settings", () => {
  it("shows independent presentation and Pandoc navigation controls", () => {
    const ctx = {
      settings: { current: defaults },
      pandocEngine: { getStatus: () => ({ kind: "absent" }) },
      plugin: { manifest: { version: "test" } },
    } as unknown as SettingTabContext;
    const group = citationsPageItems(ctx).find(
      (item) =>
        "type" in item &&
        item.type === "group" &&
        item.heading === "In-text citations",
    );

    if (!group || !("items" in group) || !group.items) {
      throw new Error("in-text citation group missing");
    }
    expect(group.items[0]).toMatchObject({
      name: "Show formatted citations",
      desc: "Show citations in Live Preview and reading view with the selected citation and references style. Source mode always shows Markdown. Citations stay unchanged when ZotLit cannot format them.",
      control: { type: "toggle", key: "citation.show-formatted" },
    });
    expect(group.items[1]).toMatchObject({
      name: "Open citations as links",
      desc: "Open literature notes when you select a Pandoc citation or a literature note wikilink shown as a citation. When off, selecting a citation places the cursor in the citation text so you can edit it.",
      control: { type: "toggle", key: "citation.open-as-links" },
    });
    expect(group.items).not.toContainEqual(
      expect.objectContaining({
        control: expect.objectContaining({
          key: "citation.wikilink-display",
        }),
      }),
    );
    expect(defaults["citation.show-formatted"]).toBe(true);
    expect(Object.entries(defaults)).toContainEqual([
      "citation.open-as-links",
      false,
    ]);
  });
});

describe("hover settings", () => {
  const hoverGroup = (settings: Settings) => {
    const ctx = {
      settings: { current: settings },
      pandocEngine: { getStatus: () => ({ kind: "absent" }) },
      plugin: { manifest: { version: "test" } },
    } as unknown as SettingTabContext;
    const items = citationsPageItems(ctx);
    const group = items.find(
      (item) =>
        "type" in item && item.type === "group" && item.heading === "Hover",
    );
    if (!group || !("items" in group) || !group.items) {
      throw new Error("hover group missing");
    }
    return { items, rows: group.items };
  };

  it("follows In-text citations with the approved action and Require Mod page", () => {
    const { items, rows } = hoverGroup(defaults);

    expect(
      items.findIndex((item) => "heading" in item && item.heading === "Hover"),
    ).toBe(
      items.findIndex(
        (item) => "heading" in item && item.heading === "In-text citations",
      ) + 1,
    );
    expect(rows[0]).toMatchObject({
      name: "Hover action",
      desc: "What hovering a citation or literature note link shows. Page preview follows the Page preview plugin settings.",
      control: {
        type: "dropdown",
        key: "citation.hover-action",
        options: {
          off: "Off",
          popover: "Citation popover",
          "page-preview": "Page preview",
        },
      },
    });
    expect(rows.slice(1)).toMatchObject([
      {
        type: "page",
        name: "Require modifier key",
        desc: "Show the popover only while holding Ctrl (Windows) or Command (macOS).",
        items: [
          {
            name: "Source mode",
            control: {
              type: "toggle",
              key: "citation.hover-require-mod-source",
            },
          },
          {
            name: "Live Preview",
            control: {
              type: "toggle",
              key: "citation.hover-require-mod-live-preview",
            },
          },
          {
            name: "Reading view",
            control: {
              type: "toggle",
              key: "citation.hover-require-mod-reading",
            },
          },
        ],
      },
    ]);
  });

  it("ships the locked defaults", () => {
    expect(defaults["citation.hover-action"]).toBe("popover");
    expect(defaults["citation.hover-require-mod-source"]).toBe(true);
    expect(defaults["citation.hover-require-mod-live-preview"]).toBe(false);
    expect(defaults["citation.hover-require-mod-reading"]).toBe(false);
  });

  it("shows the Require Mod page under the Citation popover alone", () => {
    for (const action of ["popover", "off", "page-preview"] as const) {
      const { rows } = hoverGroup({
        ...defaults,
        "citation.hover-action": action,
      });
      const page = rows[1];
      const predicate = page && "visible" in page ? page.visible : undefined;
      const visible = typeof predicate === "function" ? predicate() : predicate;
      expect(visible).toBe(action === "popover");
    }
  });
});

describe("referencesStyleOptions", () => {
  it("offers the embedded default ahead of the installed styles", () => {
    expect(referencesStyleOptions([APA, NATURE], STYLE_DEFAULT)).toEqual([
      {
        value: STYLE_DEFAULT,
        label: m.settings_citation_references_style_default(),
      },
      { value: APA.id, label: APA.title },
      { value: NATURE.id, label: NATURE.title },
    ]);
  });

  it("lists an installed selection once", () => {
    expect(referencesStyleOptions([APA], APA.id)).toEqual([
      {
        value: STYLE_DEFAULT,
        label: m.settings_citation_references_style_default(),
      },
      { value: APA.id, label: APA.title },
    ]);
  });

  it("keeps a selection Zotero no longer has", () => {
    const removed = "http://www.zotero.org/styles/removed";

    expect(referencesStyleOptions([APA], removed)).toEqual([
      {
        value: STYLE_DEFAULT,
        label: m.settings_citation_references_style_default(),
      },
      { value: APA.id, label: APA.title },
      {
        value: removed,
        label: m.settings_citation_references_style_missing({ id: removed }),
      },
    ]);
  });

  it("offers only the default when Zotero installed no styles", () => {
    expect(referencesStyleOptions([], STYLE_DEFAULT)).toEqual([
      {
        value: STYLE_DEFAULT,
        label: m.settings_citation_references_style_default(),
      },
    ]);
  });
});

describe("citation formatting settings", () => {
  it("groups locale and engine controls under Formatting", () => {
    const ctx = {
      settings: { current: defaults },
      pandocEngine: { getStatus: () => ({ kind: "absent" }) },
      plugin: { manifest: { version: "test" } },
    } as unknown as SettingTabContext;
    const group = citationsPageItems(ctx).find(
      (item) =>
        "type" in item &&
        item.type === "group" &&
        item.heading === "Formatting",
    );

    if (!group || !("items" in group) || !group.items) {
      throw new Error("formatting group missing");
    }
    expect(referencesStyleDescription(false).textContent).toBe(
      "CSL style used to format in-text citations and the references sidebar. Install and manage styles in Zotero.",
    );
    expect(group.items[0]).toMatchObject({
      name: "Citation locale",
      desc: "Sets the language for citation terms, dates, names, and sorting. Leave empty to use the language the selected style declares.",
      control: {
        type: "text",
        key: "citation.locale",
        defaultValue: "",
        placeholder: "Style default",
      },
    });
    expect(defaults["citation.locale"]).toBeNull();
    expect(group.items[1]).toMatchObject({
      name: "Pandoc engine",
      desc: expect.stringMatching(
        /^Formats in-text citations, references, and exports\. Installation applies to every vault on this device\./,
      ),
    });
  });

  it("shows the approved recovery message for an unavailable selection", () => {
    expect(referencesStyleDescription(true).textContent).toBe(
      "This style isn’t installed in Zotero. Install it in Zotero or select another style.",
    );
  });
});

describe("citationLocaleError", () => {
  it("accepts the locale forms Pandoc and CSL read", () => {
    for (const locale of [
      "",
      "de",
      "en-US",
      "pt-BR",
      "zh-Hans-CN",
      "es-419",
      // Pandoc sorts a bibliography by the collation this extension names.
      "de-u-co-phonebk",
      // The extended language, private-use, and irregular tags BCP 47 keeps.
      "zh-cmn-Hans-CN",
      "x-pmr",
      "i-klingon",
      "en-GB-oed",
      // Case carries no meaning in a language tag, irregular ones included.
      "I-KLINGON",
      "SGN-BE-FR",
      "DE-de",
    ]) {
      expect(citationLocaleError(locale)).toBeUndefined();
    }
  });

  it("names the form an unreadable locale should take", () => {
    for (const locale of [
      "en_US",
      "en US",
      " de-DE",
      "1234",
      "de-",
      "de--DE",
      "abcdefghi",
      // A tag writes each variant and each extension once.
      "de-1901-1901",
      "en-u-ca-gregory-u-nu-latn",
    ]) {
      expect(citationLocaleError(locale)).toBe(
        "Enter a language code such as en-US, de, or zh-CN.",
      );
    }
  });
});
