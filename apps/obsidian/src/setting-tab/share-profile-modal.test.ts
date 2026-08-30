import {
  ButtonComponent,
  Modal,
  Setting,
  TextComponent,
  ToggleComponent,
  settingsOf,
} from "@mock/obsidian";
// @vitest-environment happy-dom
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SettingDefinitionPage } from "obsidian";
import { expect, it, vi } from "vitest";

import { TemplateFacade } from "@zotlit/templates/facade";

import * as m from "@/lib/i18n/generated/messages";
import type { ProfileId } from "@/lib/profile-stamp";
import * as nativeDialog from "@/lib/require";
import { profileServiceFixture } from "@/services/profile/__fixtures__/service";

import type { SettingTabContext } from "./context";
import { ShareProfileModal, literatureNoteProfileItems } from "./profiles";

const id = "Bk3Qn7XvT2Lp" as ProfileId;
const source = `---
id: ${id}
name: Books
version: 1.2.3
contract: 2
filename: "{{ zt.title }}"
author: First author
description: Reading notes
folder: Books
importFolder: Imported
---
{% managed %}{% render "summary" %}{% endmanaged %}
{% annotation %}Annotation{% endannotation %}
`;

function observeControls(container: HTMLElement) {
  using stack = new DisposableStack();
  const labels = stack.use(
    vi.spyOn(ButtonComponent.prototype, "setButtonText"),
  );
  const clicks = stack.use(vi.spyOn(ButtonComponent.prototype, "onClick"));
  const cleanup = stack.move();
  return {
    type(label: string, value: string) {
      const row = settingsOf(container).find(({ name }) => name === label)!;
      row.components
        .find((control) => control instanceof TextComponent)!
        .type(value);
    },
    toggle(label: string) {
      const row = settingsOf(container).find(({ name }) => name === label)!;
      return row.components.find(
        (control) => control instanceof ToggleComponent,
      )!;
    },
    click(label: string) {
      const instance =
        labels.mock.instances[
          labels.mock.calls.findIndex(([text]) => text === label)
        ];
      return clicks.mock.calls[clicks.mock.instances.indexOf(instance)]![0](
        {} as MouseEvent,
      );
    },
    [Symbol.dispose]: () => cleanup.dispose(),
  };
}

it("edits share metadata, bumps the version, and writes identical file and clipboard bytes without changing the vault", async () => {
  await using stack = new AsyncDisposableStack();
  const f = stack.use(
    await profileServiceFixture({
      "templates/zotlit-profile.books.md": source,
      "templates/zotlit-summary.liquid.md": "Shared summary",
    }),
  );
  const before = new Map(f.vault.contents);
  const folder = await mkdtemp(join(tmpdir(), "zotlit-share-"));
  stack.defer(() => rm(folder, { recursive: true, force: true }));
  const filePath = join(folder, "Books.md");
  const clipboard = stack.use(
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(),
  );
  stack.use(
    vi.spyOn(nativeDialog, "requireDialog").mockReturnValue({
      showSaveDialog: async () => ({ canceled: false, filePath }),
    } as unknown as ReturnType<typeof nativeDialog.requireDialog>),
  );
  const modal = new ShareProfileModal(f.app, await f.profile.prepareShare(id));
  modal.contentEl = document.createElement("div");
  using controls = observeControls(modal.contentEl);
  modal.onOpen();
  expect(controls.toggle(m.profile_share_folders()).getValue()).toBe(false);
  expect(modal.contentEl.textContent).toContain(
    m.profile_share_partials({ names: "summary" }),
  );
  controls.click(m.profile_share_bump());
  controls.type(m.profile_share_author(), "Research group");
  controls.type(m.profile_share_description(), "Revised notes");
  await controls.click(m.profile_share_copy());
  const output = clipboard.mock.calls[0]![0];
  const parsed = new TemplateFacade().parseLiteratureNoteTemplate(output);
  expect(parsed.manifest).toMatchObject({
    id,
    version: "1.2.4",
    author: "Research group",
    description: "Revised notes",
    partials: [{ name: "summary", source: "Shared summary" }],
  });
  expect(parsed.manifest.folder).toBeUndefined();
  expect(parsed.manifest.importFolder).toBeUndefined();
  await controls.click(m.profile_share_save());
  expect(await readFile(filePath, "utf8")).toBe(output);
  controls.toggle(m.profile_share_folders()).toggle(true);
  await controls.click(m.profile_share_copy());
  expect(
    new TemplateFacade().parseLiteratureNoteTemplate(
      clipboard.mock.calls[1]![0],
    ).manifest,
  ).toMatchObject({
    folder: "Books",
    importFolder: "Imported",
  });
  expect(f.vault.contents).toEqual(before);
  modal.onClose();
});

