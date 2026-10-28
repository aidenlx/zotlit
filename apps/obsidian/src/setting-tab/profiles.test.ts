// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import {
  ButtonComponent,
  ExtraButtonComponent,
  Menu,
  Modal,
  renderRow,
} from "@mock/obsidian";
import { Effect, Layer, Queue } from "effect";
import { SuggestModal, TFile } from "obsidian";
import type {
  App,
  ExtraButtonComponent as ObsidianExtraButton,
  SettingDefinitionItem,
  SettingDefinitionList,
  SettingDefinitionPage,
} from "obsidian";
import { describe, expect, vi } from "vitest";

import { answerConfirmation } from "@/lib/__fixtures__/confirm";
import { eventually, until } from "@/lib/__fixtures__/eventually";
import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { FileManager } from "@/lib/obsidian-file-manager";
import { Vault } from "@/lib/obsidian-vault";
import type { ProfileId } from "@/lib/profile-stamp";
import { Customize } from "@/services/local-bridge/customize";
import type { CustomizeRequest } from "@/services/local-bridge/customize";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import { Profile } from "@/services/profile/service";
import type {
  LiteratureNoteProfile,
  ProfileCreation,
} from "@/services/profile/service";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";
import { Template } from "@/services/template/service";
import {
  openNativeProfile,
  openTemplateWorkbench,
} from "@/views/template-workbench/open";

import { rebuildingSettingTab } from "./__fixtures__";
import type { SettingTabContext } from "./context";
import { profileControlValue, setProfileControlValue } from "./controls";
import { literatureNoteItems, profilesPage } from "./profiles";

vi.mock("@/views/template-workbench/open", () => ({
  openNativeProfile: vi.fn(() => Effect.void),
  openTemplateWorkbench: vi.fn(() => Effect.void),
}));

const books = "Bk3Qn7XvT2Lp" as ProfileId;
const DEFAULT_DOCUMENT = "templates/zotlit-profile.default.md";
const BOOKS: LiteratureNoteProfile = {
  id: books,
  label: "Books",
  document: "zotlit-profile.books.md",
  path: "templates/zotlit-profile.books.md",
  bindings: {},
  match: { state: "absent", summary: m.profile_match_absent() },
};

function fileAt(path: string): TFile {
  const file = new TFile();
  file.path = path;
  for (const field of [
    "vault",
    "name",
    "parent",
    "stat",
    "basename",
    "extension",
  ])
    Reflect.deleteProperty(file, field);
  return file;
}

/**
 * The tab context over typed fakes of the services the Profile rows read: a
 * loaded registry with no Profile and no saved Default document, unless a
 * case overrides a member. `rebuilt` takes one element per rebuild an action
 * asks for, which a successful action asks for when it ends.
 */
const tabOver = Effect.fnUntraced(function* (
  fakes: {
    profile?: Partial<Profile["Service"]>;
    vault?: Partial<Vault["Service"]>;
    fileManager?: Partial<FileManager["Service"]>;
    settings?: Settings;
  } = {},
) {
  const settings = {
    current: Effect.succeed(fakes.settings ?? defaults),
    updateDefaultLiteratureNoteProfileBindings: vi.fn(() => Effect.void),
  };
  const customize = vi.fn((_request: CustomizeRequest) => {});
  const { tab, rebuilt } = yield* rebuildingSettingTab(
    Layer.mergeAll(
      Layer.mock(Customize, {
        open: (request) => Effect.sync(() => customize(request)),
      }),
      Layer.mock(Profile, {
        loaded: Effect.succeed(true),
        profiles: Effect.succeed([]),
        diagnostics: Effect.succeed([]),
        defaultDocumentPath: Effect.succeed(DEFAULT_DOCUMENT),
        ...fakes.profile,
      }),
      Layer.mock(Template, {
        loaded: Effect.succeed(true),
        getPartialDocuments: Effect.succeed([]),
        getReservedPartialFiles: Effect.succeed([]),
      }),
      Layer.mock(Vault, {
        getFileByPath: () => Effect.succeed(null),
        ...fakes.vault,
      }),
      Layer.mock(FileManager, fakes.fileManager ?? {}),
      Layer.mock(PluginSettings, settings),
    ),
  );
  const ctx = stubService<SettingTabContext>("SettingTabContext", {
    tab,
    app: stubService<App>("App", {}),
  });
  return { ctx, rebuilt, customize, settings };
});

