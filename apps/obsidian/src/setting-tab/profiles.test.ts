// @vitest-environment happy-dom
import type { SettingDefinitionList, SettingDefinitionPage } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { confirm } from "@/lib/confirm";
import { defaults } from "@/services/settings/schema";

import type { SettingTabContext } from "./context";
import { literatureNoteProfileItems } from "./profiles";

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
  it("offers another literature note setup without showing the word Profile", () => {
    const createLiteratureNoteProfile = vi.fn();
    const requestUpdate = vi.fn();
    const items = literatureNoteProfileItems({
      settings: {
        current: defaults,
        createLiteratureNoteProfile,
      },
      requestUpdate,
    } as unknown as SettingTabContext);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      name: "Add another literature note setup",
      desc: "Use a different folder or citation style for some literature notes.",
    });
    expect(JSON.stringify(items).toLowerCase()).not.toContain("profile");

    const action = "action" in items[0]! ? items[0].action : undefined;
    if (!action) throw new Error("Add action missing");
    const blur = vi.fn();
    const el = { blur } as unknown as HTMLElement;
    action(el, 0);

    expect(blur).toHaveBeenCalled();
    expect(createLiteratureNoteProfile).toHaveBeenCalledWith("New profile");
    expect(requestUpdate).toHaveBeenCalled();
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
      desc: "Use profiles to give different literature notes their own folder and citation style.",
    });
    expect(page.items?.[0]).toMatchObject({
      name: "Default",
      desc: "Uses the main literature note folder and citation style.",
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
          displayValue: "Books · apa",
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
              name: "Citation style",
              control: {
                type: "text",
                key: `note-profile:${BOOKS.id}:citation-style`,
              },
            },
          ],
        },
      ],
    });
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
});
