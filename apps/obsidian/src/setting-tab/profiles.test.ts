// @vitest-environment happy-dom
import {
  ButtonComponent,
  ExtraButtonComponent,
  Menu,
  Setting,
} from "@mock/obsidian";
import type {
  ExtraButtonComponent as ObsidianExtraButton,
  Setting as ObsidianSetting,
  SettingDefinitionItem,
  SettingDefinitionList,
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
  literatureNoteItems,
  profilesPage,
  setProfileControlValue,
} from "./profiles";

function context(): SettingTabContext {
  return {
    app: { vault: { getFileByPath: () => null } },
    customize: vi.fn(() => Promise.resolve()),
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

/** The rendered row, so a test reads the controls the user gets. */
function render(row: SettingDefinitionItem): Setting {
  if (!("render" in row) || !row.render)
    throw new Error("Expected a render row");
  const setting = new Setting(document.createElement("div"));
  row.render(setting as unknown as ObsidianSetting, {} as never);
  return setting;
}

/** What a `render` row's buttons are labelled by, icon tooltip included. */
function buttonLabels(row: SettingDefinitionItem): string[] {
  return render(row)
    .components.filter((control) => control instanceof ButtonComponent)
    .map((button) => button.text || button.tooltip);
}

/** The icons a `render` row's buttons carry, in order. */
function buttonIcons(row: SettingDefinitionItem): string[] {
  return render(row)
    .components.filter((control) => control instanceof ButtonComponent)
    .map((button) => button.icon);
}

/** The list a page carries under `heading`. */
function list(
  page: SettingDefinitionPage,
  heading: string,
): SettingDefinitionList {
  const found = page.items?.find(
    (row): row is SettingDefinitionList =>
      "type" in row && row.type === "list" && row.heading === heading,
  );
  if (!found) throw new Error(`No list headed ${heading}`);
  return found;
}

/** The Template document row of the main page. */
function documentRow(ctx: SettingTabContext): SettingDefinitionItem {
  const row = literatureNoteItems(ctx).find(
    (item) =>
      "name" in item && item.name === m.settings_profile_document_name(),
  );
  if (!row) throw new Error("No Template document row");
  return row;
}

/** The tooltips a `render` row's icon buttons carry, in order. */
function extraButtonTooltips(row: SettingDefinitionItem): string[] {
  return render(row)
    .components.filter((control) => control instanceof ExtraButtonComponent)
    .map((button) => button.tooltip);
}

/** The Profiles page with one Profile beside Default. */
function pageWithOneProfile(ctx: SettingTabContext): {
  defaultRow: SettingDefinitionItem;
  profileRow: SettingDefinitionItem;
} {
  ctx.profile = {
    profiles: [
      {
        id: "Bk3Qn7XvT2Lp",
        label: "Books",
        document: "zotlit-profile.books.md",
        path: "templates/zotlit-profile.books.md",
        bindings: {},
        match: { state: "absent", summary: m.profile_match_absent() },
      },
    ],
    diagnostics: [],
    loaded: true,
    defaultDocumentPath: "templates/zotlit-profile.default.md",
  } as unknown as SettingTabContext["profile"];
  const page = profilesPage(ctx);
  return {
    defaultRow: page.items![0]!,
    profileRow: list(page, m.settings_profile_other_heading()).items![0]!,
  };
}

function customizeButton(row: SettingDefinitionItem): ButtonComponent {
  const button = render(row)
    .components.filter((control) => control instanceof ButtonComponent)
    .find(({ tooltip }) => tooltip === m.settings_profile_edit());
  if (!button) throw new Error("No Customize button");
  return button;
}

describe("Profile settings", () => {
  it("opens the workbench from Edit and groups profile management in More actions", () => {
    const ctx = context();
    ctx.profile = {
      diagnostics: [],
      loaded: true,
      defaultDocumentPath: "templates/zotlit-profile.default.md",
      profiles: [
        {
          id: "Bk3Qn7XvT2Lp",
          label: "Books",
          document: "zotlit-profile.books.md",
          path: "templates/zotlit-profile.books.md",
          match: { state: "absent" },
          bindings: {},
        },
      ],
    } as unknown as SettingTabContext["profile"];
    const row = list(profilesPage(ctx), m.settings_profile_other_heading())
      .items![0]!;
    expect(buttonLabels(row)).toEqual([m.settings_profile_edit()]);
    expect(buttonIcons(row)).toEqual(["pencil"]);
    expect(
      list(profilesPage(ctx), m.settings_profile_other_heading()).onDelete,
    ).toBeUndefined();
    const more = render(row)
      .components.filter(
        (component) => component instanceof ExtraButtonComponent,
      )
      .find((button) => button.icon === "more-horizontal")!;
    Object.assign(more, { extraSettingsEl: document.createElement("button") });
    more.click();
    expect(Menu.instances.at(-1)?.items.map((item) => item.title)).toEqual([
      m.settings_profile_duplicate(),
      m.settings_profile_share(),
      m.settings_profile_delete(),
    ]);
  });
  it("combines templates and properties in one editing row", () => {
    const ctx = context();
    expect(
      literatureNoteItems(ctx).filter(
        (row) =>
          "name" in row && row.name === m.settings_profile_properties_name(),
      ),
    ).toEqual([]);
    expect(documentRow(ctx)).toMatchObject({
      desc: m.settings_profile_document_desc(),
    });
    expect(buttonIcons(documentRow(ctx))).toEqual(["pencil"]);
  });

  it("offers one Customize action for the built-in and saved template", async () => {
    const ctx = context();
    expect(buttonLabels(documentRow(ctx))).toEqual([m.settings_profile_edit()]);

    ctx.app = {
      vault: { getFileByPath: (path: string) => ({ path }) as TFile },
    } as unknown as SettingTabContext["app"];
    expect(buttonLabels(documentRow(ctx))).toEqual([
      m.settings_profile_document_restore(),
      m.settings_profile_edit(),
    ]);

    const { defaultRow } = pageWithOneProfile(ctx);
    expect(buttonLabels(defaultRow)).toEqual([m.settings_profile_edit()]);
    const more = render(defaultRow).components.filter(
      (control) => control instanceof ExtraButtonComponent,
    )[0]!;
    Object.assign(more, { extraSettingsEl: document.createElement("button") });
    more.click();
    expect(Menu.instances.at(-1)?.items.map((item) => item.title)).toEqual([
      m.settings_profile_share(),
      m.settings_profile_document_restore(),
    ]);

    customizeButton(documentRow(ctx)).click();
    await Promise.resolve();
    expect(ctx.customize).toHaveBeenCalledWith({ profileId: "default" });
  });

  it("keeps native customization while the web Template Workbench is off", () => {
    const ctx = context();
    ctx.settings = {
      current: { ...defaults, "server.workbench": false },
      updateDefaultLiteratureNoteProfileBindings: vi.fn(),
    } as unknown as SettingTabContext["settings"];

    expect(buttonLabels(documentRow(ctx))).toEqual([m.settings_profile_edit()]);

    ctx.app = {
      vault: { getFileByPath: (path: string) => ({ path }) as TFile },
    } as unknown as SettingTabContext["app"];
    expect(buttonLabels(documentRow(ctx))).toEqual([
      m.settings_profile_document_restore(),
      m.settings_profile_edit(),
    ]);
  });

  it("keeps native Default customization and offers connected Profile customization", async () => {
    const ctx = context();
    const { defaultRow, profileRow } = pageWithOneProfile(ctx);

    expect(extraButtonTooltips(defaultRow)).toEqual([
      m.workbench_more_actions(),
    ]);
    expect(extraButtonTooltips(profileRow)).toEqual([
      m.workbench_more_actions(),
    ]);

    expect(buttonLabels(defaultRow)).toContain(m.settings_profile_edit());

    // The row opens its own Profile through the configured workbench launcher.
    customizeButton(profileRow).click();
    await vi.waitFor(() =>
      expect(ctx.customize).toHaveBeenCalledWith({
        profileId: "Bk3Qn7XvT2Lp",
      }),
    );
  });

  it("keeps More actions available while web access is off", () => {
    const ctx = context();
    ctx.settings = {
      current: { ...defaults, "server.workbench": false },
      updateDefaultLiteratureNoteProfileBindings: vi.fn(),
    } as unknown as SettingTabContext["settings"];
    const { defaultRow, profileRow } = pageWithOneProfile(ctx);

    expect(extraButtonTooltips(defaultRow)).toEqual([
      m.workbench_more_actions(),
    ]);
    expect(extraButtonTooltips(profileRow)).toEqual([
      m.workbench_more_actions(),
    ]);
  });

  it("withholds both ways in while a Profile write would race the load", () => {
    const ctx = context();
    ctx.profile = {
      profiles: [],
      diagnostics: [],
      loaded: false,
      defaultDocumentPath: "templates/zotlit-profile.default.md",
    } as unknown as SettingTabContext["profile"];
    const profiles = list(
      profilesPage(ctx),
      m.settings_profile_other_heading(),
    );
    expect(profiles.addItem).toBeUndefined();
    expect(profiles.extraButtons).toBeUndefined();
  });

  it("keeps match summaries on profile rows and file paths on excluded documents", () => {
    const ctx = context();
    ctx.profile = {
      profiles: [
        {
          id: "Bk3Qn7XvT2Lp",
          label: "Books",
          document: "zotlit-profile.one.md",
          match: { state: "absent", summary: m.profile_match_absent() },
          bindings: {},
        },
        {
          id: "Rz9Wm4YfH6Kd",
          label: "Books",
          document: "zotlit-profile.two.md",
          match: { state: "all", summary: m.profile_match_all() },
          bindings: {},
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
    const page = profilesPage(ctx);
    expect(list(page, m.settings_profile_other_heading()).items).toEqual([
      expect.objectContaining({
        name: "Books",
        desc: m.settings_profile_match_status({ state: "absent" }),
      }),
      expect.objectContaining({
        name: "Books",
        desc: m.settings_profile_match_status({ state: "all" }),
      }),
    ]);
    // A refused document never shares the list with the Profiles that loaded.
    expect(list(page, m.settings_profile_excluded_heading()).items).toEqual([
      expect.objectContaining({
        name: "templates/zotlit-profile.copy.md",
        desc: undefined,
      }),
    ]);
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

it("warns once about repeated IDs and lists each excluded file with its own actions", async () => {
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
  const page = profilesPage(ctx);
  const banners = page.items!.filter(
    (row) =>
      "name" in row && row.name === m.settings_profile_duplicate_id_name(),
  );
  expect(banners).toHaveLength(1);
  const banner = banners[0]!;
  expect(banner).not.toHaveProperty("render");
  expect(banner).not.toHaveProperty("action");
  // The guidance reads as a warning, so the fix is not mistaken for a setting.
  const desc = (banner as { desc: DocumentFragment }).desc;
  expect(desc.textContent).toBe(m.settings_profile_duplicate_banner());
  expect(
    (desc.firstElementChild as HTMLElement).classList.contains("mod-warning"),
  ).toBe(true);

  const excluded = list(page, m.settings_profile_excluded_heading());
  expect(excluded.items!.map((row) => row.name)).toEqual(paths);

  render(excluded.items![0]!)
    .components.filter((control) => control instanceof ExtraButtonComponent)
    .find((button) => button.tooltip === m.settings_template_open())!
    .click();
  expect(open).toHaveBeenCalledWith({ path: paths[0] });

  // Deleting is the list's own affordance, addressed by row index.
  excluded.onDelete!(1);
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

it("adds a Profile from Default under the first unused number, with no dialog", async () => {
  const ctx = context();
  const duplicate = vi.fn(async () => ({
    path: "templates/zotlit-profile.profile-2.md",
  }));
  ctx.profile = {
    profiles: [
      {
        id: "Bk3Qn7XvT2Lp",
        label: "Profile 1",
        bindings: {},
        match: { state: "absent", summary: m.profile_match_absent() },
      },
      {
        id: "Rz9Wm4YfH6Kd",
        label: "Profile 3",
        bindings: {},
        match: { state: "absent", summary: m.profile_match_absent() },
      },
    ],
    diagnostics: [],
    loaded: true,
    defaultDocumentPath: "templates/zotlit-profile.default.md",
    resolveProfile: () => ({ label: undefined }),
    duplicate,
  } as unknown as SettingTabContext["profile"];
  ctx.app = {
    vault: { getFileByPath: () => null },
    setting: { close: vi.fn() },
  } as unknown as SettingTabContext["app"];
  ctx.requestUpdate = vi.fn();

  const profiles = list(profilesPage(ctx), m.settings_profile_other_heading());
  profiles.addItem!.action(document.createElement("div"));

  // "Profile 1" and "Profile 3" are taken, so the gap is used before the tail.
  await vi.waitFor(() =>
    expect(duplicate).toHaveBeenCalledWith("default", {
      label: m.settings_profile_numbered_name({ number: 2 }),
    }),
  );
});

it("asks the import flow for its own source", async () => {
  const ctx = context();
  ctx.importProfile = vi.fn(async () => undefined);
  ctx.requestUpdate = vi.fn();
  const profiles = list(profilesPage(ctx), m.settings_profile_other_heading());

  const button = new ExtraButtonComponent(document.createElement("div"));
  profiles.extraButtons![0]!(button as unknown as ObsidianExtraButton);
  expect(button.tooltip).toBe(m.command_import_profile_name());
  button.click();
  await vi.waitFor(() =>
    expect(ctx.importProfile).toHaveBeenCalledExactlyOnceWith(),
  );
});

it("shows a short match status for each non-default row", () => {
  const ctx = context();
  const states = ["absent", "all", "evaluable", "unevaluable"] as const;
  const summaries = [
    m.profile_match_absent(),
    m.profile_match_all(),
    m.settings_profile_match_tags_contain({ tags: "Read" }),
    m.profile_match_problem({
      problem: m.profile_match_problem_unknown_library({ text: '"group:999"' }),
    }),
  ];
  ctx.profile = {
    diagnostics: [],
    loaded: true,
    defaultDocumentPath: "templates/zotlit-profile.default.md",
    profiles: summaries.map((summary, index) => ({
      id: `Profile${index}`,
      label: `Profile ${index}`,
      document: `zotlit-profile.${index}.md`,
      path: "",
      bindings: {},
      match: { state: states[index], summary },
    })),
  } as unknown as SettingTabContext["profile"];
  const page = profilesPage(ctx);
  const rows = list(page, m.settings_profile_other_heading()).items!;
  for (const [index, row] of rows.entries()) {
    expect(row).toMatchObject({
      desc: m.settings_profile_match_status({ state: states[index]! }),
    });
  }
  const defaultRow = page.items![0]!;
  expect(defaultRow).toMatchObject({ name: m.settings_profile_default_name() });
  expect((defaultRow as { desc?: unknown }).desc).not.toBeInstanceOf(
    DocumentFragment,
  );
});
