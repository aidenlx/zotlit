import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { it as effectIt } from "@effect/vitest";
import {
  ButtonComponent,
  ExtraButtonComponent,
  Menu,
  Modal,
  TextComponent,
  ToggleComponent,
  settingsOf,
  renderRow,
} from "@mock/obsidian";
import { Effect, Fiber, Layer } from "effect";
// @vitest-environment happy-dom
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

import { TemplateFacade } from "@zotlit/templates/facade";

import { eventually, until } from "@/lib/__fixtures__/eventually";
import { testNotifier } from "@/lib/__fixtures__/notifier";
import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import type { ProfileId } from "@/lib/profile-stamp";
import * as nativeDialog from "@/lib/require";
import { profileServiceFixture } from "@/services/profile/__fixtures__/service";

import { scopedSettingTab } from "./__fixtures__";
import type { SettingTabContext } from "./context";
import { shareProfile } from "./profile-dialogs";
import { profilesPage } from "./profiles";
import { ShareProfileModal } from "./share-profile-modal";
import type { ShareOutput } from "./share-profile-modal";

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
--- zotlit:annotation ---\nAnnotation`;

function dialogWith(
  showSaveDialog: ReturnType<
    typeof nativeDialog.requireDialog
  >["showSaveDialog"],
): ReturnType<typeof nativeDialog.requireDialog> {
  return stubService<ReturnType<typeof nativeDialog.requireDialog>>("Dialog", {
    showSaveDialog,
  });
}

/** A Share output that records what each button hands it. */
function recordedOutput() {
  const share = vi.fn<ShareOutput>(async () => {});
  return Object.assign(share, {
    /** The bundles handed to `destination`, in order. */
    sent: (destination: "clipboard" | "file") =>
      share.mock.calls
        .filter(([to]) => to === destination)
        .map(([, source]) => source),
  });
}

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

it("edits share metadata, bumps the version, and hands both destinations the same bundle without changing the vault", async () => {
  await using f = await profileServiceFixture({
    "templates/zotlit-profile.books.md": source,
    "templates/zotlit-partial.summary.md": "Shared summary",
  });
  const before = new Map(f.vault.contents);
  const share = recordedOutput();
  const modal = new ShareProfileModal(
    f.app,
    await f.profile.prepareShare(id),
    share,
  );
  modal.contentEl = document.createElement("div");
  using controls = observeControls(modal.contentEl);
  modal.onOpen();
  expect(controls.toggle(m.profile_share_folders()).getValue()).toBe(false);
  expect(controls.toggle("summary").getValue()).toBe(true);
  controls.click(m.profile_share_bump());
  controls.type(m.profile_share_author(), "Research group");
  controls.type(m.profile_share_description(), "Revised notes");
  await controls.click(m.profile_share_copy());
  const output = share.sent("clipboard")[0]!;
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
  expect(share.sent("file")).toEqual([output]);
  controls.toggle(m.profile_share_folders()).toggle(true);
  await controls.click(m.profile_share_copy());
  expect(
    new TemplateFacade().parseLiteratureNoteTemplate(
      share.sent("clipboard")[1]!,
    ).manifest,
  ).toMatchObject({
    folder: "Books",
    importFolder: "Imported",
  });
  expect(f.vault.contents).toEqual(before);
  modal.onClose();
});

it("keeps an empty version inline and hands nothing over until it is valid", async () => {
  await using f = await profileServiceFixture();
  const share = recordedOutput();
  const modal = new ShareProfileModal(
    f.app,
    await f.profile.prepareShare("default"),
    share,
  );
  modal.contentEl = document.createElement("div");
  using controls = observeControls(modal.contentEl);
  modal.onOpen();
  controls.type(m.profile_share_version(), "");
  expect(modal.contentEl.textContent).toContain(
    m.profile_share_version_required(),
  );
  await controls.click(m.profile_share_copy());
  expect(share).not.toHaveBeenCalled();
  controls.type(m.profile_share_version(), "1.0.0");
  await controls.click(m.profile_share_save());
  expect(share).toHaveBeenCalledOnce();
  expect(f.vault.contents.size).toBe(0);
  modal.onClose();
});

effectIt.effect.each(["default", id] as const)(
  "opens Share from the %s settings row",
  (selector) =>
    Effect.gen(function* () {
      const f = yield* Effect.acquireDisposable(
        Effect.promise(() =>
          profileServiceFixture({
            "templates/zotlit-profile.books.md": source,
            "templates/zotlit-partial.summary.md": "Shared summary",
          }),
        ),
      );
      const opened = yield* Effect.acquireDisposable(
        Effect.sync(() => vi.spyOn(Modal.prototype, "open")),
      );
      const services = yield* Effect.promise(() => f.runtime.context());
      const page = profilesPage(
        stubService<SettingTabContext>("SettingTabContext", {
          tab: (yield* scopedSettingTab(services)).tab,
          app: f.app,
          settings: stubService<SettingTabContext["settings"]>("Settings", {
            current: f.settings.current,
          }),
        }),
      );
      const label =
        selector === "default" ? m.settings_profile_default_name() : "Books";
      // Default sits on the page itself; every other Profile is a list row.
      const rows = page.items!.flatMap((item) =>
        "type" in item && item.type === "list" ? (item.items ?? []) : [item],
      );
      const row = rows.find((item) => "name" in item && item.name === label);
      if (!row) throw new Error("Profile row missing");
      const setting = renderRow(row);
      const more = setting.components
        .filter((control) => control instanceof ExtraButtonComponent)
        .find((button) => button.tooltip === m.workbench_more_actions())!;
      Object.assign(more, {
        extraSettingsEl: document.createElement("button"),
      });
      more.click();
      Menu.instances
        .at(-1)!
        .items.find((item) => item.title === m.settings_profile_share())!
        .click();
      yield* eventually(() => expect(opened).toHaveBeenCalledOnce());
      const modal = Modal.instances.at(-1)!;
      expect(modal).toBeInstanceOf(ShareProfileModal);
      modal.onOpen();
      expect(modal.title).toBe(m.profile_share_title({ label }));
      modal.onClose();
    }),
);

it.each([true, false])(
  "shares the checkbox choice as exact text with includeMatch=%s",
  async (includeMatch) => {
    const prefix = `---