it("keeps an empty version inline and cancels a save without writing", async () => {
  await using f = await profileServiceFixture();
  using clipboard = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockResolvedValue();
  using dialog = vi.spyOn(nativeDialog, "requireDialog").mockReturnValue({
    showSaveDialog: async () => ({ canceled: true }),
  } as unknown as ReturnType<typeof nativeDialog.requireDialog>);
  const modal = new ShareProfileModal(
    f.app,
    await f.profile.prepareShare("default"),
  );
  modal.contentEl = document.createElement("div");
  using controls = observeControls(modal.contentEl);
  modal.onOpen();
  controls.type(m.profile_share_version(), "");
  expect(modal.contentEl.textContent).toContain(
    m.profile_share_version_required(),
  );
  await controls.click(m.profile_share_copy());
  expect(clipboard).not.toHaveBeenCalled();
  controls.type(m.profile_share_version(), "1.0.0");
  await controls.click(m.profile_share_save());
  expect(dialog).toHaveBeenCalledOnce();
  expect(f.vault.contents.size).toBe(0);
  modal.onClose();
});

it.each(["default", id] as const)(
  "opens Share from the %s settings row",
  async (selector) => {
    await using f = await profileServiceFixture({
      "templates/zotlit-profile.books.md": source,
      "templates/zotlit-summary.liquid.md": "Shared summary",
    });
    using opened = vi.spyOn(Modal.prototype, "open");
    const container = document.createElement("div");
    using controls = observeControls(container);
    const page = literatureNoteProfileItems({
      ...f,
      requestUpdate: vi.fn(),
    } as unknown as SettingTabContext)[0] as SettingDefinitionPage;
    const label =
      selector === "default" ? m.settings_profile_default_name() : "Books";
    const row = page.items?.find(
      (item) => "name" in item && item.name === label,
    );
    if (!row || !("render" in row)) throw new Error("Profile row missing");
    row.render?.(new Setting(container) as never, {} as never);
    controls.click(m.settings_profile_share());
    await vi.waitFor(() => expect(opened).toHaveBeenCalledOnce());
    const modal = opened.mock.instances[0] as unknown as ShareProfileModal;
    expect(modal).toBeInstanceOf(ShareProfileModal);
    modal.contentEl = document.createElement("div");
    modal.onOpen();
    expect((modal as unknown as Modal).title).toBe(
      m.profile_share_title({ label }),
    );
    modal.onClose();
  },
);

it("does not write when the Share sheet closes while the save dialog is open", async () => {
  await using stack = new AsyncDisposableStack();
  const f = stack.use(await profileServiceFixture());
  const folder = await mkdtemp(join(tmpdir(), "zotlit-share-cancel-"));
  stack.defer(() => rm(folder, { recursive: true, force: true }));
  const filePath = join(folder, "Default.md");
  const selection = Promise.withResolvers<{
    canceled: boolean;
    filePath: string;
  }>();
  stack.use(
    vi.spyOn(nativeDialog, "requireDialog").mockReturnValue({
      showSaveDialog: () => selection.promise,
    } as unknown as ReturnType<typeof nativeDialog.requireDialog>),
  );
  const modal = new ShareProfileModal(
    f.app,
    await f.profile.prepareShare("default"),
  );
  modal.contentEl = document.createElement("div");
  using controls = observeControls(modal.contentEl);
  modal.onOpen();
  const pending = controls.click(m.profile_share_save());
  modal.onClose();
  selection.resolve({ canceled: false, filePath });
  await pending;
  await expect(readFile(filePath, "utf8")).rejects.toMatchObject({
    code: "ENOENT",
  });
});
