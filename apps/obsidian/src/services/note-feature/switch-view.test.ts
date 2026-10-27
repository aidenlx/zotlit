import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Layer } from "effect";
import { ButtonComponent, ConfirmationModal } from "obsidian";
import { TFile } from "obsidian";
import type { App } from "obsidian";
import { expect, vi } from "vitest";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { awaitModal } from "@/lib/effect-modal";
import * as m from "@/lib/i18n/generated/messages";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import type { ProfileId } from "@/lib/profile-stamp";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";
import { unimplementedProfileDialogServices } from "@/setting-tab/__fixtures__";
import { openLiteratureNoteProfile } from "@/views/quick-switch/profile-picker";

import {
  awaitProfileSwitchConsent,
  switchNoteProfileInteractively,
} from "./index";
import type { UpdateResult } from "./operations";
import { NoteFeature } from "./service";

vi.mock("@/views/quick-switch/profile-picker", () => ({
  openLiteratureNoteProfile: vi.fn(),
}));

/**
 * Record the consent dialog's calls. `shown` completes when the dialog
 * opens.
 */
function observeDialog() {
  using stack = new DisposableStack();
  const shown = Deferred.makeUnsafe<void>();
  const observed = {
    title: stack.use(vi.spyOn(ConfirmationModal.prototype, "setTitle")),
    content: stack.use(vi.spyOn(ConfirmationModal.prototype, "setContent")),
    checkbox: stack.use(vi.spyOn(ConfirmationModal.prototype, "addCheckbox")),
    action: stack.use(vi.spyOn(ButtonComponent.prototype, "setButtonText")),
    click: stack.use(vi.spyOn(ButtonComponent.prototype, "onClick")),
    opened: stack.use(
      vi.spyOn(ConfirmationModal.prototype, "open").mockImplementation(() => {
        Deferred.doneUnsafe(shown, Exit.void);
      }),
    ),
    closed: stack.use(vi.spyOn(ConfirmationModal.prototype, "close")),
  };
  const resources = stack.move();
  return {
    ...observed,
    shown,
    [Symbol.dispose]() {
      resources.dispose();
    },
  };
}

/** Open the consent dialog for `options` on a fiber of its own. */
const consentFor = (options: Parameters<typeof awaitProfileSwitchConsent>[1]) =>
  awaitProfileSwitchConsent(stubService<App>("App", {}), options).pipe(
    Effect.forkChild({ startImmediately: true }),
  );

