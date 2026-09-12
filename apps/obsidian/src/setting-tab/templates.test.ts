// @vitest-environment happy-dom
import {
  ButtonComponent,
  ExtraButtonComponent,
  Menu,
  Setting,
} from "@mock/obsidian";
import type {
  Setting as ObsidianSetting,
  SettingDefinitionItem,
  SettingDefinitionList,
} from "obsidian";
import { expect, it, vi } from "vitest";

import * as confirmation from "@/lib/confirm";
import * as m from "@/lib/i18n/generated/messages";
import type { CitationTemplateStatus } from "@/services/template/service";
import { createSharedPartial } from "@/views/template-workbench/new-partial";
import { openTemplateWorkbench } from "@/views/template-workbench/register";

import type { SettingTabContext } from "./context";
import { citationTextItems, partialItems } from "./templates";

vi.mock("@/services/template/actions", () => ({
  openCitationTemplate: vi.fn(async () => {}),
}));
vi.mock("@/views/template-workbench/register", () => ({
  openTemplateWorkbench: vi.fn(async () => {}),
}));
vi.mock("@/views/template-workbench/new-partial", () => ({
  createSharedPartial: vi.fn(async () => null),
}));

/** The rendered row, so a test reads the controls the user gets. */
function renderItem(row: SettingDefinitionItem): Setting {
  if (!("render" in row) || !row.render)
    throw new Error("Expected a render row");
  const setting = new Setting(document.createElement("div"));
  row.render(setting as unknown as ObsidianSetting, {} as never);
  return setting;
}

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

/** The Partials list and the reserved-name rows, for one template state. */
function partialRows(
  partials: readonly { name: string; path: string; language: "liquid" }[],
  reserved: readonly { name: string; path: string }[] = [],
) {
  return partialItems({
    app: { setting: { close: vi.fn() }, vault: { getFileByPath: () => null } },
    requestUpdate: () => {},
    template: {
      ready: Promise.resolve(),
      loaded: true,
      getPartialDocuments: () => partials,
      getReservedPartialFiles: () => reserved,
      getPartialNames: () => partials.map(({ name }) => name),
      deletePartial,
    },
  } as unknown as SettingTabContext);
}

const deletePartial = vi.fn(async () => {});

const AUTHORS = {
  name: "authors",
  path: "Templates/zotlit-partial.authors.md",
  language: "liquid",
} as const;
const VENUE = {
  name: "venue-line",
  path: "Templates/zotlit-partial.venue-line.md",
  language: "liquid",
} as const;

it("offers Open for each partial", () => {
  const [list] = partialRows([AUTHORS, VENUE]) as [SettingDefinitionList];

  expect(tooltips(renderItem(list.items![0]!))).toEqual([
    m.settings_partial_open(),
  ]);
  expect(tooltips(renderItem(list.items![1]!))).toEqual([
    m.settings_partial_open(),
  ]);
});

it("holds Delete in the row's menu and trashes the partial once confirmed", async () => {
  vi.spyOn(confirmation, "confirm").mockResolvedValue(true);
  const [list] = partialRows([AUTHORS]) as [SettingDefinitionList];
  const more = renderItem(list.items![0]!)
    .components.filter((control) => control instanceof ExtraButtonComponent)
    .find((button) => button.icon === "more-horizontal")!;
  Object.assign(more, { extraSettingsEl: document.createElement("button") });
  more.click();

  const menu = Menu.instances.at(-1)!;
  expect(menu.items.map((item) => item.title)).toEqual([
    m.settings_partial_delete(),
  ]);
  menu.items[0]!.click();
  await vi.waitFor(() => expect(deletePartial).toHaveBeenCalledWith("authors"));
});

it("closes settings only once Add partial has created a document", async () => {
  const close = vi.fn();
  const requestUpdate = vi.fn();
  const ctx = {
    app: {
      setting: { close },
      vault: { getFileByPath: (path: string) => ({ path }) },
    },
    requestUpdate,
    template: {
      ready: Promise.resolve(),
      loaded: true,
      getPartialDocuments: () => [],
      getReservedPartialFiles: () => [],
      getPartialNames: () => [],
      getPartialDocument: () => AUTHORS,
    },
  } as unknown as SettingTabContext;
  const [list] = partialItems(ctx) as [SettingDefinitionList];

  vi.mocked(createSharedPartial).mockResolvedValueOnce(null);
  list.addItem!.action(document.createElement("button"));
  await vi.waitFor(() => expect(requestUpdate).toHaveBeenCalled());
  expect(close).not.toHaveBeenCalled();
  expect(openTemplateWorkbench).not.toHaveBeenCalled();

  vi.mocked(createSharedPartial).mockResolvedValueOnce("authors");
  list.addItem!.action(document.createElement("button"));
  await vi.waitFor(() => expect(close).toHaveBeenCalled());
  expect(openTemplateWorkbench).toHaveBeenCalledWith(
    ctx.app,
    { path: AUTHORS.path },
    { explainUnsupported: false },
  );
});
