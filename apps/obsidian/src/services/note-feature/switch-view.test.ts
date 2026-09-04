import { ButtonComponent, ConfirmationModal } from "obsidian";
import type { App, TFile } from "obsidian";
import { expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { ProfileId } from "@/lib/profile-stamp";
import { chooseLiteratureNoteProfile } from "@/views/quick-switch/profile-picker";

import { confirmProfileSwitch, switchNoteProfileInteractively } from "./index";

vi.mock("@/views/quick-switch/profile-picker", () => ({
  chooseLiteratureNoteProfile: vi.fn(),
}));

function observeDialog() {
  using stack = new DisposableStack();
  const observed = {
    title: stack.use(vi.spyOn(ConfirmationModal.prototype, "setTitle")),
    content: stack.use(vi.spyOn(ConfirmationModal.prototype, "setContent")),
    checkbox: stack.use(vi.spyOn(ConfirmationModal.prototype, "addCheckbox")),
    action: stack.use(vi.spyOn(ButtonComponent.prototype, "setButtonText")),
    click: stack.use(vi.spyOn(ButtonComponent.prototype, "onClick")),
    opened: stack.use(vi.spyOn(ConfirmationModal.prototype, "open")),
  };
  const resources = stack.move();
  return {
    ...observed,
    [Symbol.dispose]() {
      resources.dispose();
    },
  };
}

it("shows next-update consequences, real Imported Note count and both unchecked opt-ins", async () => {
  using dialog = observeDialog();
  const decision = confirmProfileSwitch({} as App, {
    current: "Books",
    requested: "Papers",
    moveFolder: "Papers",
    importedCount: 3,
  });
  expect(dialog.content).toHaveBeenCalledWith(
    `${m.modal_profile_switch_desc({ current: "Books", requested: "Papers" })} ${m.modal_profile_switch_effects()}`,
  );
  expect(dialog.checkbox.mock.calls.map(([label]) => label)).toEqual([
    m.modal_profile_switch_move({ folder: "Papers/" }),
    m.modal_profile_switch_imported_notes({ count: 3 }),
  ]);
  expect(dialog.action).toHaveBeenCalledWith(
    m.modal_profile_switch_confirm({ label: "Papers" }),
  );
  dialog.click.mock.calls[0]![0]({} as MouseEvent);
  await expect(decision).resolves.toEqual({
    confirmed: true,
    move: false,
    importedNotes: false,
  });
});

it("omits the move checkbox for the same folder and cancels without consent", async () => {
  using dialog = observeDialog();
  const decision = confirmProfileSwitch({} as App, {
    current: "Books",
    requested: "Papers",
    importedCount: 0,
  });
  expect(dialog.checkbox.mock.calls.map(([label]) => label)).toEqual([
    m.modal_profile_switch_imported_notes({ count: 0 }),
  ]);
  (dialog.opened.mock.instances[0] as ConfirmationModal).close();
  await expect(decision).resolves.toEqual({
    confirmed: false,
    move: false,
    importedNotes: false,
  });
});

it("states next-reimport consequences for Imported Note recovery without a family checkbox", async () => {
  using dialog = observeDialog();
  const decision = confirmProfileSwitch({} as App, {
    current: "Missing",
    requested: "Papers",
    importedCount: 0,
    imported: true,
  });
  expect(dialog.content).toHaveBeenCalledWith(
    `${m.modal_profile_switch_desc({ current: "Missing", requested: "Papers" })} ${m.modal_profile_switch_imported_effects()}`,
  );
  expect(dialog.checkbox).not.toHaveBeenCalled();
  (dialog.opened.mock.instances[0] as ConfirmationModal).close();
  await expect(decision).resolves.toMatchObject({ confirmed: false });
});

it("states the unavailable Imported Note lookup and offers only the Literature Note switch", async () => {
  using dialog = observeDialog();
  const decision = confirmProfileSwitch({} as App, {
    current: "Missing",
    requested: "Default",
    importedCount: null,
  });
  expect(dialog.content).toHaveBeenCalledWith(
    `${m.modal_profile_switch_desc({ current: "Missing", requested: "Default" })} ${m.modal_profile_switch_effects()}\n\n${m.modal_profile_switch_imported_unavailable()}`,
  );
  expect(dialog.checkbox).not.toHaveBeenCalled();
  dialog.click.mock.calls[0]![0]({} as MouseEvent);
  await expect(decision).resolves.toEqual({
    confirmed: true,
    move: false,
    importedNotes: false,
  });
});

it("marks the current Profile and applies the single dialog's move and Imported Note consent", async () => {
  using dialog = observeDialog();
  const current = "Bk3Qn7XvT2Lp" as ProfileId;
  const requested = "Rz9Wm4YfH6Kd" as ProfileId;
  const file = { path: "Books/My title.md" } as TFile;
  const imported = { path: "Imported/Child.md" } as TFile;
  const profiles = [
    {
      selector: requested,
      label: "Papers",
      folder: "Papers",
      citationStyle: null,
      document: undefined,
      path: "Papers/My title.md",
    },
  ];
  const switchProfile = vi.fn(async () => ({
    bodyUpdated: false,
    duplicateRegionCount: 0,
  }));
  vi.mocked(chooseLiteratureNoteProfile).mockResolvedValue({
    id: requested,
    label: "Papers",
  });
  const task = switchNoteProfileInteractively(
    {
      app: {} as App,
      createProfile: async () => undefined,
      importProfile: async () => undefined,
      zoteroPref: { dataDir: "" },
      noteFeature: {
        prepareProfileSwitch: async () => ({
          imported: false,
          current: { selector: current, label: "Books" },
          profiles,
          importedNotes: [imported],
        }),
        switchNoteProfile: switchProfile,
      },
    },
    file,
  );
  await vi.waitFor(() => expect(dialog.opened).toHaveBeenCalledOnce());
  expect(chooseLiteratureNoteProfile).toHaveBeenCalledWith(expect.anything(), {
    previews: profiles,
    current,
    preselected: current,
    styles: [],
    onNew: expect.any(Function),
    onImport: expect.any(Function),
  });
  expect(switchProfile).not.toHaveBeenCalled();
  for (const [, change] of dialog.checkbox.mock.calls) change(true);
  dialog.click.mock.calls[0]![0]({} as MouseEvent);
  await task;
  expect(switchProfile).toHaveBeenCalledWith(file, {
    profile: requested,
    move: true,
    importedNotes: [imported],
  });
});
