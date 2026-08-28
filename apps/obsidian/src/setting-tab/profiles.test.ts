// @vitest-environment happy-dom
import type { SettingDefinitionList, SettingDefinitionPage } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { confirm } from "@/lib/confirm";
import { defaults } from "@/services/settings/schema";

import type { SettingTabContext } from "./context";
import {
  customizeLiteratureNoteProfile,
  getProfileControlValue,
  literatureNoteProfileItems,
  restoreBuiltInLiteratureNoteProfile,
  setProfileControlValue,
} from "./profiles";

vi.mock("@/lib/confirm", () => ({ confirm: vi.fn() }));

const BOOKS = {
  id: "36c4f8b4-4f65-4cab-8c51-c921ea616cc8",
  label: "Books",
  bindings: {
    "note.literature-folder": "Books",
    "citation.references-style": "apa",
  },
};

beforeEach(() => vi.clearAllMocks());

describe("literature note Profile settings", () => {
  it("always presents the default Profile and document state", () => {
    const items = literatureNoteProfileItems({
      settings: {
        current: defaults,
      },
    } as unknown as SettingTabContext);

    expect(items).toHaveLength(1);
    const page = items[0] as SettingDefinitionPage;
    expect(page).toMatchObject({
      type: "page",
      name: "Literature note profiles",
      items: [
        {
          type: "page",
          name: "Default",
          displayValue: "Built-in template",
          items: [
            {},
            {
              name: "Literature note folder",
              control: {
                type: "folder",
                key: "note-profile:default:folder",
              },
            },
            { name: "Citation and references style" },
            {
              name: "Imported note folder",
              control: {
                type: "folder",
                key: "note-profile:default:import-folder",
              },
            },
            {
              name: "Use colored highlight syntax",
              control: {
                type: "toggle",
                key: "note-profile:default:colored-highlights",
              },
            },
            {
              name: "Render annotations from template",
              control: {
                type: "toggle",
                key: "note-profile:default:annotations-as-template",
              },
            },
            {
              name: "Template document",
              desc: "Uses the built-in Literature Note Template.",
            },
          ],
        },
        { type: "list", heading: "Profiles" },
      ],
    });
  });

  it("shows a Profile list and declarative editor after a second Profile exists", () => {
    const settings = { ...defaults, "note.profiles": [BOOKS] };
    const items = literatureNoteProfileItems({
      settings: { current: settings },
    } as unknown as SettingTabContext);

    expect(items).toHaveLength(1);
    const page = items[0] as SettingDefinitionPage;
    expect(page).toMatchObject({
      type: "page",
      name: "Literature note profiles",
      desc: "Configure literature notes and notes imported from Zotero for each profile.",
    });
    expect(page.items?.[0]).toMatchObject({
      name: "Default",
      desc: "Sets the values that other profiles inherit.",
    });

    const list = page.items?.[1] as SettingDefinitionList;
    expect(list).toMatchObject({
      type: "list",
      heading: "Profiles",
      addItem: { name: "Add profile" },
      items: [
        {
          type: "page",
          name: "Books",
          displayValue: "Books · apa · Built-in template",
          items: [
            {
              name: "Name",
              control: {
                type: "text",
                key: `note-profile:${BOOKS.id}:label`,
              },
            },
            {
              name: "Literature note folder",
              control: {
                type: "folder",
                key: `note-profile:${BOOKS.id}:folder`,
              },
            },
            {
              name: "Use default profile citation style",
              control: {
                type: "toggle",
                key: `note-profile:${BOOKS.id}:citation-style-inherit`,
              },
            },
            {
              name: "Citation style",
              control: {
                type: "text",
                key: `note-profile:${BOOKS.id}:citation-style`,
              },
            },
            {
              name: "Imported note folder",
              control: {
                type: "folder",
                key: `note-profile:${BOOKS.id}:import-folder`,
              },
            },
            {
              name: "Use colored highlight syntax",
              control: {
                type: "dropdown",
                key: `note-profile:${BOOKS.id}:colored-highlights`,
              },
            },
            {
              name: "Render annotations from template",
              control: {
                type: "dropdown",
                key: `note-profile:${BOOKS.id}:annotations-as-template`,
              },
            },
            {
              name: "Template document",
              desc: "Uses the built-in Literature Note Template.",
            },
          ],
        },
      ],
    });
  });

  it("reports a missing referenced document in the Profile editor", () => {
    const settings = {
      ...defaults,
      "note.profiles": [{ ...BOOKS, document: "books.md" }],
    };
    const page = literatureNoteProfileItems({
      plugin: {
        services: {
          template: { getLiteratureNoteTemplateStatuses: () => [] },
        },
      },
      settings: { current: settings },
    } as unknown as SettingTabContext)[0] as SettingDefinitionPage;
    const list = page.items?.[1] as SettingDefinitionList;

    const profilePage = list.items?.[0] as SettingDefinitionPage;
    expect(profilePage).toMatchObject({
      displayValue: "Books · apa · books.md",
    });
    expect(profilePage.items?.at(-1)).toMatchObject({
      name: "Template document",
      desc: "The template document books.md is missing.",
    });
  });

  it("preserves inherit, built-in default, and named citation styles", () => {
    let profile = { ...BOOKS };
    const updateLiteratureNoteProfile = vi.fn(
      (_id: string, patch: Partial<typeof BOOKS>) => {
        profile = { ...profile, ...patch };
      },
    );
    const settings = {
      getLiteratureNoteProfile: () => profile,
      updateLiteratureNoteProfile,
    } as unknown as Parameters<typeof getProfileControlValue>[0];
    const inheritKey =
      `note-profile:${BOOKS.id}:citation-style-inherit` as const;
    const styleKey = `note-profile:${BOOKS.id}:citation-style` as const;

    expect(getProfileControlValue(settings, inheritKey)).toBe(false);
    expect(getProfileControlValue(settings, styleKey)).toBe("apa");

    setProfileControlValue(settings, inheritKey, true);
    expect(profile.bindings).not.toHaveProperty("citation.references-style");

    setProfileControlValue(settings, inheritKey, false);
    expect(profile.bindings?.["citation.references-style"]).toBeNull();

    setProfileControlValue(settings, styleKey, "ieee");
    expect(profile.bindings?.["citation.references-style"]).toBe("ieee");

    setProfileControlValue(settings, styleKey, "");
    expect(profile.bindings?.["citation.references-style"]).toBeNull();
  });

  it("edits and clears sparse Imported Note bindings", () => {
    let profile = {
      ...BOOKS,
      bindings: {
        ...BOOKS.bindings,
        "note.import-folder": "Books/Imported",
        "note.import-colored-highlights": true,
        "note.import-annotations-as-template": false,
      },
    };
    const settings = {
      getLiteratureNoteProfile: () => profile,
      updateLiteratureNoteProfile: (
        _id: string,
        patch: Partial<typeof profile>,
      ) => {
        profile = { ...profile, ...patch };
      },
    } as unknown as Parameters<typeof getProfileControlValue>[0];
    const key = (field: string) =>
      `note-profile:${BOOKS.id}:${field}` as Parameters<
        typeof getProfileControlValue
      >[1];

    expect(getProfileControlValue(settings, key("import-folder"))).toBe(
      "Books/Imported",
    );
    expect(getProfileControlValue(settings, key("colored-highlights"))).toBe(
      "enabled",
    );
    expect(
      getProfileControlValue(settings, key("annotations-as-template")),
    ).toBe("disabled");

    setProfileControlValue(settings, key("import-folder"), "");
    setProfileControlValue(settings, key("colored-highlights"), "inherit");
    setProfileControlValue(settings, key("annotations-as-template"), "enabled");

    expect(profile.bindings).not.toHaveProperty("note.import-folder");
    expect(profile.bindings).not.toHaveProperty(
      "note.import-colored-highlights",
    );
    expect(profile.bindings["note.import-annotations-as-template"]).toBe(true);
  });

  it("renders a referenced document while the template service starts", () => {
    const settings = {
      ...defaults,
      "note.profiles": [{ ...BOOKS, document: "books.md" }],
    };

    expect(() =>
      literatureNoteProfileItems({
        plugin: {
          services: {
            template: {
              getLiteratureNoteTemplateStatuses: () => {
                throw new Error("service is not ready");
              },
            },
          },
        },
        settings: { current: settings },
      } as unknown as SettingTabContext),
    ).not.toThrow();
  });

  it("deletes a Profile only after confirmation", async () => {
    vi.mocked(confirm).mockResolvedValue(true);
    const deleteLiteratureNoteProfile = vi.fn();
    const requestUpdate = vi.fn();
    const page = literatureNoteProfileItems({
      app: {},
      settings: {
        current: { ...defaults, "note.profiles": [BOOKS] },
        deleteLiteratureNoteProfile,
      },
      requestUpdate,
    } as unknown as SettingTabContext)[0] as SettingDefinitionPage;
    const list = page.items?.[1] as SettingDefinitionList;

    list.onDelete?.(0);
    await vi.waitFor(() => {
      expect(deleteLiteratureNoteProfile).toHaveBeenCalledWith(BOOKS.id);
    });
    expect(confirm).toHaveBeenCalledWith(
      {
        title: "Delete “Books” profile?",
        content:
          "Literature notes stamped with this profile cannot update until you re-stamp them or recreate this profile with the same ID.",
        action: "Delete profile",
        destructive: true,
      },
      {},
    );
    expect(requestUpdate).toHaveBeenCalled();
  });

  it("seeds a custom document and sets the Profile reference", async () => {
    const create = vi.fn(async (path: string, source: string) => ({
      path,
      source,
    }));
    const openFile = vi.fn(async () => {});
    const updateLiteratureNoteProfile = vi.fn();
    const requestUpdate = vi.fn();
    const ctx = {
      app: {
        vault: {
          getFileByPath: () => null,
          getAbstractFileByPath: () => null,
          createFolder: vi.fn(async () => ({})),
          create,
        },
        workspace: { getLeaf: () => ({ openFile }) },
      },
      settings: {
        current: { ...defaults, "note.profiles": [BOOKS] },
        updateLiteratureNoteProfile,
      },
      requestUpdate,
    } as unknown as SettingTabContext;

    await customizeLiteratureNoteProfile(ctx, BOOKS.id);

    expect(create).toHaveBeenCalledWith(
      `templates/literature-note-${BOOKS.id}.md`,
      expect.stringContaining("{% managed %}"),
    );
    expect(create.mock.calls[0]?.[1]).toContain(
      `id: zotlit.profile.${BOOKS.id}`,
    );
    expect(create.mock.calls[0]?.[1]).toContain("name: Books");
    expect(updateLiteratureNoteProfile).toHaveBeenCalledWith(BOOKS.id, {
      document: `literature-note-${BOOKS.id}.md`,
    });
    expect(openFile).toHaveBeenCalledOnce();
    expect(requestUpdate).toHaveBeenCalledOnce();
  });

  it("states the loss before replacing a colliding customization file", async () => {
    vi.mocked(confirm).mockResolvedValue(true);
    const file = { path: `templates/literature-note-${BOOKS.id}.md` };
    const modify = vi.fn(async () => {});
    const ctx = {
      app: {
        vault: {
          getFileByPath: () => file,
          modify,
        },
        workspace: { getLeaf: () => ({ openFile: vi.fn(async () => {}) }) },
      },
      settings: {
        current: { ...defaults, "note.profiles": [BOOKS] },
        updateLiteratureNoteProfile: vi.fn(),
      },
      requestUpdate: vi.fn(),
    } as unknown as SettingTabContext;

    await customizeLiteratureNoteProfile(ctx, BOOKS.id);

    expect(confirm).toHaveBeenCalledWith(
      {
        title: `Replace templates/literature-note-${BOOKS.id}.md?`,
        content:
          "Replace this file with the built-in Literature Note Template. All custom content in the file will be lost.",
        action: "Replace file",
        destructive: true,
      },
      ctx.app,
    );
    expect(modify).toHaveBeenCalledWith(
      file,
      expect.stringContaining("{% managed %}"),
    );
  });

  it("moves a custom document to trash before restoring the built-in", async () => {
    vi.mocked(confirm).mockResolvedValue(true);
    const file = { path: "templates/books.md" };
    const trashFile = vi.fn(async () => {});
    const updateLiteratureNoteProfile = vi.fn();
    const requestUpdate = vi.fn();
    const ctx = {
      app: {
        vault: { getFileByPath: () => file },
        fileManager: { trashFile },
      },
      settings: {
        current: defaults,
        getLiteratureNoteProfile: () => ({ ...BOOKS, document: "books.md" }),
        updateLiteratureNoteProfile,
      },
      requestUpdate,
    } as unknown as SettingTabContext;

    await restoreBuiltInLiteratureNoteProfile(ctx, BOOKS.id);

    expect(trashFile).toHaveBeenCalledWith(file);
    expect(updateLiteratureNoteProfile).toHaveBeenCalledWith(BOOKS.id, {
      document: null,
    });
    expect(requestUpdate).toHaveBeenCalledOnce();
  });
});
