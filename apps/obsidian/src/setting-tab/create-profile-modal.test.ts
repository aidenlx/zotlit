// @vitest-environment happy-dom
import { ButtonComponent, TextComponent, controlsOf } from "@mock/obsidian";
import type { App } from "obsidian";
import { expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { ProfileId } from "@/lib/profile-stamp";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import type { PreparedProfileCreation } from "@/services/profile/service";
import { defaults } from "@/services/settings/schema";

import { CreateProfileModal } from "./profiles";
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
    match: { state: "absent" as const, summary: m.profile_match_absent() },
  }));
  const draft: PreparedProfileCreation = {
    profile,
    source: "prepared source",
    inherited: ["citationStyle", "look"],
    create,
  };
  const prepareCreate = vi.fn(async () => draft);
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
    zoteroPref: { dataDir: null },
    loadData: async () => null,
  } as unknown as ProfileCreationDeps;
  return { deps, draft, create, prepareCreate, preview };
}

it("shows the preview while refusing a no-op and a colliding label, then enables a differing draft", async () => {
  using disabled = vi.spyOn(ButtonComponent.prototype, "setDisabled");
  const saveDisabled = () =>
    disabled.mock.calls.findLast((_, index) => {
      const button = disabled.mock.instances[index];
      return (
        button instanceof ButtonComponent &&
        button.text === m.settings_profile_add()
      );
    })?.[0];
  const f = fixture();
  f.prepareCreate.mockResolvedValueOnce({
    ...f.draft,
    inherited: ["folder", "citationStyle", "look"],
    reason: "REFUSED_NO_DIFFERENCE",
  });
  const modal = new CreateProfileModal(f.deps, {
    data: { note: {} as never, filename: {} },
    styles: [],
  });
  modal.contentEl = document.createElement("div");
  modal.onOpen();
  await vi.waitFor(() =>
    expect(modal.contentEl.textContent).toContain("REFUSED_NO_DIFFERENCE"),
  );
  expect(saveDisabled()).toBe(true);
  expect(modal.contentEl.textContent).toContain("Reading/Paper-7cx.md");
  expect(modal.contentEl.textContent).toContain("Reading (Bk3Qn7XvT2Lp)");
  expect(modal.contentEl.textContent).toContain("Default look marker.");
  f.prepareCreate.mockResolvedValueOnce({
    ...f.draft,
    reason: "REFUSED_INVALID_NAME",
  });
  const text = (name: string) =>
    [...modal.contentEl.querySelectorAll<HTMLElement>("label")]
      .filter((label) => label.firstChild?.textContent === name)
      .flatMap((label) => controlsOf(label.lastElementChild as HTMLElement))
      .find((control) => control instanceof TextComponent)!;
  text(m.settings_profile_name_name()).type("Books");
  await vi.waitFor(() =>
    expect(modal.contentEl.textContent).toContain("REFUSED_INVALID_NAME"),
  );
  expect(saveDisabled()).toBe(true);
  text(m.settings_profile_folder_name()).type("Reading");
  await vi.waitFor(() => expect(saveDisabled()).toBe(false));
  expect(f.prepareCreate).toHaveBeenLastCalledWith({
    label: "Books",
    look: "default",
    bindings: { folder: "Reading" },
  });
  expect(modal.contentEl.textContent).toContain(
    m.settings_profile_citation_style_name(),
  );
  expect(modal.contentEl.textContent).toContain(m.settings_profile_look_name());
  expect(f.create).not.toHaveBeenCalled();
  modal.onClose();
  await expect(modal.result).resolves.toBeUndefined();
});

it.each([false, true])(
  "keeps the prepared note handoff and confirms a settings creation without a next-note action (context=%s)",
  async (useForNote) => {
    using label = vi.spyOn(ButtonComponent.prototype, "setButtonText");
    using disabled = vi.spyOn(ButtonComponent.prototype, "setDisabled");
    const saveLabel = useForNote
      ? m.settings_profile_create_use()
      : m.settings_profile_add();
    const saveDisabled = () =>
      disabled.mock.calls.findLast((_, index) => {
        const button = disabled.mock.instances[index];
        return button instanceof ButtonComponent && button.text === saveLabel;
      })?.[0];
    const f = fixture();
    const modal = new CreateProfileModal(f.deps, {
      data: { note: {} as never, filename: {} },
      styles: [],
      useForNote,
    });
    modal.contentEl = document.createElement("div");
    modal.onOpen();
    await vi.waitFor(() => expect(saveDisabled()).toBe(false));
    label.mock.instances
      .filter((button) => button instanceof ButtonComponent)
      .find((button) => button.text === saveLabel)!
      .click();
    await expect(modal.result).resolves.toMatchObject({
      profile: { id },
      preview: f.preview,
    });
    expect(f.create).toHaveBeenCalledOnce();
    expect(f.preview.create).not.toHaveBeenCalled();
    // The created Profile is handed to the caller's operation alone; besides
    // Cancel, the dialog offers no action that keeps it for a later note.
    expect(
      label.mock.instances
        .filter(
          (button): button is ButtonComponent =>
            button instanceof ButtonComponent && button.text !== saveLabel,
        )
        .map((button) => button.text),
    ).toEqual([m.modal_cancel()]);
  },
);
