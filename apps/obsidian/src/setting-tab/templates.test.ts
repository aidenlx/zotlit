// @vitest-environment happy-dom
import { ButtonComponent, Setting } from "@mock/obsidian";
import type { Setting as ObsidianSetting } from "obsidian";
import { expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { CitationTemplateStatus } from "@/services/template/service";

import type { SettingTabContext } from "./context";
import { citationTextItems, templateEngineItems } from "./templates";

vi.mock("@/services/template/actions", () => ({
  openCitationTemplate: vi.fn(async () => {}),
}));

function engineRows(unrecognized: readonly string[]) {
  return templateEngineItems({
    template: {
      loaded: true,
      javascriptTemplatesEnabled: false,
      getUnrecognizedFiles: () => unrecognized,
    },
  } as unknown as SettingTabContext);
}

it("names each unrecognized ZotLit file in one row", () => {
  const path = "Templates/zotlit-foo.md";

  expect(engineRows([path])).toContainEqual(
    expect.objectContaining({
      name: m.settings_template_unrecognized_name(),
      desc: m.settings_template_unrecognized_desc({ path }),
    }),
  );
  expect(engineRows([])).not.toContainEqual(
    expect.objectContaining({ name: m.settings_template_unrecognized_name() }),
  );
});

const DEFAULT_STATUS: CitationTemplateStatus = {
  path: "Templates/zotlit-citation.md",
  customized: false,
  language: "liquid",
  inertPath: null,
  compileError: null,
};

/** The Citation text row as it renders for one Citation Template state. */
function citationRow(status: CitationTemplateStatus): Setting {
  const [row] = citationTextItems({
    app: {},
    requestUpdate: () => {},
    template: {
      loaded: true,
      getCitationTemplateStatus: () => status,
    },
  } as unknown as SettingTabContext);
  if (!row || !("render" in row) || !row.render) {
    throw new Error("Expected one Citation text render row");
  }
  const setting = new Setting(document.createElement("div"));
  row.render(setting as unknown as ObsidianSetting, {} as never);
  return setting;
}

/** The row's description, as `setDesc` received it. */
function description(setting: Setting): DocumentFragment {
  return setting.desc as unknown as DocumentFragment;
}

function tooltips(setting: Setting): string[] {
  return setting.components
    .filter((control) => control instanceof ButtonComponent)
    .map((button) => button.tooltip);
}

it("reads as the built-in default and offers Open alone until a document exists", () => {
  const setting = citationRow(DEFAULT_STATUS);

  expect(description(setting).textContent).toContain(
    m.settings_template_using_default(),
  );
  expect(description(setting).textContent).not.toContain(DEFAULT_STATUS.path);
  expect(tooltips(setting)).toEqual([m.settings_citation_text_open()]);
});

it("names the document and adds Reset once the vault holds one", () => {
  const setting = citationRow({ ...DEFAULT_STATUS, customized: true });

  expect(description(setting).querySelector("code")?.textContent).toBe(
    DEFAULT_STATUS.path,
  );
  expect(description(setting).textContent).not.toContain(
    m.settings_template_using_default(),
  );
  expect(tooltips(setting)).toEqual([
    m.settings_citation_text_open(),
    m.settings_template_reset(),
  ]);
});

it("warns on the row when the document is inert or fails to compile", () => {
  const inert = citationRow({
    ...DEFAULT_STATUS,
    customized: true,
    language: "eta",
    inertPath: DEFAULT_STATUS.path,
  });
  expect(description(inert).textContent).toContain(
    m.settings_template_inert_eta({ path: DEFAULT_STATUS.path }),
  );

  const broken = citationRow({
    ...DEFAULT_STATUS,
    customized: true,
    compileError: "Unexpected token",
  });
  expect(description(broken).textContent).toContain("Unexpected token");
});
