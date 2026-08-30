// @vitest-environment happy-dom
import { ButtonComponent, TextComponent } from "obsidian";
import type { App } from "obsidian";
import { expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { ProfileId } from "@/lib/profile-stamp";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import type { PreparedProfileCreation } from "@/services/profile/service";
import { defaults } from "@/services/settings/schema";

import { CreateProfileModal, renderProfileCreatedNotice } from "./profiles";
import type { ProfileCreationDeps } from "./profiles";

const id = "Bk3Qn7XvT2Lp" as ProfileId;
function fixture() {
  const profile = profileReader({
    ...defaults,
    profiles: [
      {
        id,
        label: "Reading",
        bindings: { "note.literature-folder": "Reading" },
      },
    ],
  }).resolveProfile(id)!;
  const create = vi.fn(async () => ({
    id,
    label: "Reading",
    document: "zotlit-profile.reading.md",
    path: "templates/zotlit-profile.reading.md",
    bindings: {},
  }));
  const draft: PreparedProfileCreation = {
    profile,
    source: "prepared source",
    inherited: ["citationStyle", "look"],
    create,
  };
  const prepareCreate = vi.fn(async () => draft);
  const update = vi.fn();
  const preview = {
    path: "Reading/Paper-7cx.md",
    properties: {
      "zotero-key": "ABCD2345",
      "zotlit-profile": "Reading (Bk3Qn7XvT2Lp)",
    },
    body: "# Paper\nDefault look marker.",
    create: vi.fn(),
  };
  const deps = {
    app: {} as App,
    profile: { ...profileReader(), prepareCreate },
    template: { prepareLiteratureNoteTemplateSource: () => ({}) },
    noteFeature: { prepareProfileNote: () => preview },
    settings: { update },
    zoteroPref: { dataDir: null },
    loadData: async () => null,
  } as unknown as ProfileCreationDeps;
  return { deps, draft, create, prepareCreate, update, preview };
}

it("shows the preview while refusing a no-op and a colliding label, then enables a differing draft", async () => {
  using changed = vi.spyOn(TextComponent.prototype, "onChange");
  using disabled = vi.spyOn(ButtonComponent.prototype, "setDisabled");
  const f = fixture();
  f.prepareCreate.mockResolvedValueOnce({
    ...f.draft,
    inherited: ["folder", "citationStyle", "look"],
    reason: m.settings_profile_create_no_difference(),
  });
  const modal = new CreateProfileModal(f.deps, {
    data: { note: {} as never, filename: {} },
    styles: [],
  });
  modal.contentEl = document.createElement("div");
  modal.onOpen();
  await vi.waitFor(() =>
    expect(modal.contentEl.textContent).toContain(
      m.settings_profile_create_no_difference(),
    ),
  );
  expect(disabled).toHaveBeenLastCalledWith(true);
  expect(modal.contentEl.textContent).toContain("Reading/Paper-7cx.md");
  expect(modal.contentEl.textContent).toContain("Reading (Bk3Qn7XvT2Lp)");
  expect(modal.contentEl.textContent).toContain("Default look marker.");
  f.prepareCreate.mockResolvedValueOnce({
    ...f.draft,
    reason: m.settings_profile_name_invalid(),
  });
  changed.mock.calls[0]![0]("Books");
  await vi.waitFor(() =>
    expect(modal.contentEl.textContent).toContain(
      m.settings_profile_name_invalid(),
    ),
  );
  expect(disabled).toHaveBeenLastCalledWith(true);
  changed.mock.calls[1]![0]("Reading");
  await vi.waitFor(() => expect(disabled).toHaveBeenLastCalledWith(false));
  expect(f.prepareCreate).toHaveBeenLastCalledWith({
    label: "Books",
    look: "default",
    bindings: { folder: "Reading" },
  });
  expect(modal.contentEl.textContent).toContain(
    m.settings_profile_inheritance({
      values: [
        m.settings_profile_citation_style_name(),
        m.settings_profile_look_name(),
      ].join(", "),
    }),
  );
  expect(f.create).not.toHaveBeenCalled();
  modal.onClose();
  await expect(modal.result).resolves.toBeUndefined();
});

it.each([false, true])(
  "keeps the prepared note handoff and offers last-used only from settings (context=%s)",
  async (useForNote) => {
    using clicked = vi.spyOn(ButtonComponent.prototype, "onClick");
    using label = vi.spyOn(ButtonComponent.prototype, "setButtonText");
    using disabled = vi.spyOn(ButtonComponent.prototype, "setDisabled");
    const f = fixture();
    const modal = new CreateProfileModal(f.deps, {
      data: { note: {} as never, filename: {} },
      styles: [],
      useForNote,
    });
    modal.contentEl = document.createElement("div");
    modal.onOpen();
    await vi.waitFor(() => expect(disabled).toHaveBeenLastCalledWith(false));
    expect(label).toHaveBeenCalledWith(
      useForNote ? m.settings_profile_create_use() : m.settings_profile_add(),
    );
    await clicked.mock.calls[0]![0]({} as MouseEvent);
    await expect(modal.result).resolves.toMatchObject({
      profile: { id },
      preview: f.preview,
    });
    expect(f.create).toHaveBeenCalledOnce();
    expect(f.preview.create).not.toHaveBeenCalled();
    if (useForNote) {
      expect(clicked).toHaveBeenCalledTimes(1);
    } else {
      expect(label).toHaveBeenCalledWith(m.profile_use_next_note());
      clicked.mock.calls[1]![0]({} as MouseEvent);
      expect(f.update).toHaveBeenCalledWith({ "note.last-used-profile": id });
    }
  },
);

it("renders the creation notice and applies its Use next action without opening the dialog", () => {
  using clicked = vi.spyOn(ButtonComponent.prototype, "onClick");
  using labeled = vi.spyOn(ButtonComponent.prototype, "setButtonText");
  const update = vi.fn();
  const fragment = renderProfileCreatedNotice(
    { id, label: "Reading" },
    { update },
  );
  expect(fragment.textContent).toContain(
    m.notice_profile_created({ label: "Reading" }),
  );
  expect(labeled).toHaveBeenCalledWith(m.profile_use_next_note());
  expect(update).not.toHaveBeenCalled();
  clicked.mock.calls[0]![0]({} as MouseEvent);
  expect(update).toHaveBeenCalledWith({ "note.last-used-profile": id });
});
