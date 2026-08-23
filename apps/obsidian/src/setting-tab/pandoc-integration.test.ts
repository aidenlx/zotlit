// @vitest-environment happy-dom

import type { Setting, SettingDefinitionGroup, SettingGroup } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DOCS_SITE_URL } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";

import type { SettingsKey, SettingTabContext } from "./context";
import { pandocIntegrationDefinition } from "./pandoc-integration";

afterEach(() => vi.unstubAllGlobals());

describe("pandocIntegrationDefinition", () => {
  it("shows the tutorial, pair-save action, and installed Pandoc CLI Guide in order", () => {
    const definition = pandocIntegrationDefinition({
      plugin: { manifest: { version: "2.0.1-test" } },
    } as SettingTabContext) as SettingDefinitionGroup<SettingsKey>;

    expect(definition.heading).toBe(
      m.settings_citation_native_pandoc_heading(),
    );
    const items = definition.items!;
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      name: m.settings_citation_pandoc_tutorial_name(),
    });
    expect(items[1]).toMatchObject({
      name: m.settings_citation_pandoc_files_name(),
      render: expect.any(Function),
    });
    expect(items[2]).toMatchObject({
      name: m.settings_citation_pandoc_guide_name(),
    });
    expect("desc" in items[2]! && items[2].desc).toHaveProperty(
      "textContent",
      expect.stringContaining("ZotLit 2.0.1-test"),
    );
  });

  it("opens the Pandoc citation tutorial at its stable URL", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });

    const definition = pandocIntegrationDefinition({
      plugin: { manifest: { version: "2.0.1-test" } },
    } as SettingTabContext) as SettingDefinitionGroup<SettingsKey>;
    const tutorial = definition.items![0]!;
    expect(tutorial).toMatchObject({
      name: "Pandoc citation tutorial",
      desc: "Follow the complete workflow from Literature Note citations to built-in and native Pandoc export.",
      render: expect.any(Function),
    });

    let action: (() => void) | undefined;
    let label: string | undefined;
    const button = {
      setButtonText: (text: string) => {
        label = text;
        return button;
      },
      onClick: (onClick: () => void) => {
        action = onClick;
        return button;
      },
    };
    const setting = {
      addButton: (configure: (component: typeof button) => void) => {
        configure(button);
        return setting;
      },
    };
    if (!("render" in tutorial) || !tutorial.render) {
      throw new Error("Pandoc tutorial setting has no custom renderer");
    }
    tutorial.render(setting as unknown as Setting, {} as SettingGroup);

    expect(label).toBe("Open tutorial");
    expect(action).toBeDefined();
    action!();
    expect(open).toHaveBeenCalledWith(
      `${DOCS_SITE_URL}/docs/tutorial/pandoc-citation-workflow`,
    );
  });
});
