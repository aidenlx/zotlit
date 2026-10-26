// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { ButtonComponent, Modal, controlsOf } from "@mock/obsidian";
import { Deferred, Effect, Fiber, Layer } from "effect";
import type { App } from "obsidian";
import { expect, vi } from "vitest";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { Vault } from "@/lib/obsidian-vault";
import type { ProfileId } from "@/lib/profile-stamp";
import { NoteFeature } from "@/services/note-feature/service";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import { profileServiceFixture } from "@/services/profile/__fixtures__/service";
import { Profile } from "@/services/profile/service";
import type { LiteratureNoteProfile } from "@/services/profile/service";
import { Template } from "@/services/template/service";

import { ProfileDestinationModal } from "./profile-destination-modal";
import { addProfileDestination, shareProfile } from "./profile-dialogs";
import { ShareProfileModal } from "./share-profile-modal";

const BOOKS: LiteratureNoteProfile = {
  id: "Bk3Qn7XvT2Lp" as ProfileId,
  label: "Books",
  document: "zotlit-profile.books.md",
  path: "templates/zotlit-profile.books.md",
  bindings: {},
  match: { state: "absent", summary: m.profile_match_absent() },
};

/** A spy that the case's Scope restores. */
const spy = <A extends Disposable>(acquire: () => A) =>
  Effect.acquireDisposable(Effect.sync(acquire));

/** Let the dialog's fiber and the Promises it waits on run until `done`. */
const until = Effect.fnUntraced(function* (done: () => boolean) {
  for (let turn = 0; turn < 1000 && !done(); turn++) yield* Effect.yieldNow;
  expect(done()).toBe(true);
});

/** The footer button labelled `label`. */
function footerButton(modal: Modal, label: string): ButtonComponent {
  const footer = modal.modalEl.querySelector<HTMLElement>(
    ".modal-button-container",
  )!;
  const button = controlsOf(footer).find(
    (control): control is ButtonComponent =>
      control instanceof ButtonComponent && control.text === label,
  );
  if (!button) throw new Error(`No ${label} button`);
  return button;
}

it.effect(
  "closes Add profile when its Scope ends during the save, and the started write finishes",
  () =>
    Effect.gen(function* () {
      const opened = yield* spy(() => vi.spyOn(Modal.prototype, "open"));
      const gate = yield* Deferred.make<void>();
      let written = false;
      // The Profile service owns the write: it runs on, and the dialog joins it.
      const write = yield* Effect.forkChild(
        Deferred.await(gate).pipe(
          Effect.andThen(
            Effect.sync(() => {
              written = true;
              return BOOKS;
            }),
          ),
        ),
      );
      let started = false;
      const reader = profileReader();
      const services = Layer.mergeAll(
        Layer.mock(Profile, {
          resolveProfile: () =>
            Effect.succeed(reader.resolveProfile("default")),
          prepareCreate: () =>
            Effect.succeed({
              profile: reader.resolveProfile("default")!,
              source: "",
              inherited: [],
              create: () =>
                Effect.suspend(() => {
                  started = true;
                  return Fiber.join(write);
                }),
            }),
        }),
        Layer.mock(Template, {}),
        Layer.mock(NoteFeature, {}),
        Layer.mock(Vault, {}),
        testNotifier().layer,
      );
      const pending = yield* addProfileDestination(
        stubService<App>("App", {}),
      ).pipe(
        Effect.provide(services),
        Effect.forkChild({ startImmediately: true }),
      );
      yield* until(() => opened.mock.calls.length === 1);
      const modal = Modal.instances.at(-1)!;
      expect(modal).toBeInstanceOf(ProfileDestinationModal);
      modal.onOpen();
      const add = footerButton(modal, m.settings_profile_add());
      yield* until(() => {
        add.click();
        return started;
      });
      yield* Fiber.interrupt(pending);
      expect(modal.isOpen).toBe(false);
      expect(written).toBe(false);
      yield* Deferred.succeed(gate, undefined);
      expect(yield* Fiber.join(write)).toBe(BOOKS);
      expect(written).toBe(true);
    }),
);

it.effect("keeps Share open until it closes, and an interrupt closes it", () =>
  Effect.gen(function* () {
    const opened = yield* spy(() => vi.spyOn(Modal.prototype, "open"));
    const f = yield* Effect.acquireRelease(
      Effect.promise(() => profileServiceFixture()),
      (f) => Effect.promise(() => f[Symbol.asyncDispose]()),
    );
    const services = yield* Effect.promise(() => f.runtime.context());
    const pending = yield* shareProfile(f.app, "default").pipe(
      Effect.provideContext(services),
      Effect.provide(testNotifier().layer),
      Effect.forkChild({ startImmediately: true }),
    );
    yield* until(() => opened.mock.calls.length === 1);
    const modal = Modal.instances.at(-1)!;
    expect(modal).toBeInstanceOf(ShareProfileModal);
    yield* Fiber.interrupt(pending);
    expect(modal.isOpen).toBe(false);
  }),
);