/** A vault that holds every path, the saved Default document included. */
const everyFile = {
  getFileByPath: (path: string) => Effect.succeed(fileAt(path)),
};

/** What a `render` row's buttons are labelled by, icon tooltip included. */
function buttonLabels(row: SettingDefinitionItem): string[] {
  return renderRow(row)
    .components.filter((control) => control instanceof ButtonComponent)
    .map((button) => button.text || button.tooltip);
}

/** The icons a `render` row's buttons carry, in order. */
function buttonIcons(row: SettingDefinitionItem): string[] {
  return renderRow(row)
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
  return renderRow(row)
    .components.filter((control) => control instanceof ExtraButtonComponent)
    .map((button) => button.tooltip);
}

/** The Profiles page's Default row and the row of its one other Profile. */
function pageRows(ctx: SettingTabContext): {
  defaultRow: SettingDefinitionItem;
  profileRow: SettingDefinitionItem;
} {
  const page = profilesPage(ctx);
  return {
    defaultRow: page.items![0]!,
    profileRow: list(page, m.settings_profile_other_heading()).items![0]!,
  };
}

/** The titles of the menu a row's More actions button opens. */
function moreActions(row: SettingDefinitionItem): string[] {
  const more = renderRow(row)
    .components.filter((control) => control instanceof ExtraButtonComponent)
    .find((button) => button.icon === "more-horizontal")!;
  Object.assign(more, { extraSettingsEl: document.createElement("button") });
  more.click();
  return Menu.instances.at(-1)!.items.map((item) => item.title);
}

function customizeButton(row: SettingDefinitionItem): ButtonComponent {
  const button = renderRow(row)
    .components.filter((control) => control instanceof ButtonComponent)
    .find(({ tooltip }) => tooltip === m.settings_profile_edit());
  if (!button) throw new Error("No Customize button");
  return button;
}

