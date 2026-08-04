import { describe, expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import { referencesStyleOptions, STYLE_DEFAULT } from "./citations";

const APA = { id: "http://www.zotero.org/styles/apa", title: "APA" };
const NATURE = { id: "http://www.zotero.org/styles/nature", title: "Nature" };

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
