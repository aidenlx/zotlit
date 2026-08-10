// @vitest-environment happy-dom

import type { SettingDefinitionGroup } from "obsidian";
import { describe, expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import type { SettingsKey, SettingTabContext } from "./context";
import { pandocIntegrationDefinition } from "./pandoc-integration";

describe("pandocIntegrationDefinition", () => {
  it("shows the installed Pandoc CLI Guide and the pair-save action", () => {
    const definition = pandocIntegrationDefinition({
      plugin: { manifest: { version: "2.0.1-test" } },
    } as SettingTabContext) as SettingDefinitionGroup<SettingsKey>;

    expect(definition.heading).toBe(
      m.settings_citation_native_pandoc_heading(),
    );
    const items = definition.items!;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      name: m.settings_citation_pandoc_guide_name(),
    });
    expect("desc" in items[0]! && items[0].desc).toHaveProperty(
      "textContent",
      expect.stringContaining("ZotLit 2.0.1-test"),
    );
    expect(items[1]).toMatchObject({
      name: m.settings_citation_pandoc_files_name(),
      render: expect.any(Function),
    });
  });
});
