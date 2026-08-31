// @vitest-environment happy-dom
import { ButtonComponent, MenuItem, Setting } from "@mock/obsidian";
import type {
  Setting as ObsidianSetting,
  SettingDefinitionPage,
  TFile,
} from "obsidian";
import { describe, expect, it, vi } from "vitest";

import * as confirmation from "@/lib/confirm";
import * as m from "@/lib/i18n/generated/messages";
import { defaults } from "@/services/settings/schema";

import type { SettingTabContext } from "./context";
import {
  getProfileControlValue,
  literatureNoteProfileItems,
  setProfileControlValue,
} from "./profiles";

function context(): SettingTabContext {
  return {
    app: { vault: { getFileByPath: () => null } },
    settings: {
      current: defaults,
      updateDefaultLiteratureNoteProfileBindings: vi.fn(),
    },
    profile: {
      profiles: [],
      diagnostics: [],
      loaded: true,
      defaultDocumentPath: "templates/zotlit-profile.default.md",
    },
  } as unknown as SettingTabContext;
}

describe("Profile settings", () => {
  it("keeps the five default bindings beside the document actions", () => {
    const ctx = context();
    const page = literatureNoteProfileItems(ctx)[0] as SettingDefinitionPage;
    expect(page.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          control: expect.objectContaining({
            key: "note-profile:default:folder",
          }),
        }),
        expect.objectContaining({
          name: m.settings_citation_references_style_name(),
        }),
        expect.objectContaining({
          control: expect.objectContaining({
            key: "note-profile:default:import-folder",
          }),
        }),
        expect.objectContaining({
          control: expect.objectContaining({
            key: "note-profile:default:colored-highlights",
          }),
        }),
        expect.objectContaining({
          control: expect.objectContaining({
            key: "note-profile:default:annotations-as-template",
          }),
        }),
      ]),
    );
    expect(page.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "page",
          name: m.settings_note_import_highlight_mappings_name(),
          items: expect.arrayContaining([
            expect.objectContaining({ name: "Blue" }),
          ]),
        }),
      ]),
    );
  });

  it("lists repeated labels with filenames and excluded documents with diagnostics", () => {
    const ctx = context();
    ctx.profile = {
      profiles: [
        {
          id: "Bk3Qn7XvT2Lp",
          label: "Books",
          document: "zotlit-profile.one.md",
        },
        {
          id: "Rz9Wm4YfH6Kd",
          label: "Books",
          document: "zotlit-profile.two.md",
        },
      ],
      diagnostics: [
        {
          code: "duplicate-profile-id",
          path: "templates/zotlit-profile.copy.md",
          paths: [
            "templates/zotlit-profile.original.md",
            "templates/zotlit-profile.copy.md",
          ],
        },
      ],
    } as unknown as SettingTabContext["profile"];
    const page = literatureNoteProfileItems(ctx)[0] as SettingDefinitionPage;
    expect(page.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Books",
          desc: "zotlit-profile.one.md",
        }),
        expect.objectContaining({
          name: "Books",
          desc: "zotlit-profile.two.md",
        }),
        expect.objectContaining({
          name: "templates/zotlit-profile.copy.md",
          desc: undefined,
        }),
      ]),
    );
  });

  it("writes only default bindings through the settings controls", () => {
    const ctx = context();
    expect(
      getProfileControlValue(ctx.settings, "note-profile:default:folder"),
    ).toBe("literatures");
    setProfileControlValue(
      ctx.settings,
      "note-profile:default:folder",
      "Reading",
    );
    expect(
      ctx.settings.updateDefaultLiteratureNoteProfileBindings,
    ).toHaveBeenCalledWith({ "note.literature-folder": "Reading" });
  });
});

