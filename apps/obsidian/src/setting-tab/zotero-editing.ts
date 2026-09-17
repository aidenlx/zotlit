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
  /** "Enable editing" — the gesture that asks Zotero, or re-checks it. */
  enable: ActionState;
  /** "Forget authorization" — offered only while there is one to forget. */
  forget: ActionState;
  /** Whether the row must redraw itself on a clock rather than on an event. */
  countsDown: boolean;
}

export interface EditingRowInput {
  capability: EditingCapability;
  /** Whether a Remembered Write Authorization is stored on this device. */
  remembered: boolean;
  /** The instant a cooldown's remaining seconds are measured from. */
  now: Temporal.Instant;
}

/**
 * What the "Zotero editing" row offers for one Editing Capability.
 *
 * "Enable editing" runs a Capability Probe before it asks Zotero for anything,
 * so it stays live for every state a fresh probe could clear — a closed Zotero,
 * the local API switched off, a database that was swapped. It goes away once
 * editing is on, and is refused only where asking cannot help: while a request
 * is already at Zotero's dialog, while Zotero's rate limit runs, and where
 * Zotero itself is the wrong version or the library refuses writes.
 */
export function editingRowModel({
  capability,
  remembered,
  now,
}: EditingRowInput): EditingRowModel {
  return {
    status: editingCapabilityCopy(capability, now),
    enable: {
      shown: capability.kind !== "writable",
      disabled: askingCannotHelp(capability),
    },
    forget: { shown: remembered, disabled: false },
    countsDown: capability.kind === "cooldown",
  };
}

function askingCannotHelp(capability: EditingCapability): boolean {
  switch (capability.kind) {
    case "authorizing":
    case "cooldown":
      return true;
    case "read-only":
      return (
        capability.reason === "incompatible-zotero" ||
        capability.reason === "library-read-only"
      );
    default:
      return false;
  }
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
  desc.append(m.settings_zotero_editing_desc());
  desc.append(createEl("br"));
  const statusEl = createSpan();
  desc.append(statusEl);
  const detailEl = createSpan({ cls: "zt:block zt:text-(--text-muted)" });
  desc.append(detailEl);
  setting.setDesc(desc);

  let enableButton: ButtonComponent | undefined;
  let forgetButton: ButtonComponent | undefined;
  let remembered = false;
  let stopCountdown: (() => void) | null = null;

  const apply = (): void => {
    const model = editingRowModel({
      capability: ctx.annotations.capability,
      remembered,
      now: Temporal.Now.instant(),
    });
    statusEl.textContent = model.status.label;
    statusEl.classList.toggle("mod-warning", model.status.tone === "warning");
    detailEl.textContent = model.status.detail ?? "";
    detailEl.classList.toggle("zt:hidden", model.status.detail === null);
    applyAction(enableButton, model.enable);
    applyAction(forgetButton, model.forget);
    if (model.countsDown) {
      stopCountdown ??= countdownInterval(window, apply);
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
      forgetButton = button;
      button
        .setButtonText(m.settings_zotero_editing_forget())
        .setWarning()
        .onClick(() => {
          void ctx.writeAuthorization
            .forgetAuthorization()
            .then(refreshRemembered);
        });
    });

  apply();
  refreshRemembered();
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
  button.buttonEl.classList.toggle("zt:hidden", !state.shown);
  button.setDisabled(state.disabled);
}
