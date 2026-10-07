// @vitest-environment happy-dom
import { ButtonComponent, Setting } from "@mock/obsidian";
import type { Setting as ObsidianSetting, SettingDefinition } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { ManagedBinaryStatus } from "@/services/managed-binary/service";

import type { SettingsKey, SettingTabContext } from "./context";
import { managedBinaryDefinition } from "./managed-binary";
import type { ManagedBinaryCopy } from "./managed-binary";
import { pandocEngineDefinition } from "./pandoc-engine";

const COPY: ManagedBinaryCopy = {
  id: "settings_segmenter",
  name: "Segmenter",
  desc: "Cuts words.",
  status: {
    absent: "Not installed.",
    installing: "Installing.",
    installed: (version) => `Version ${version}.`,
    downloadFailed: (detail) => `Download failed: ${detail}.`,
    hashMismatch: "Hash mismatch.",
    initFailed: (detail) => `Start failed: ${detail}.`,
  },
  actions: {
    install: "Install",
    installing: "Installing…",
    retry: "Retry",
    uninstall: "Uninstall",
  },
  notices: {
    downloading: "Downloading the segmenter",
    installed: "Segmenter installed",
    installFailed: "Segmenter install failed",
    removed: "Segmenter removed",
    removeFailed: "Segmenter removal failed",
  },
};

function binary(status: ManagedBinaryStatus) {
  return {
    getStatus: () => status,
    install: vi.fn(() => Promise.resolve()),
    uninstall: vi.fn(() => Promise.resolve()),
  };
}

/** The rendered row, so a test reads the controls the user gets. */
function render(row: SettingDefinition<SettingsKey>): Setting {
  if (!("render" in row) || !row.render)
    throw new Error("Expected a render row");
  const setting = new Setting(document.createElement("div"));
  row.render(setting as unknown as ObsidianSetting, {} as never);
  return setting;
}

function button(setting: Setting): ButtonComponent {
  const found = setting.components.find(
    (control) => control instanceof ButtonComponent,
  );
  if (!(found instanceof ButtonComponent)) throw new Error("No button");
  // The mock's shared stub element has no focus to drop.
  found.buttonEl = document.createElement("button");
  return found;
}

describe("managedBinaryDefinition", () => {
  it("offers the install while nothing is cached", () => {
    const actions = binary({ kind: "absent" });
    const row = managedBinaryDefinition(actions, COPY);

    expect(row).toMatchObject({
      id: "settings_segmenter",
      name: "Segmenter",
      desc: "Cuts words. Not installed.",
    });
    const install = button(render(row));
    expect(install.text).toBe("Install");

    install.click();
    expect(actions.install).toHaveBeenCalledOnce();
  });

  it("offers the removal once installed", () => {
    const actions = binary({ kind: "installed", version: "2.4.0" });
    const row = managedBinaryDefinition(actions, COPY);

    expect(row).toMatchObject({ desc: "Cuts words. Version 2.4.0." });
    const uninstall = button(render(row));
    expect(uninstall.text).toBe("Uninstall");

    uninstall.click();
    expect(actions.uninstall).toHaveBeenCalledOnce();
  });

  it("names the failure and offers a retry", () => {
    const row = managedBinaryDefinition(
      binary({
        kind: "failed",
        failure: { code: "download-failed", url: "u", detail: "offline" },
      }),
      COPY,
    );

    expect(row).toMatchObject({
      desc: "Cuts words. Download failed: offline.",
    });
    expect(button(render(row)).text).toBe("Retry");
  });
});

describe("pandocEngineDefinition", () => {
  it("renders the Pandoc engine row from its own messages", () => {
    const ctx = {
      pandocEngine: binary({ kind: "installed", version: "3.10" }),
    } as unknown as SettingTabContext;
    const row = pandocEngineDefinition(ctx);

    expect(row).toMatchObject({
      id: "settings_citation_engine",
      name: m.settings_citation_engine_name(),
      desc: `${m.settings_citation_engine_desc()} ${m.settings_citation_engine_status_installed({ version: "3.10" })}`,
    });
    expect(button(render(row)).text).toBe(
      m.settings_citation_engine_uninstall(),
    );
  });
});
