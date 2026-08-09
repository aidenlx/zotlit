// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import { defaults } from "@/services/settings/schema";

import {
  citationsPageItems,
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
