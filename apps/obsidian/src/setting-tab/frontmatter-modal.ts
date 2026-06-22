import { type App, Modal, Setting } from "obsidian";

import { type FrontmatterMergeStrategy } from "@zotlit/templates/constants";
import { validateFrontmatterExpr } from "@zotlit/templates/frontmatter";

import { AbortError } from "@/lib/abort-error";
import { RESERVED_KEYS } from "@/lib/constants";
import * as m from "@/paraglide/messages";

import { appendCompileError } from "./compile-error";
import { frontmatterMergeStrategyLabel } from "./frontmatter-strategy";

export interface FrontmatterFieldValue {
  key: string;
  expr: string;
  merge: FrontmatterMergeStrategy;
}

export interface FrontmatterFieldModalOptions {
  /** The field being edited, or `null` to add a new one. */
  field: FrontmatterFieldValue | null;
  /** Keys already in use by other fields, for the duplicate check. */
  existingKeys: readonly string[];
}

export function openFrontmatterFieldModal(
  app: App,
  { field, existingKeys }: FrontmatterFieldModalOptions,
): Promise<FrontmatterFieldValue> {
  const { resolve, reject, promise } =
    Promise.withResolvers<FrontmatterFieldValue>();
  const usedKeys = new Set(existingKeys);

  const modal = new Modal(app);
  modal.setTitle(
    field
      ? m.settings_frontmatter_modal_edit_title()
      : m.settings_frontmatter_modal_add_title(),
  );

  const form = modal.contentEl.createEl("form");

  new Setting(form)
    .setName(m.settings_frontmatter_key_name())
    .setDesc(m.settings_frontmatter_key_desc())
    .addText((text) => {
      text.inputEl.name = "key";
      text.setValue(field?.key ?? "");
      text.inputEl.addEventListener("input", () =>
        text.inputEl.setCustomValidity(""),
      );
    });

  const exprSetting = new Setting(form)
    .setName(m.settings_frontmatter_expr_name())
    .setDesc(m.settings_frontmatter_expr_desc())
    .addTextArea((text) => {
      text.inputEl.name = "expr";
      text.inputEl.rows = 4;
      text.inputEl.cols = 32;
      text.setValue(field?.expr ?? "");
      text.inputEl.addEventListener("input", () => {
        text.inputEl.setCustomValidity("");
        exprSetting.setDesc(m.settings_frontmatter_expr_desc());
      });
    });

  new Setting(form)
    .setName(m.settings_frontmatter_merge_name())
    .setDesc(m.settings_frontmatter_merge_desc())
    .addDropdown((dropdown) => {
      dropdown
        .addOptions({
          replace: frontmatterMergeStrategyLabel("replace"),
          append: frontmatterMergeStrategyLabel("append"),
          keep: frontmatterMergeStrategyLabel("keep"),
        })
        .setValue(field?.merge ?? "replace");
      dropdown.selectEl.name = "merge";
    });

  new Setting(form)
    .addButton((btn) =>
      btn
        .setButtonText(m.settings_frontmatter_save())
        .setCta()
        .then((btn) => {
          btn.buttonEl.type = "submit";
        }),
    )
    .addButton((btn) =>
      btn
        .setButtonText(m.modal_cancel())
        .then((btn) => {
          btn.buttonEl.type = "button";
        })
        .onClick(() => modal.close()),
    );

  form.addEventListener("submit", (evt) => {
    evt.preventDefault();

    const keyInput = form.elements.namedItem("key") as HTMLInputElement;
    const exprInput = form.elements.namedItem("expr") as HTMLTextAreaElement;
    const mergeInput = form.elements.namedItem("merge") as HTMLSelectElement;

    const key = keyInput.value.trim();
    const expr = exprInput.value.trim();
    const merge = mergeInput.value as FrontmatterMergeStrategy;

    let keyError: string | null = null;
    if (!key) {
      keyError = m.settings_frontmatter_error_empty_key();
    } else if (RESERVED_KEYS.has(key)) {
      keyError = m.settings_frontmatter_error_reserved({ key });
    } else if (usedKeys.has(key)) {
      keyError = m.settings_frontmatter_error_duplicate({ key });
    }

    if (keyError) {
      keyInput.setCustomValidity(keyError);
      form.reportValidity();
      return;
    }

    if (!expr) {
      exprInput.setCustomValidity(m.settings_frontmatter_error_empty_expr());
      form.reportValidity();
      return;
    }

    const exprError = validateFrontmatterExpr(expr);
    if (exprError) {
      const desc = document.createDocumentFragment();
      desc.append(m.settings_frontmatter_expr_desc());
      appendCompileError(desc, exprError);
      exprSetting.setDesc(desc);
      return;
    }

    resolve({ key, expr, merge });
    modal.close();
  });

  modal.setCloseCallback(() => reject(new AbortError()));

  modal.open();
  return promise;
}
