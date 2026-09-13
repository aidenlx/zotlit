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
    let remember = false;
    let destination: "web" | "native" = "web";
    const modal = new ConfirmationModal(app);
    modal.contentEl.addClasses([
      "zt-root",
      "zt:flex",
      "zt:flex-col",
      "zt:gap-4",
    ]);
    modal.setTitle(m.modal_workbench_launch_title());
    const content = createFragment();
    const choices = content.createDiv({
      attr: {
        role: "radiogroup",
        "aria-label": m.modal_workbench_launch_title(),
      },
      cls: "zt:flex zt:flex-col zt:gap-3",
    });
    const webDetails = content.createDiv();
    webDetails.append(sheetBody(details));
    for (const value of ["web", "native"] as const) {
      const label = choices.createEl("label", {
        cls: "zt:flex zt:items-start zt:gap-2",
      });
      const input = label.createEl("input", {
        type: "radio",
        attr: { name: "zotlit-customize-destination", value },
      });
      input.checked = value === "web";
      const text = label.createDiv();
      text.createDiv({
        text:
          value === "web"
            ? m.template_workbench_web_open()
            : m.modal_workbench_launch_native(),
      });
      text.createDiv({
        text:
          value === "web"
            ? m.modal_workbench_launch_web_desc()
            : m.modal_workbench_launch_native_desc(),
        cls: "zt:text-sm zt:text-(--text-muted)",
      });
      input.addEventListener("change", () => {
        if (!input.checked) return;
        destination = value;
        webDetails.toggle(destination === "web");
      });
    }
    modal.setContent(content);
    new Setting(modal.contentEl)
      .setName(m.modal_workbench_launch_remember())
      .addToggle((toggle) =>
        toggle.setValue(false).onChange((value) => {
          remember = value;
        }),
      );
    modal.addButton((button) =>
      button
        .setButtonText(m.modal_workbench_launch_open())
        .setCta()
        .onClick(() => resolve({ destination, remember })),
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
  if (details.turnWorkbenchOn)
    stack.createEl("p", {
      text: m.modal_workbench_launch_enable_web(),
      cls: "zt:text-pretty zt:text-(--text-warning)",
    });
  if (details.turnServerOn)
    stack.createEl("p", {
      text: m.modal_workbench_launch_server_step(),
      cls: "zt:text-pretty zt:text-(--text-warning)",
    });
  for (const line of lines)
    stack.createEl("p", { text: line, cls: "zt:text-pretty" });
  return fragment;
}
