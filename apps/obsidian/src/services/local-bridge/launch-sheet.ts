// The launch sheet: the one screen that names the website a Customize opens,
// what it may do while connected, and what leaves Obsidian to reach it.

import { ConfirmationModal, Setting } from "obsidian";
import type { App } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";

import type {
  ConfirmLaunch,
  LaunchConsent,
  LaunchSheetDetails,
} from "./customize";

export function createLaunchSheet(app: App): ConfirmLaunch {
  return (details) => {
    const { promise, resolve } = Promise.withResolvers<LaunchConsent | null>();
    let doNotAskAgain = false;
    const modal = new ConfirmationModal(app);
    modal.contentEl.addClasses([
      "zt-root",
      "zt:flex",
      "zt:flex-col",
      "zt:gap-4",
    ]);
    modal.setTitle(m.modal_workbench_launch_title());
    modal.setContent(sheetBody(details));
    new Setting(modal.contentEl)
      .setName(m.modal_workbench_launch_remember())
      .addToggle((toggle) =>
        toggle.setValue(false).onChange((value) => {
          doNotAskAgain = value;
        }),
      );
    modal.addButton((button) =>
      button
        .setButtonText(m.modal_workbench_launch_open())
        .setCta()
        .onClick(() => resolve({ doNotAskAgain })),
    );
    modal.addCancelButton(m.modal_cancel());
    modal.setCloseCallback(() => resolve(null));
    modal.open();
    return promise;
  };
}

function sheetBody(details: LaunchSheetDetails): DocumentFragment {
  const fragment = createFragment();
  const stack = fragment.createDiv({ cls: "zt:flex zt:flex-col zt:gap-2" });
  const lines = [
    m.modal_workbench_launch_desc({
      website: details.website,
      vault: details.vault,
    }),
    m.modal_workbench_launch_scope({
      template: details.template,
      item: details.item ?? m.modal_workbench_launch_item_sample(),
    }),
    m.modal_workbench_launch_grants({ website: details.website }),
    m.modal_workbench_launch_leaves(),
  ];
  if (details.turnServerOn)
    stack.createEl("p", {
      text: m.modal_workbench_launch_server_step(),
      cls: "zt:text-pretty zt:text-(--text-warning)",
    });
  for (const line of lines)
    stack.createEl("p", { text: line, cls: "zt:text-pretty" });
  return fragment;
}