describe("Profile settings", () => {
  it.effect(
    "opens the workbench from Edit and groups profile management in More actions",
    () =>
      Effect.gen(function* () {
        const { ctx } = yield* tabOver({
          profile: { profiles: Effect.succeed([BOOKS]) },
        });
        const { profileRow } = pageRows(ctx);
        expect(buttonLabels(profileRow)).toEqual([m.settings_profile_edit()]);
        expect(buttonIcons(profileRow)).toEqual(["pencil"]);
        expect(moreActions(profileRow)).toEqual([
          m.settings_profile_duplicate(),
          m.settings_profile_share(),
          m.settings_profile_delete(),
        ]);
      }),
  );

  it.effect("combines templates and properties in one editing row", () =>
    Effect.gen(function* () {
      const { ctx } = yield* tabOver();
      expect(
        literatureNoteItems(ctx).filter(
          (row) => "id" in row && /properties/.test(row.id),
        ),
      ).toEqual([]);
      expect(buttonIcons(documentRow(ctx))).toEqual(["pencil"]);
    }),
  );

  it.effect(
    "offers one Customize action for the built-in template, and Restore beside it for a saved one",
    () =>
      Effect.gen(function* () {
        const builtIn = yield* tabOver();
        expect(buttonLabels(documentRow(builtIn.ctx))).toEqual([
          m.settings_profile_edit(),
        ]);

        const saved = yield* tabOver({
          profile: { profiles: Effect.succeed([BOOKS]) },
          vault: everyFile,
        });
        expect(buttonLabels(documentRow(saved.ctx))).toEqual([
          m.settings_profile_document_restore(),
          m.settings_profile_edit(),
        ]);
        const { defaultRow } = pageRows(saved.ctx);
        expect(buttonLabels(defaultRow)).toEqual([m.settings_profile_edit()]);
        expect(moreActions(defaultRow)).toEqual([
          m.settings_profile_share(),
          m.settings_profile_document_restore(),
        ]);

        customizeButton(documentRow(saved.ctx)).click();
        yield* Queue.take(saved.rebuilt);
        expect(saved.customize).toHaveBeenCalledWith({ profileId: "default" });
      }),
  );

  it.effect(
    "keeps native customization while the web Template Workbench is off",
    () =>
      Effect.gen(function* () {
        const settings = { ...defaults, "server.workbench": false };
        const builtIn = yield* tabOver({ settings });
        expect(buttonLabels(documentRow(builtIn.ctx))).toEqual([
          m.settings_profile_edit(),
        ]);

        const saved = yield* tabOver({ settings, vault: everyFile });
        expect(buttonLabels(documentRow(saved.ctx))).toEqual([
          m.settings_profile_document_restore(),
          m.settings_profile_edit(),
        ]);
      }),
  );

  it.effect(
    "keeps native Default customization and offers connected Profile customization",
    () =>
      Effect.gen(function* () {
        const { ctx, rebuilt, customize } = yield* tabOver({
          profile: { profiles: Effect.succeed([BOOKS]) },
        });
        const { defaultRow, profileRow } = pageRows(ctx);

        expect(extraButtonTooltips(defaultRow)).toEqual([
          m.workbench_more_actions(),
        ]);
        expect(extraButtonTooltips(profileRow)).toEqual([
          m.workbench_more_actions(),
        ]);
        expect(buttonLabels(defaultRow)).toContain(m.settings_profile_edit());

        // The row opens its own Profile through the configured workbench launcher.
        customizeButton(profileRow).click();
        yield* Queue.take(rebuilt);
        expect(customize).toHaveBeenCalledWith({ profileId: books });
      }),
  );

  it.effect("keeps More actions available while web access is off", () =>
    Effect.gen(function* () {
      const { ctx } = yield* tabOver({
        profile: { profiles: Effect.succeed([BOOKS]) },
        settings: { ...defaults, "server.workbench": false },
      });
      const { defaultRow, profileRow } = pageRows(ctx);

      expect(extraButtonTooltips(defaultRow)).toEqual([
        m.workbench_more_actions(),
      ]);
      expect(extraButtonTooltips(profileRow)).toEqual([
        m.workbench_more_actions(),
      ]);
    }),
  );

  it.effect(
    "withholds both ways in while a Profile write would race the load",
    () =>
      Effect.gen(function* () {
        const { ctx } = yield* tabOver({
          profile: { loaded: Effect.succeed(false) },
        });
        const profiles = list(
          profilesPage(ctx),
          m.settings_profile_other_heading(),
        );
        expect(profiles.addItem).toBeUndefined();
        expect(profiles.extraButtons).toBeUndefined();
      }),
  );

  it.effect("writes only default bindings through the settings controls", () =>
    Effect.gen(function* () {
      const { ctx, settings } = yield* tabOver();
      expect(
        ctx.tab.sync(profileControlValue("note-profile:default:folder")),
      ).toBe("literatures");
      ctx.tab.sync(
        setProfileControlValue("note-profile:default:folder", "Reading"),
      );
      expect(
        settings.updateDefaultLiteratureNoteProfileBindings,
      ).toHaveBeenCalledWith({ "note.literature-folder": "Reading" });
    }),
  );
});

