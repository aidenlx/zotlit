// The interruptible Shared Partial flow owned by a Workbench leaf.

import { Effect } from "effect";
import type { App } from "obsidian";

import { withLogCategory } from "@/lib/effect-log";
import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import { Workspace } from "@/lib/obsidian-workspace";
import { Template } from "@/services/template/service";

import { NewPartialModal } from "./new-partial";
import type { CreateSharedPartialOptions } from "./new-partial";
import { openTemplateWorkbench } from "./register";

/** A leaf holds this flow's command, so closing it also closes its prompt. */
export const createSharedPartialEffect = Effect.fn(
  "TemplateWorkbench.createSharedPartial",
)(
  function* (app: App, options: CreateSharedPartialOptions = {}) {
    const template = yield* Template;
    const taken = yield* template.getPartialNames;
    const name = yield* Effect.scoped(
      Effect.gen(function* () {
        const modal = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const modal = new NewPartialModal(app, taken, options.name ?? "");
            modal.open();
            return modal;
          }),
          (modal) => Effect.sync(() => modal.close()),
        );
        return yield* Effect.promise((signal) => {
          signal.throwIfAborted();
          return modal.result;
        });
      }),
    );
    if (name === null) return null;
    const file = yield* template.createPartial(name, {
      ...(options.source === undefined ? {} : { source: options.source }),
      ...(options.language === undefined ? {} : { language: options.language }),
    });
    const open = options.open ?? "split";
    if (open !== false) {
      const leaf = yield* (yield* Workspace).getLeaf(
        open === "split" ? "split" : "tab",
      );
      yield* Effect.tryPromise((signal) => {
        signal.throwIfAborted();
        return openTemplateWorkbench(app, file, {
          leaf,
          explainUnsupported: false,
        });
      });
    }
    return name;
  },
  Effect.catch((error) =>
    Effect.gen(function* () {
      yield* Effect.logError("Failed to create a Shared Partial", { error });
      yield* Effect.sync(
        () => new BaseNotice(m.notice_partial_create_failed()),
      );
      return null;
    }),
  ),
  withLogCategory("template-workbench"),
);