it("has one generic collision banner and Open/Delete actions for each excluded file", async () => {
  using confirm = vi.spyOn(confirmation, "confirm").mockResolvedValue(true);
  const ctx = context();
  const paths = [
    "templates/zotlit-profile.one.md",
    "templates/zotlit-profile.two.md",
  ];
  const open = vi.fn();
  const trash = vi.fn();
  ctx.app = {
    vault: { getFileByPath: (path: string) => ({ path }) as TFile },
    workspace: { getLeaf: () => ({ openFile: open }) },
    fileManager: { trashFile: trash },
  } as unknown as SettingTabContext["app"];
  ctx.requestUpdate = vi.fn();
  ctx.profile = {
    profiles: [],
    loaded: true,
    defaultDocumentPath: "templates/zotlit-profile.default.md",
    diagnostics: paths.map((path) => ({
      code: "duplicate-profile-id",
      path,
      paths,
      message: "Repeated ID",
    })),
  } as unknown as SettingTabContext["profile"];
  const page = literatureNoteProfileItems(ctx)[0] as SettingDefinitionPage;
  expect(
    page.items!.filter(
      (row) =>
        "name" in row && row.name === m.settings_profile_duplicate_banner(),
    ),
  ).toHaveLength(1);
  const banner = page.items!.find(
    (row) =>
      "name" in row && row.name === m.settings_profile_duplicate_banner(),
  )!;
  expect(banner).not.toHaveProperty("render");
  expect(banner).not.toHaveProperty("action");
  const rows = new Map<string, Setting>();
  for (const path of paths) {
    const row = page.items!.find((row) => "name" in row && row.name === path)!;
    if (!("render" in row) || !row.render)
      throw new Error("Expected file action row");
    const setting = new Setting(document.createElement("div"));
    row.render(setting as unknown as ObsidianSetting, {} as never);
    rows.set(path, setting);
    const buttons = setting.components.filter(
      (control) => control instanceof ButtonComponent,
    );
    expect(buttons).toHaveLength(2);
    expect(buttons.map((button) => button.text)).toEqual(
      expect.arrayContaining([
        m.settings_profile_document_open(),
        m.settings_profile_delete(),
      ]),
    );
  }
  rows
    .get(paths[0]!)!
    .components.filter((control) => control instanceof ButtonComponent)
    .find((button) => button.text === m.settings_profile_document_open())!
    .click();
  expect(open).toHaveBeenCalledWith({ path: paths[0] });
  rows
    .get(paths[1]!)!
    .components.filter((control) => control instanceof ButtonComponent)
    .find((button) => button.text === m.settings_profile_delete())!
    .click();
  await vi.waitFor(() =>
    expect(trash).toHaveBeenCalledWith({ path: paths[1] }),
  );
  expect(confirm).toHaveBeenCalledWith(
    expect.objectContaining({
      destructive: true,
      content: m.settings_profile_delete_confirm_body(),
    }),
    ctx.app,
  );
});

it("opens the shared create and import flows from the Add profile menu", async () => {
  using buttons = vi.spyOn(ButtonComponent.prototype, "onClick");
  using buttonLabels = vi.spyOn(ButtonComponent.prototype, "setButtonText");
  using menu = vi.spyOn(MenuItem.prototype, "onClick");
  using labels = vi.spyOn(MenuItem.prototype, "setTitle");
  const ctx = context();
  ctx.createProfile = vi.fn(async () => undefined);
  ctx.importProfile = vi.fn(async () => undefined);
  ctx.requestUpdate = vi.fn();
  const page = literatureNoteProfileItems(ctx)[0] as SettingDefinitionPage;
  const row = page.items!.find(
    (row) => "name" in row && row.name === m.settings_profile_heading(),
  )!;
  if (!("render" in row) || !row.render)
    throw new Error("Expected Add menu row");
  row.render(
    new Setting(document.createElement("div")) as unknown as ObsidianSetting,
    {} as never,
  );
  const addButton =
    buttonLabels.mock.instances[
      buttonLabels.mock.calls.findIndex(
        ([label]) => label === m.settings_profile_add_menu(),
      )
    ];
  buttons.mock.calls[buttons.mock.instances.indexOf(addButton)]![0](
    {} as MouseEvent,
  );
  expect(labels.mock.calls.map(([label]) => label)).toEqual([
    m.settings_profile_add(),
    m.profile_import_clipboard(),
    m.profile_import_file(),
  ]);
  expect(ctx.createProfile).not.toHaveBeenCalled();
  expect(ctx.importProfile).not.toHaveBeenCalled();
  const select = (label: string) => {
    const instance =
      labels.mock.instances[
        labels.mock.calls.findIndex(([title]) => title === label)
      ];
    menu.mock.calls[menu.mock.instances.indexOf(instance)]![0](
      {} as MouseEvent,
    );
  };
  select(m.settings_profile_add());
  select(m.profile_import_clipboard());
  await vi.waitFor(() => expect(ctx.createProfile).toHaveBeenCalledOnce());
  expect(ctx.importProfile).toHaveBeenCalledExactlyOnceWith({
    source: "clipboard",
  });
  select(m.profile_import_file());
  await vi.waitFor(() =>
    expect(ctx.importProfile).toHaveBeenLastCalledWith({ source: "file" }),
  );
});