it.effect(
  "warns once about repeated IDs and lists each excluded file with its own actions",
  () =>
    Effect.gen(function* () {
      using confirmation = answerConfirmation(true);
      const paths = [
        "templates/zotlit-profile.one.md",
        "templates/zotlit-profile.two.md",
      ];
      const trashFile = vi.fn(() => Effect.void);
      const { ctx, rebuilt } = yield* tabOver({
        profile: {
          diagnostics: Effect.succeed(
            paths.map((path) => ({
              code: "duplicate-profile-id" as const,
              path,
              paths,
              message: "Repeated ID",
            })),
          ),
        },
        vault: everyFile,
        fileManager: { trashFile },
      });
      const page = profilesPage(ctx);
      const banners = page.items!.filter(
        (row) =>
          "name" in row && row.name === m.settings_profile_duplicate_id_name(),
      );
      expect(banners).toHaveLength(1);
      const banner = banners[0]!;
      // The guidance reads as a warning, so the fix is not mistaken for a setting.
      const desc = (banner as { desc: DocumentFragment }).desc;
      expect(desc.textContent).toBe(m.settings_profile_duplicate_banner());
      expect(
        (desc.firstElementChild as HTMLElement).classList.contains(
          "mod-warning",
        ),
      ).toBe(true);

      const excluded = list(page, m.settings_profile_excluded_heading());
      renderRow(excluded.items![0]!)
        .components.filter((control) => control instanceof ExtraButtonComponent)
        .find((button) => button.tooltip === m.settings_template_open())!
        .click();
      yield* Queue.take(rebuilt);
      expect(openNativeProfile).toHaveBeenCalledWith(
        expect.objectContaining({ path: paths[0] }),
        { customize: true },
      );

      // Deleting is the list's own affordance, addressed by row index.
      excluded.onDelete!(1);
      yield* Queue.take(rebuilt);
      expect(trashFile).toHaveBeenCalledWith(
        expect.objectContaining({ path: paths[1] }),
      );
      expect(confirmation.opened).toHaveBeenCalledOnce();
    }),
);

it.effect(
  "collects a destination before creating a Profile and cancels without a write",
  () =>
    Effect.gen(function* () {
      const create = vi.fn(() => Effect.succeed(BOOKS));
      const resolved = profileReader().resolveProfile("default")!;
      const plan: ProfileCreation = {
        profile: resolved,
        source: "",
        inherited: [],
        constraint: {
          kind: "invalid-name",
          message: m.settings_profile_name_invalid(),
        },
        create,
      };
      const { ctx, rebuilt } = yield* tabOver({
        profile: {
          resolveProfile: () => Effect.succeed(resolved),
          prepareCreate: () => Effect.succeed(plan),
        },
      });
      const profiles = list(
        profilesPage(ctx),
        m.settings_profile_other_heading(),
      );
      const before = Modal.instances.length;
      profiles.addItem!.action(document.createElement("div"));
      yield* until(() => Modal.instances.length > before);
      const modal = Modal.instances.at(-1)!;
      modal.onOpen();
      expect(modal.title).toBe(m.settings_profile_add());
      expect(modal.contentEl.textContent).toContain(
        m.settings_profile_name_name(),
      );
      expect(modal.contentEl.textContent).toContain(
        m.settings_profile_folder_name(),
      );
      modal.close();
      modal.onClose();
      yield* Queue.take(rebuilt);
      expect(create).not.toHaveBeenCalled();
      expect(openTemplateWorkbench).not.toHaveBeenCalled();
    }),
);

it.effect("asks the import flow for its own source", () =>
  Effect.gen(function* () {
    using opened = vi.spyOn(SuggestModal.prototype, "open");
    const { ctx } = yield* tabOver();
    const profiles = list(
      profilesPage(ctx),
      m.settings_profile_other_heading(),
    );

    const button = new ExtraButtonComponent(document.createElement("div"));
    profiles.extraButtons![0]!(button as unknown as ObsidianExtraButton);
    expect(button.tooltip).toBe(m.command_import_profile_name());
    button.click();
    yield* eventually(() => expect(opened).toHaveBeenCalledOnce());
  }),
);
