// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import { defaults } from "@/services/settings/schema";

import {
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
      name: "Open Pandoc citations as links",
      desc: "Open and preview literature notes from Pandoc citations. This setting does not change how citations are shown.",
      control: { type: "toggle", key: "citation.open-pandoc-links" },
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
      "citation.open-pandoc-links",
      true,
    ]);
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
  it("groups the approved style and engine controls under Formatting", () => {
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
    expect(group.items[0]).toMatchObject({
      name: "Citation and references style",
    });
    expect(referencesStyleDescription(false).textContent).toBe(
      "CSL style used to format in-text citations and the references sidebar. Install and manage styles in Zotero.",
    );
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
