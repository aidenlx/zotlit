// The "Zotero editing" row under Zotero → Connection: what the session may do
// to Zotero's annotations, and the two actions that change it.
import type { ButtonComponent, Setting, SettingGroupItem } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import { editingCapabilityCopy } from "@/services/annotation-repository/capability-copy";
import type { CapabilityCopy } from "@/services/annotation-repository/capability-copy";
import { countdownInterval } from "@/services/annotation-repository/cooldown";

import type { SettingsKey, SettingTabContext } from "./context";

/** Whether one action is offered at all, and whether it can be selected now. */
export interface ActionState {
  shown: boolean;
  disabled: boolean;
}

/** Everything the row renders, decided before any element is touched. */
export interface EditingRowModel {
  status: CapabilityCopy;
  /** "Allow editing" — the gesture that asks Zotero for write permission. */
  enable: ActionState;
  check: ActionState;
  /** "Forget authorization" — offered only while there is one to forget. */
  forget: ActionState;
  /** Whether the row must redraw itself on a clock rather than on an event. */
  countsDown: boolean;
}

export interface EditingRowInput {
  capability: EditingCapability;
  /** A connection check started from this settings row is in flight. */
  checking?: boolean;
  /** Whether a Remembered Write Authorization is stored on this device. */
  remembered: boolean;
  /** The instant a cooldown's remaining seconds are measured from. */
  now: Temporal.Instant;
}

/**
 * What the "Zotero editing" row offers for one Editing Capability.
 *
 * Authorization and connection checks are separate user actions.
 */
export function editingRowModel({
  capability,
  checking = false,
  remembered,
  now,
}: EditingRowInput): EditingRowModel {
  return {
    status: editingCapabilityCopy(
      checking ? { kind: "read-only", reason: "probing" } : capability,
      now,
    ),
    enable: {
      shown: !checking && capability.kind === "authorization-required",
      disabled: checking || capability.kind !== "authorization-required",
    },
    check: {
      shown: checking || capability.kind === "read-only",
      disabled:
        checking ||
        (capability.kind === "read-only" && capability.reason === "probing"),
    },
    forget: {
      shown: remembered,
      disabled: checking || capability.kind === "authorizing",
    },
    countsDown: capability.kind === "cooldown",
  };
}

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
  const stack = new DisposableStack();

  const desc = createFragment();
  const statusEl = createEl("div", {
    cls: "zt:font-medium zt:text-foreground",
    attr: { role: "status" },
  });
  desc.append(statusEl);
  const detailEl = createSpan({ cls: "zt:block zt:text-(--text-muted)" });
  desc.append(detailEl);
  const rememberedEl = createEl("div", {
    cls: "zt:mt-1 zt:text-muted-foreground",
    text: m.settings_zotero_editing_saved(),
  });
  desc.append(rememberedEl);
  setting.setDesc(desc);

  let enableButton: ButtonComponent | undefined;
  let checkButton: ButtonComponent | undefined;
  let forgetButton: ButtonComponent | undefined;
  let remembered = false;
  let checking = false;
  let stopCountdown: (() => void) | null = null;

  const apply = (): void => {
    const model = editingRowModel({
      capability: ctx.annotations.capability,
      checking,
      remembered,
      now: Temporal.Now.instant(),
    });
    statusEl.textContent = model.status.label;
    statusEl.classList.toggle("mod-warning", model.status.tone === "warning");
    detailEl.textContent = model.status.detail ?? "";
    detailEl.toggle(model.status.detail !== null);
    rememberedEl.toggle(
      remembered && ctx.annotations.capability.kind === "read-only",
    );
    applyAction(checkButton, model.check);
    applyAction(enableButton, model.enable);
    applyAction(forgetButton, model.forget);
    if (model.countsDown) {
      stopCountdown ??= countdownInterval(setting.settingEl.win, apply);
    } else {
      stopCountdown?.();
      stopCountdown = null;
    }
  };

  /** Re-read what the keystore holds, which no event announces. */
  const refreshRemembered = (): void => {
    void ctx.writeAuthorization.remembered().then((value) => {
      remembered = value;
      apply();
    });
  };

  setting
    .addButton((button) => {
      enableButton = button;
      button
        .setButtonText(m.settings_zotero_editing_enable())
        .setCta()
        .onClick(() => {
          void enableEditing(ctx).then(refreshRemembered);
        });
    })
    .addButton((button) => {
      checkButton = button;
      button
        .setButtonText(m.settings_zotero_editing_check())
        .onClick(async () => {
          if (checking) return;
          checking = true;
          apply();
          try {
            await ctx.annotations.probe();
            const result = editingCapabilityCopy(
              ctx.annotations.capability,
              Temporal.Now.instant(),
            );
            new BaseNotice(
              BaseNotice.render((notice) => {
                notice.setTitle(result.label);
                if (result.detail) notice.addText(result.detail);
              }),
            );
          } finally {
            checking = false;
            apply();
            refreshRemembered();
          }
        });
    })
    .addButton((button) => {
      forgetButton = button;
      button.setButtonText(m.settings_zotero_editing_forget()).onClick(() => {
        void ctx.writeAuthorization
          .forgetAuthorization()
          .then(refreshRemembered);
      });
    });

  apply();
  refreshRemembered();
  void ctx.annotations.probe();
  stack.defer(ctx.annotations.on("capability-changed", apply));
  stack.defer(() => stopCountdown?.());

  return () => stack.dispose();
}

/**
 * The settings half of the authorization gesture. Zotero's own dialog carries
 * every refusal, and the status line carries what the session is left in, so
 * only a grant is worth a notice.
 */
async function enableEditing(ctx: SettingTabContext): Promise<void> {
  const result = await ctx.writeAuthorization.authorize();
  if ("failure" in result) return;
  new BaseNotice(
    result.value.remembered
      ? m.notice_zotero_editing_enabled()
      : m.notice_zotero_editing_once(),
  );
}

function applyAction(
  button: ButtonComponent | undefined,
  state: ActionState,
): void {
  if (!button) return;
  button.buttonEl.toggle(state.shown);
  button.setDisabled(state.disabled);
}
