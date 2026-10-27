// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Layer } from "effect";
import { SuggestModal } from "obsidian";
import type { App } from "obsidian";
import { expect, vi } from "vitest";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { awaitModal } from "@/lib/effect-modal";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";
import { unimplementedProfileDialogServices } from "@/setting-tab/__fixtures__";

import { chooseBatchProfile } from "./batch-profile-choice";

/** The batch choice's services: no Zotero data folder. */
function services() {
  return {
    layer: Layer.mergeAll(
      unimplementedProfileDialogServices,
      testNotifier().layer,
      Layer.mock(ZoteroPref, {
        current: Effect.succeed(
          stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", {
            dataDir: "",
          }),
        ),
      }),
    ),
  };
}

const app = stubService<App>("App", {
  keymap: stubService<App["keymap"]>("Keymap", {
    pushScope: vi.fn(),
    popScope: vi.fn(),
  }),
});

/** Answer the open picker with its New profile row or its Import button. */
const answerPicker = Effect.fnUntraced(function* (
  modal: SuggestModal<unknown>,
  action: "new" | "import",
) {
  const rows = yield* Effect.promise(async () => modal.getSuggestions(""));
  const last = rows.at(-1)!;
  if (action === "new") {
    modal.onChooseSuggestion(last, new KeyboardEvent("keydown"));
    return;
  }
  const el = document.createElement("div");
  modal.renderSuggestion(last, el);
  el.querySelector("button")!.click();
});

it.effect.each(["new", "import"] as const)(
  "closes the %s Profile dialog the batch picker opened when the choice is interrupted",
  (action) =>
    Effect.gen(function* () {
      using opened = vi.spyOn(SuggestModal.prototype, "open");
      const dialogOpened = yield* Deferred.make<void>();
      const close = vi.fn();
      // The dialog stays open until something closes it.
      const dialog = awaitModal<undefined>(() => {
        Deferred.doneUnsafe(dialogOpened, Effect.void);
        return { close };
      });
      const harness = services();
      const choice = yield* chooseBatchProfile(
        { app, createProfile: () => dialog, importProfile: () => dialog },
        {
          selection: { selector: "default", source: "bound", shouldAsk: true },
          previews: [],
        },
      ).pipe(
        Effect.provide(harness.layer),
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Effect.yieldNow;
      const picker = opened.mock.instances[0];
      if (!(picker instanceof SuggestModal))
        return yield* Effect.die("the picker did not open");
      yield* answerPicker(picker, action);
      yield* Deferred.await(dialogOpened);
      yield* Fiber.interrupt(choice);
      expect(close).toHaveBeenCalledOnce();
      expect(Exit.hasInterrupts(yield* Fiber.await(choice))).toBe(true);
    }),
);