# Keep sender formatting
id: Bk3Qn7XvT2Lp
name: 'Books'
version: 1.0.0
contract: 2
filename: '{{ zt.title }}'
folder: Books
importFolder: Imported
citationStyle: null
importColoredHighlights: false
importAnnotationsAsTemplate: false
`;
    const match = `match: 'collections.within("Unknown/Reading")'\n`;
    const suffix = `---
{% managed %}Body{% endmanaged %}
--- zotlit:annotation ---
Annotation`;
    const original = prefix + match + suffix;
    await using f = await profileServiceFixture({
      "templates/zotlit-profile.books.md": original,
    });
    const share = recordedOutput();
    const modal = new ShareProfileModal(
      f.app,
      await f.profile.prepareShare(id),
      share,
    );
    modal.contentEl = document.createElement("div");
    using controls = observeControls(modal.contentEl);
    modal.onOpen();
    expect(controls.toggle(m.profile_share_include_match()).getValue()).toBe(
      true,
    );
    controls.toggle(m.profile_share_folders()).toggle(true);
    if (!includeMatch)
      controls.toggle(m.profile_share_include_match()).toggle(false);
    await controls.click(m.profile_share_copy());
    await controls.click(m.profile_share_save());
    const expected = prefix + (includeMatch ? match : "") + suffix;
    expect(share.sent("clipboard")).toEqual([expected]);
    expect(share.sent("file")).toEqual([expected]);
    expect(f.vault.contents.get("templates/zotlit-profile.books.md")).toBe(
      original,
    );
    modal.onClose();
  },
);

it("checks the partials the profile calls, and drops one the reader clears", async () => {
  await using f = await profileServiceFixture({
    "templates/zotlit-profile.books.md": source.replace(
      '{% render "summary" %}',
      '{% render "authors" %}',
    ),
    "templates/zotlit-partial.authors.md": "{{ zt.creators }}",
    "templates/zotlit-partial.venue-line.md": "{{ zt.publicationTitle }}",
  });
  const share = recordedOutput();
  const modal = new ShareProfileModal(
    f.app,
    await f.profile.prepareShare(id),
    share,
  );
  modal.contentEl = document.createElement("div");
  using controls = observeControls(modal.contentEl);
  modal.onOpen();
  expect(controls.toggle("authors").getValue()).toBe(true);
  expect(controls.toggle("venue-line").getValue()).toBe(false);

  // Checked: the call is answered inside the one shared file.
  controls.toggle("venue-line").toggle(true);
  await controls.click(m.profile_share_copy());
  expect(
    new TemplateFacade()
      .parseLiteratureNoteTemplate(share.sent("clipboard")[0]!)
      .manifest.partials?.map(({ name }) => name),
  ).toEqual(["authors", "venue-line"]);

  // Cleared: the recipient gets nothing for that name.
  controls.toggle("venue-line").toggle(false);
  controls.toggle("authors").toggle(false);
  await controls.click(m.profile_share_copy());
  expect(
    new TemplateFacade().parseLiteratureNoteTemplate(
      share.sent("clipboard")[1]!,
    ).manifest.partials,
  ).toBeUndefined();
  modal.onClose();
});

it("shares after missing-partial recovery creates an empty document", async () => {
  await using f = await profileServiceFixture({
    "templates/zotlit-profile.books.md": source,
    "templates/zotlit-partial.summary.md": "",
  });

  const plan = await f.profile.prepareShare(id);
  const shared = new TemplateFacade().parseLiteratureNoteTemplate(
    plan.render({
      version: "1.2.3",
      author: "",
      description: "",
      partials: ["summary"],
    }),
  );

  expect(shared.manifest.partials).toEqual([
    { name: "summary", language: "liquid", source: "" },
  ]);
});

it("opens for a profile whose call no document answers, and names it", async () => {
  // Story 43 leaves this behind: the reader renamed the partial file and the
  // call in the profile still spells the old name.
  await using f = await profileServiceFixture({
    "templates/zotlit-profile.books.md": source,
    "templates/zotlit-partial.venue-line.md": "{{ zt.publicationTitle }}",
  });
  const plan = await f.profile.prepareShare(id);

  expect(plan.missing).toEqual(["summary"]);
  expect(plan.reachable).toEqual([]);
  expect(plan.partials).toEqual(["venue-line"]);

  const modal = new ShareProfileModal(f.app, plan, recordedOutput());
  modal.contentEl = document.createElement("div");
  using controls = observeControls(modal.contentEl);
  modal.onOpen();

  expect(modal.contentEl.textContent).toContain(
    m.profile_share_missing_partials({ names: "summary" }),
  );
  expect(controls.toggle("venue-line").getValue()).toBe(false);
  modal.onClose();
});

/**
 * The Share dialog over a Profile service fixture, started as the settings
 * row starts it, and drawn. `answer` answers the save dialog with a path in
 * the case's own folder.
 */
const sharing = Effect.fnUntraced(function* (
  answer: (
    folder: string,
  ) => Promise<{ canceled: boolean; filePath: string }> = async () => ({
    canceled: true,
    filePath: "",
  }),
) {
  const f = yield* Effect.acquireDisposable(
    Effect.promise(() =>
      profileServiceFixture({
        "templates/zotlit-profile.books.md": source,
        "templates/zotlit-partial.summary.md": "Shared summary",
      }),
    ),
  );
  const folder = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "zotlit-share-"))),
    (folder) =>
      Effect.promise(() => rm(folder, { recursive: true, force: true })),
  );
  const spy = <A extends Disposable>(acquire: () => A) =>
    Effect.acquireDisposable(Effect.sync(acquire));
  const clipboard = yield* spy(() =>
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(),
  );
  const showSaveDialog = vi.fn(() => answer(folder));
  yield* spy(() =>
    vi
      .spyOn(nativeDialog, "requireDialog")
      .mockReturnValue(dialogWith(showSaveDialog)),
  );
  const opened = yield* spy(() => vi.spyOn(Modal.prototype, "open"));
  const notifier = testNotifier();
  const services = yield* Effect.promise(() => f.runtime.context());
  const pending = yield* shareProfile(f.app, id).pipe(
    Effect.provideContext(services),
    Effect.provide(Layer.merge(notifier.layer, NodeFileSystem.layer)),
    Effect.forkChild({ startImmediately: true }),
  );
  yield* until(() => opened.mock.calls.length === 1);
  const modal = Modal.instances.at(-1)!;
  expect(modal).toBeInstanceOf(ShareProfileModal);
  const controls = yield* spy(() => observeControls(modal.contentEl));
  modal.onOpen();
  return {
    modal,
    controls,
    pending,
    clipboard,
    showSaveDialog,
    folder,
    notices: () => notifier.notices.map(({ messages }) => messages[0]),
  };
});

/** Press `label`, as the user does; the output it starts runs on. */
const press = (
  s: { controls: ReturnType<typeof observeControls> },
  label: string,
) => Effect.sync(() => void s.controls.click(label));

effectIt.effect(
  "copies the bundle and saves the same bytes to the file the user picks",
  () =>
    Effect.gen(function* () {
      let saved = "";
      const s = yield* sharing(async (folder) => {
        saved = join(folder, "Books.md");
        return { canceled: false, filePath: saved };
      });
      yield* press(s, m.profile_share_copy());
      yield* until(() => s.notices().length === 1);
      const output = s.clipboard.mock.calls[0]![0];
      yield* press(s, m.profile_share_save());
      yield* until(() => s.notices().length === 2);
      expect(yield* Effect.promise(() => readFile(saved, "utf8"))).toBe(output);
      expect(s.notices()).toEqual([
        m.profile_share_copied(),
        m.profile_share_saved({ file: "Books.md" }),
      ]);
      s.modal.onClose();
      yield* Fiber.join(s.pending);
    }),
);

effectIt.effect("cancels a save without writing or a notice", () =>
  Effect.gen(function* () {
    const s = yield* sharing();
    yield* press(s, m.profile_share_save());
    yield* until(() => s.showSaveDialog.mock.calls.length === 1);
    s.modal.onClose();
    yield* Fiber.join(s.pending);
    expect(yield* Effect.promise(() => readdir(s.folder))).toEqual([]);
    expect(s.notices()).toEqual([]);
  }),
);

effectIt.effect(
  "does not write when the Share sheet closes while the save dialog is open",
  () =>
    Effect.gen(function* () {
      const selection = Promise.withResolvers<{
        canceled: boolean;
        filePath: string;
      }>();
      const s = yield* sharing(() => selection.promise);
      yield* press(s, m.profile_share_save());
      yield* until(() => s.showSaveDialog.mock.calls.length === 1);
      s.modal.onClose();
      // The native save dialog holds the window until it answers; the closed
      // sheet's Scope then stops the output before it writes.
      selection.resolve({
        canceled: false,
        filePath: join(s.folder, "Default.md"),
      });
      yield* Fiber.join(s.pending);
      expect(yield* Effect.promise(() => readdir(s.folder))).toEqual([]);
      expect(s.notices()).toEqual([]);
    }),
);

effectIt.effect("tells the user when the clipboard refuses the bundle", () =>
  Effect.gen(function* () {
    const s = yield* sharing();
    s.clipboard.mockRejectedValueOnce(new Error("Clipboard unavailable"));
    yield* press(s, m.profile_share_copy());
    yield* until(() => s.notices().length === 1);
    expect(s.notices()).toEqual([m.profile_share_failed()]);
    s.modal.onClose();
    yield* Fiber.join(s.pending);
  }),
);
