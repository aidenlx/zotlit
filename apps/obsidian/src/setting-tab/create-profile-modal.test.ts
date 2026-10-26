// @vitest-environment happy-dom
import { ButtonComponent, TextComponent, controlsOf } from "@mock/obsidian";
import { Effect } from "effect";
import { TFile } from "obsidian";
import type { App } from "obsidian";
import { expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { AbortError } from "@/lib/abort-error";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import type { ProfileId } from "@/lib/profile-stamp";
import type { ProfileNoteDraft } from "@/services/note-feature/service";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import type { PreparedProfileCreation } from "@/services/profile/service";
import { defaults } from "@/services/settings/schema";

import { CreateProfileModal } from "./create-profile-modal";
import type { ProfileCreationDeps } from "./create-profile-modal";

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
  // The note write the dialog hands over; the dialog itself never runs it.
  const writes = { count: 0 };
  const preview: ProfileNoteDraft = {
    path: "Reading/Paper-7cx.md",
    properties: {
      "zotero-key": "ABCD2345",
      "zotlit-profile": "Reading (Bk3Qn7XvT2Lp)",
    },
    body: "# Paper\nDefault look marker.",
    create: Effect.sync(() => {
      writes.count += 1;
      return { outcome: "created" as const, file: new TFile() };
    }),
  };
  const reader = profileReader();
  const deps: ProfileCreationDeps = {
    app: stubService<App>("App", {}),
    base: reader.resolveProfile("default")!,
    profiles: reader.profiles,
    prepareCreate,
    previewNote: async () => preview,
  };
  return { deps, draft, create, prepareCreate, preview, writes };
}

it("shows the preview while asking for a name, refuses a colliding label, then enables a name with no other difference", async () => {
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
  const inheritsAll = {
    ...f.draft,
    inherited: ["folder", "citationStyle", "look"],
  } satisfies PreparedProfileCreation;
  f.prepareCreate.mockResolvedValueOnce({
    ...inheritsAll,
    constraint: { kind: "invalid-name", message: "ASK_FOR_NAME" },
  });
  const modal = new CreateProfileModal(f.deps, { styles: [] });
  modal.contentEl = document.createElement("div");
  modal.onOpen();
  const status = () => modal.contentEl.querySelector('[role="status"]')!;
  await vi.waitFor(() => expect(status().textContent).toBe("ASK_FOR_NAME"));
  expect(status().classList.contains("zt:text-(--text-error)")).toBe(false);
  expect(saveDisabled()).toBe(true);
  expect(modal.contentEl.textContent).toContain("Reading/Paper-7cx.md");
  expect(modal.contentEl.textContent).toContain("Reading (Bk3Qn7XvT2Lp)");
  expect(modal.contentEl.textContent).toContain("Default look marker.");
  f.prepareCreate.mockResolvedValueOnce({
    ...inheritsAll,
    constraint: { kind: "invalid-name", message: "REFUSED_INVALID_NAME" },
  });
  const text = (name: string) =>
    [...modal.contentEl.querySelectorAll<HTMLElement>("label")]
      .filter((label) => label.firstChild?.textContent === name)
      .flatMap((label) => controlsOf(label.lastElementChild as HTMLElement))
      .find((control) => control instanceof TextComponent)!;
  text(m.settings_profile_name_name()).type("Reading");
  await vi.waitFor(() =>
    expect(status().textContent).toBe("REFUSED_INVALID_NAME"),
  );
  expect(status().classList.contains("zt:text-(--text-error)")).toBe(true);
  expect(saveDisabled()).toBe(true);
  f.prepareCreate.mockResolvedValueOnce(inheritsAll);
  text(m.settings_profile_name_name()).type("Books");
  await vi.waitFor(() => expect(saveDisabled()).toBe(false));
  expect(f.prepareCreate).toHaveBeenLastCalledWith({
    label: "Books",
    look: "default",
    bindings: {},
  });
  expect(modal.contentEl.textContent).toContain(
    m.settings_profile_inheritance({
      values: [
        m.settings_profile_folder_name(),
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
    const modal = new CreateProfileModal(f.deps, { styles: [], useForNote });
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
    expect(f.writes.count).toBe(0);
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

it("says nothing when the dialog's Scope stops the save", async () => {
  using label = vi.spyOn(ButtonComponent.prototype, "setButtonText");
  using disabled = vi.spyOn(ButtonComponent.prototype, "setDisabled");
  using failed = vi.spyOn(getLogger(["setting-tab", "profiles"]), "error");
  const saveDisabled = () =>
    disabled.mock.calls.findLast((_, index) => {
      const button = disabled.mock.instances[index];
      return (
        button instanceof ButtonComponent &&
        button.text === m.settings_profile_add()
      );
    })?.[0];
  const f = fixture();
  f.create.mockRejectedValueOnce(new AbortError());
  const modal = new CreateProfileModal(f.deps, { styles: [] });
  modal.contentEl = document.createElement("div");
  modal.onOpen();
  await vi.waitFor(() => expect(saveDisabled()).toBe(false));
  label.mock.instances
    .filter((button) => button instanceof ButtonComponent)
    .find((button) => button.text === m.settings_profile_add())!
    .click();
  await vi.waitFor(() => expect(f.create).toHaveBeenCalledOnce());
  // The modal waited on the save first, so its catch has run once this one
  // does.
  await f.create.mock.results[0]!.value.catch(() => {});
  expect(failed).not.toHaveBeenCalled();
  expect(modal.contentEl.querySelector('[role="status"]')!.textContent).toBe(
    "",
  );
});
