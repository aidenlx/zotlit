// @vitest-environment happy-dom

import type { Setting, SettingDefinitionGroup, SettingGroup } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DOCS_SITE_URL } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";

import type { SettingsKey, SettingTabContext } from "./context";
import { pandocIntegrationDefinition } from "./pandoc-integration";

afterEach(() => vi.unstubAllGlobals());

describe("pandocIntegrationDefinition", () => {
  it("names the running ZotLit version in the Pandoc CLI Guide row", () => {
    const definition = pandocIntegrationDefinition({
      manifest: { version: "2.0.1-test" },
    } as SettingTabContext) as SettingDefinitionGroup<SettingsKey>;
    const guide = definition.items!.find(
      (item) =>
        "name" in item && item.name === m.settings_citation_pandoc_guide_name(),
    )!;
    expect("desc" in guide && guide.desc).toHaveProperty(
      "textContent",
      expect.stringContaining("ZotLit 2.0.1-test"),
    );
  });

  it("opens the Pandoc citation tutorial at its stable URL", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });

    const definition = pandocIntegrationDefinition({
      manifest: { version: "2.0.1-test" },
    } as SettingTabContext) as SettingDefinitionGroup<SettingsKey>;
    const tutorial = definition.items![0]!;

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

    expect(label).toBe(m.settings_citation_pandoc_tutorial_open());
    expect(action).toBeDefined();
    action!();
    expect(open).toHaveBeenCalledWith(
      `${DOCS_SITE_URL}/docs/tutorial/pandoc-citation-workflow`,
    );
  });
});