it.effect(
  "shows next-update consequences, real Imported Note count and both unchecked opt-ins",
  () =>
    Effect.gen(function* () {
      using dialog = observeDialog();
      const decision = yield* consentFor({
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
      expect(yield* Fiber.join(decision)).toEqual({
        confirmed: true,
        move: false,
        importedNotes: false,
      });
    }),
);

it.effect(
  "omits the move checkbox for the same folder and cancels without consent",
  () =>
    Effect.gen(function* () {
      using dialog = observeDialog();
      const decision = yield* consentFor({
        current: "Books",
        requested: "Papers",
        importedCount: 0,
      });
      expect(dialog.checkbox.mock.calls.map(([label]) => label)).toEqual([
        m.modal_profile_switch_imported_notes({ count: 0 }),
      ]);
      (dialog.opened.mock.instances[0] as ConfirmationModal).close();
      expect(yield* Fiber.join(decision)).toEqual({
        confirmed: false,
        move: false,
        importedNotes: false,
      });
    }),
);

it.effect(
  "states next-reimport consequences for Imported Note recovery without a family checkbox",
  () =>
    Effect.gen(function* () {
      using dialog = observeDialog();
      const decision = yield* consentFor({
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
      expect(yield* Fiber.join(decision)).toMatchObject({ confirmed: false });
    }),
);

it.effect(
  "states the unavailable Imported Note lookup and offers only the Literature Note switch",
  () =>
    Effect.gen(function* () {
      using dialog = observeDialog();
      const decision = yield* consentFor({
        current: "Missing",
        requested: "Default",
        importedCount: null,
      });
      expect(dialog.content).toHaveBeenCalledWith(
        `${m.modal_profile_switch_desc({ current: "Missing", requested: "Default" })} ${m.modal_profile_switch_effects()}\n\n${m.modal_profile_switch_imported_unavailable()}`,
      );
      expect(dialog.checkbox).not.toHaveBeenCalled();
      dialog.click.mock.calls[0]![0]({} as MouseEvent);
      expect(yield* Fiber.join(decision)).toEqual({
        confirmed: true,
        move: false,
        importedNotes: false,
      });
    }),
);

it.effect("closes the consent dialog when the switch is interrupted", () =>
  Effect.gen(function* () {
    using dialog = observeDialog();
    const decision = yield* consentFor({
      current: "Books",
      requested: "Papers",
      importedCount: 0,
    });
    yield* Fiber.interrupt(decision);
    expect(dialog.closed).toHaveBeenCalledOnce();
  }),
);

const CURRENT = "Bk3Qn7XvT2Lp" as ProfileId;
const REQUESTED = "Rz9Wm4YfH6Kd" as ProfileId;
const PROFILES = [
  {
    selector: REQUESTED,
    label: "Papers",
    folder: "Papers",
    citationStyle: null,
    document: undefined,
    path: "Papers/2024/My title.md",
  },
];
const SWITCHED: UpdateResult = { bodyUpdated: false, duplicateRegionCount: 0 };

/** The switch's services over a note that holds `imported`. */
function switching(
  imported: TFile,
  switchNoteProfile: NoteFeature["Service"]["switchNoteProfile"],
) {
  return {
    layer: Layer.mergeAll(
      unimplementedProfileDialogServices,
      Layer.mock(NoteFeature, {
        prepareProfileSwitch: () =>
          Effect.succeed({
            imported: false,
            current: { selector: CURRENT, label: "Books" },
            profiles: PROFILES,
            importedNotes: [imported],
          }),
        switchNoteProfile,
      }),
      testNotifier().layer,
      Layer.mock(ZoteroPref, {
        current: Effect.succeed(
          stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", {
            dataDir: "",
          }),
        ),
      }),
      Layer.mock(MetadataCache, {
        fileCache: () =>
          Effect.succeed({ frontmatter: { "zotero-key": "ABCD2345" } }),
      }),
    ),
  };
}

const PORTS = {
  app: stubService<App>("App", {}),
  createProfile: () => Effect.undefined,
  importProfile: () => Effect.undefined,
};

/** The picker answers the requested Profile, as the user would. */
function pickRequested() {
  vi.mocked(openLiteratureNoteProfile).mockImplementation(
    (_app, _options, resolve) => {
      resolve({ id: REQUESTED, label: "Papers" });
      return { close: () => {} };
    },
  );
}

it.effect(
  "marks the current Profile, names the destination folder, and applies the single dialog's move and Imported Note consent",
  () =>
    Effect.gen(function* () {
      using dialog = observeDialog();
      const file = noteAt("Books/2024/My title.md");
      const imported = noteAt("Imported/Child.md");
      const switchProfile = vi.fn<NoteFeature["Service"]["switchNoteProfile"]>(
        () => Effect.succeed(SWITCHED),
      );
      const harness = switching(imported, switchProfile);
      pickRequested();
      const task = yield* switchNoteProfileInteractively(PORTS, file).pipe(
        Effect.provide(harness.layer),
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Deferred.await(dialog.shown);
      expect(dialog.opened).toHaveBeenCalledOnce();
      expect(openLiteratureNoteProfile).toHaveBeenCalledWith(
        PORTS.app,
        {
          previews: PROFILES,
          current: CURRENT,
          preselected: CURRENT,
          styles: [],
        },
        expect.any(Function),
      );
      expect(dialog.checkbox.mock.calls[0]![0]).toBe(
        m.modal_profile_switch_move({ folder: "Papers/2024/" }),
      );
      expect(switchProfile).not.toHaveBeenCalled();
      for (const [, change] of dialog.checkbox.mock.calls) change(true);
      dialog.click.mock.calls[0]![0]({} as MouseEvent);
      yield* Fiber.join(task);
      expect(switchProfile).toHaveBeenCalledWith(file, {
        profile: REQUESTED,
        move: true,
        importedNotes: [imported],
      });
    }),
);

it.effect(
  "lets a switch that has started finish before an interrupt ends the flow",
  () =>
    Effect.gen(function* () {
      using dialog = observeDialog();
      const started = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<void>();
      let finished = false;
      const harness = switching(noteAt("Imported/Child.md"), () =>
        Effect.uninterruptible(
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(gate)),
            Effect.andThen(
              Effect.sync(() => {
                finished = true;
              }),
            ),
            Effect.as(SWITCHED),
          ),
        ),
      );
      pickRequested();
      const task = yield* switchNoteProfileInteractively(
        PORTS,
        noteAt("Books/2024/My title.md"),
      ).pipe(
        Effect.provide(harness.layer),
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Deferred.await(dialog.shown);
      expect(dialog.opened).toHaveBeenCalledOnce();
      dialog.click.mock.calls[0]![0]({} as MouseEvent);
      yield* Deferred.await(started);

      const interrupting = yield* Fiber.interrupt(task).pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Effect.yieldNow;
      expect(finished).toBe(false);
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(interrupting);
      expect(finished).toBe(true);
    }),
);

it.effect.each(["new", "import"] as const)(
  "closes the %s Profile dialog the picker opened when the switch is interrupted",
  (action) =>
    Effect.gen(function* () {
      const opened = yield* Deferred.make<void>();
      const close = vi.fn();
      // The dialog stays open until something closes it.
      const dialog = awaitModal<undefined>(() => {
        Deferred.doneUnsafe(opened, Effect.void);
        return { close };
      });
      const switchNoteProfile = vi.fn<
        NoteFeature["Service"]["switchNoteProfile"]
      >(() => Effect.succeed(SWITCHED));
      const harness = switching(noteAt("Imported/Child.md"), switchNoteProfile);
      vi.mocked(openLiteratureNoteProfile).mockImplementation(
        (_app, _options, resolve) => {
          resolve({ action });
          return { close: () => {} };
        },
      );
      const task = yield* switchNoteProfileInteractively(
        { ...PORTS, createProfile: () => dialog, importProfile: () => dialog },
        noteAt("Books/2024/My title.md"),
      ).pipe(
        Effect.provide(harness.layer),
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Deferred.await(opened);
      yield* Fiber.interrupt(task);
      expect(close).toHaveBeenCalledOnce();
      expect(Exit.hasInterrupts(yield* Fiber.await(task))).toBe(true);
      expect(switchNoteProfile).not.toHaveBeenCalled();
    }),
);

function noteAt(path: string): TFile {
  const file = new TFile();
  file.path = path;
  return file;
}
