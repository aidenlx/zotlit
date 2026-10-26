// The "Zotero editing" row under Zotero → Connection: what the session may do
// to Zotero's annotations, and the two actions that change it.
import { DateTime, Effect, FiberHandle, Queue, Stream } from "effect";
import type { ButtonComponent, Setting, SettingGroupItem } from "obsidian";

import { recover } from "@/lib/effect-cause";
import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import { editingCapabilityCopy } from "@/services/annotation-repository/capability-copy";
import { CapabilityNotices } from "@/services/annotation-repository/notices";
import { AnnotationRepository } from "@/services/annotation-repository/service";
import { ZoteroLocalApi } from "@/services/zotero-local-api/service";

import type { SettingsKey, SettingTabContext } from "./context";
import { applyAction, editingRowModel } from "./zotero-editing-model";

/**
 * The lifecycle surface for Write Authorization: the status of the session, the
 * gesture that asks Zotero for permission, and the one that drops what this
 * device remembers.
 *
 * @see apps/obsidian/docs/adr/0038-write-authorization-starts-only-from-a-user-gesture.md
 */
export function zoteroEditingRow(
  ctx: SettingTabContext,
): SettingGroupItem<SettingsKey> {
  return {
    id: "settings_zotero_editing",
    name: m.settings_zotero_editing_name(),
    desc: m.settings_zotero_editing_desc(),
    render: (setting) => renderEditingRow(setting, ctx),
  };
}

function renderEditingRow(
  setting: Setting,
  ctx: SettingTabContext,
): () => void {
  const desc = createFragment();
  const statusEl = createDiv({
    cls: "zt:font-medium zt:text-foreground",
    attr: { role: "status" },
  });
  desc.append(statusEl);
  const detailEl = createSpan({ cls: "zt:block zt:text-(--text-muted)" });
  desc.append(detailEl);
  const rememberedEl = createDiv({
    cls: "zt:mt-1 zt:text-muted-foreground",
    text: m.settings_zotero_editing_saved(),
  });
  desc.append(rememberedEl);
  setting.setDesc(desc);

  let enableButton: ButtonComponent | undefined;
  let checkButton: ButtonComponent | undefined;
  let forgetButton: ButtonComponent | undefined;
  setting
    .addButton((button) => {
      enableButton = button.setButtonText(m.settings_zotero_editing_enable());
      button.setCta();
    })
    .addButton((button) => {
      checkButton = button.setButtonText(m.settings_zotero_editing_check());
    })
    .addButton((button) => {
      forgetButton = button.setButtonText(m.settings_zotero_editing_forget());
    });

  return ctx.tab.mount(
    Effect.gen(function* () {
      const repository = yield* AnnotationRepository;
      const localApi = yield* ZoteroLocalApi;
      const notices = yield* CapabilityNotices;
      // What the keystore holds, which no event announces, is read again on
      // each of these; a newer read drops the one still in flight.
      const rereads = yield* Queue.unbounded<void>();
      let remembered = false;
      let checking = false;
      // Zotero's dialog rate limit is the one state whose copy changes with no
      // event behind it, so the row redraws each second while it runs.
      const countdown = yield* FiberHandle.make();
      const tick: Effect.Effect<boolean> = Effect.suspend(() => apply).pipe(
        Effect.delay("1 second"),
        Effect.repeat({ while: (countsDown) => countsDown }),
      );

      const apply = Effect.gen(function* () {
        const capability = yield* repository.capability;
        const model = editingRowModel({
          capability,
          checking,
          remembered,
          now: yield* DateTime.now,
        });
        statusEl.textContent = model.status.label;
        statusEl.classList.toggle(
          "mod-warning",
          model.status.tone === "warning",
        );
        detailEl.textContent = model.status.detail ?? "";
        detailEl.toggle(model.status.detail !== null);
        rememberedEl.toggle(remembered && capability.kind === "read-only");
        applyAction(checkButton, model.check);
        applyAction(enableButton, model.enable);
        applyAction(forgetButton, model.forget);
        if (model.countsDown) {
          yield* FiberHandle.run(countdown, tick, { onlyIfMissing: true });
        }
        return model.countsDown;
      });

      const runCheck = Effect.gen(function* () {
        checking = true;
        yield* apply;
        yield* repository.probe;
        const result = editingCapabilityCopy(
          yield* repository.capability,
          yield* DateTime.now,
        );
        new BaseNotice(
          BaseNotice.render((notice) => {
            notice.setTitle(result.label);
            if (result.detail) notice.addText(result.detail);
          }),
        );
      }).pipe(
        Effect.ensuring(
          Effect.suspend(() => {
            checking = false;
            return apply.pipe(Effect.andThen(Queue.offer(rereads, undefined)));
          }),
        ),
      );
      // A check already running keeps its own status and cleanup.
      const check = Effect.suspend(() => (checking ? Effect.void : runCheck));

      checkButton?.onClick(
        () => void ctx.tab.run(check, m.settings_zotero_editing_check_failed()),
      );
      forgetButton?.onClick(
        () =>
          void ctx.tab.run(
            localApi.forgetAuthorization.pipe(
              Effect.andThen(Queue.offer(rereads, undefined)),
            ),
            m.settings_zotero_editing_forget_failed(),
          ),
      );
      enableButton?.onClick(
        () =>
          void ctx.tab.run(
            notices.allowEditing,
            m.settings_zotero_editing_enable_failed(),
          ),
      );

      yield* apply;
      yield* Effect.forkScoped(repository.probe);
      // An Allow editing from outside this row, such as a notice's button, can
      // save or drop a key, and the capability moves with it. The status
      // redraws at once; the key's line follows when the keystore answers.
      yield* Stream.merge(
        Stream.make(undefined),
        Stream.merge(
          repository.capabilityChanges.pipe(Stream.tap(() => apply)),
          Stream.fromQueue(rereads),
        ),
      ).pipe(
        // A failed read keeps the last answer, so the row stays live.
        Stream.switchMap(() =>
          Stream.fromEffect(
            localApi.remembered.pipe(
              recover(
                (cause) =>
                  Effect.logWarning(
                    "Cannot read the Remembered Write Authorization",
                    cause,
                  ),
                Effect.sync(() => remembered),
              ),
            ),
          ),
        ),
        Stream.runForEach((value) => {
          remembered = value;
          return apply;
        }),
      );
    }),
  );
}
