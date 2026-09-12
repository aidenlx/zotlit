// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";

import { referencesStyleOptions, STYLE_DEFAULT } from "@/lib/citation-style";
import * as m from "@/lib/i18n/generated/messages";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";

import {
  citationLocaleError,
  citationsPageItems,
  referencesStyleDescription,
} from "./citations";
import type { SettingTabContext } from "./context";

const APA = { id: "http://www.zotero.org/styles/apa", title: "APA" };
const NATURE = { id: "http://www.zotero.org/styles/nature", title: "Nature" };

beforeAll(() => {
  globalThis.createEl = ((tag: string) =>
    document.createElement(tag)) as typeof createEl;
});

describe("hover settings", () => {
  /** The Hover group's rows for a given saved hover action. */
  const hoverRows = (settings: Settings) => {
    const ctx = {
      app: { internalPlugins: { getEnabledPluginById: () => null } },
      settings: { current: settings },
      pandocEngine: { getStatus: () => ({ kind: "absent" }) },
      manifest: { version: "test" },
      template: { loaded: false },
    } as unknown as SettingTabContext;
    const group = citationsPageItems(ctx).find(
      (item) =>
        "type" in item &&
        item.type === "group" &&
        item.heading === m.settings_citation_hover_heading(),
    );
    if (!group || !("items" in group) || !group.items)
      throw new Error("hover group missing");
    return group.items;
  };

  it("shows the Require Mod page under the Citation popover alone", () => {
    for (const action of ["popover", "off", "page-preview"] as const) {
      const page = hoverRows({
        ...defaults,
        "citation.hover-action": action,
      })[1];
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

describe("referencesStyleDescription", () => {
  it("names the recovery step only when Zotero lacks the selection", () => {
    expect(referencesStyleDescription(false).textContent).toBe(
      m.settings_citation_references_style_desc(),
    );
    expect(referencesStyleDescription(true).textContent).toBe(
      m.settings_citation_references_style_warning(),
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
        m.settings_citation_locale_invalid(),
      );
    }
  });
});

describe("graph citations setting", () => {
  /** The Graph view group's one row for a given core-plugin state. */
  const graphRow = (graphEnabled: boolean) => {
    const ctx = {
      app: {
        internalPlugins: {
          getEnabledPluginById: (id: string) =>
            id === "graph" && graphEnabled ? {} : null,
        },
      },
      settings: { current: defaults },
      pandocEngine: { getStatus: () => ({ kind: "absent" }) },
      manifest: { version: "test" },
      template: { loaded: false },
    } as unknown as SettingTabContext;
    const group = citationsPageItems(ctx).find(
      (item) =>
        "type" in item &&
        item.type === "group" &&
        item.heading === m.settings_citation_graph_heading(),
    );
    const row = group && "items" in group ? group.items?.[0] : undefined;
    if (!row || "type" in row) throw new Error("graph row missing");
    return row;
  };

  it("binds the toggle to the vault-wide switch, on by default", () => {
    const row = graphRow(true);

    expect(row.desc).toBe(m.settings_citation_graph_desc());
  });

  it("names the Graph view core plugin while it is disabled", () => {
    expect(graphRow(false).desc).toBe(
      m.settings_citation_graph_desc_disabled(),
    );
  });
});
