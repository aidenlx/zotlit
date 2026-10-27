// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { ButtonComponent, Modal, controlsOf } from "@mock/obsidian";
import { Effect, Exit, Fiber, Layer, Logger } from "effect";
import type { App } from "obsidian";
import { beforeEach, expect } from "vitest";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { AbortError } from "@/lib/abort-error";
import * as m from "@/lib/i18n/generated/messages";
import { Notifier } from "@/lib/notifier";
import { Workspace } from "@/lib/obsidian-workspace";
import { Template, templateFailure } from "@/services/template/service";

import { createSharedPartialEffect } from "./partial-command";

beforeEach(() => {
  Modal.instances.length = 0;
});

// #1819: a stopped create is silent; a write failure keeps its log and notice.
it.effect.each(["abort", "interrupt", "failure"] as const)(
  "reports a Shared Partial write stopped by %s",
  (reason) =>
    Effect.gen(function* () {
      const notifier = testNotifier();
      const errors: unknown[] = [];
      const app = stubService<App>("App", {});
      const flow = createSharedPartialEffect(app, {
        name: "authors",
        open: false,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.mock(Template, {
              getPartialNames: Effect.succeed([]),
              createPartial: () =>
                reason === "interrupt"
                  ? Effect.interrupt
                  : Effect.fail(
                      templateFailure(
                        reason === "abort"
                          ? new AbortError()
                          : new Error("disk full"),
                      ),
                    ),
            }),
            Layer.mock(Workspace, {}),
            Layer.succeed(Notifier, notifier.service),
            Logger.layer([
              Logger.make(({ logLevel, message }) => {
                if (logLevel === "Error") errors.push(message);
              }),
            ]),
          ),
        ),
      );
      const fiber = yield* Effect.forkChild(flow);
      yield* Effect.promise(async () => {
        await expect.poll(() => Modal.instances.length).toBe(1);
        const modal = Modal.instances[0]!;
        modal.onOpen();
        const create = controlsOf(
          modal.modalEl.querySelector<HTMLElement>(".modal-button-container")!,
        ).find(
          (control): control is ButtonComponent =>
            control instanceof ButtonComponent &&
            control.text === m.partial_new_action(),
        );
        expect(create).toBeInstanceOf(ButtonComponent);
        create!.click();
      });
      const exit = yield* Fiber.await(fiber);
      expect(Exit.hasInterrupts(exit)).toBe(reason === "interrupt");
      expect(Exit.isSuccess(exit) ? exit.value : "released").toBe(
        reason === "interrupt" ? "released" : null,
      );
      expect(errors).toHaveLength(reason === "failure" ? 1 : 0);
      expect(notifier.notices.map((notice) => notice.messages)).toEqual(
        reason === "failure" ? [[m.notice_partial_create_failed()]] : [],
      );
    }),
);
