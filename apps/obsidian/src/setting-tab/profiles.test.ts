// @vitest-environment happy-dom
import type { SettingDefinitionPage } from "obsidian";
import { describe, expect, it, vi } from "vitest";

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
    expect(
      page.items?.some((item) => "type" in item && item.type === "page"),
    ).toBe(false);
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
          desc: expect.stringContaining("templates/zotlit-profile.original.md"),
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
