import { Modal, Setting } from "obsidian";
import type { App } from "obsidian";

import type {
  FrontmatterLanguage,
  FrontmatterMergeStrategy,
} from "@zotlit/templates/constants";

import { AbortError } from "@/lib/abort-error";
import { RESERVED_KEYS } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";

import { appendCompileError } from "./compile-error";
import { frontmatterMergeStrategyLabel } from "./frontmatter-strategy";

export interface FrontmatterFieldValue {
  key: string;
  expr: string;
  merge: FrontmatterMergeStrategy;
  language: FrontmatterLanguage;
}

export interface FrontmatterFieldModalOptions {
  /** The field being edited, or `null` to add a new one. */
  field: FrontmatterFieldValue | null;
  /** Keys already in use by other fields, for the duplicate check. */
  existingKeys: readonly string[];
  /** Compile-check `expr` against the field's declared language. */
  validateExpr: (expr: string, language: FrontmatterLanguage) => string | null;
  /** Per-device JavaScript Templates gate; gates which language options the modal offers. */
  javascriptTemplatesEnabled: boolean;
}

/** Plain expr desc, or with a note that the field is read-only while the JS gate is off. */
function buildExprDesc(readonly: boolean): string | DocumentFragment {
  if (!readonly) return m.settings_frontmatter_expr_desc();
  const desc = createFragment();
  desc.append(m.settings_frontmatter_expr_desc());
  const note = createDiv();
  note.className = "zt:mt-2 zt:text-(--text-warning)";
  note.textContent = m.settings_frontmatter_expr_readonly_js();
  desc.append(note);
  return desc;
}

export function openFrontmatterFieldModal(
  app: App,
  {
    field,
    existingKeys,
    validateExpr,
    javascriptTemplatesEnabled,
  }: FrontmatterFieldModalOptions,
): Promise<FrontmatterFieldValue> {
  const { resolve, reject, promise } =
    Promise.withResolvers<FrontmatterFieldValue>();
  const usedKeys = new Set(existingKeys);
  const initialLanguage: FrontmatterLanguage = field?.language ?? "liquid";
  const initiallyReadonly =
    !javascriptTemplatesEnabled && initialLanguage === "javascript";

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

  let exprTextarea: HTMLTextAreaElement;

  new Setting(form)
    .setName(m.settings_frontmatter_language_name())
    .setDesc(m.settings_frontmatter_language_desc())
    .addDropdown((dropdown) => {
      dropdown.selectEl.name = "language";
      if (javascriptTemplatesEnabled) {
        dropdown.addOptions({
          liquid: m.settings_frontmatter_language_liquid(),
          javascript: m.settings_frontmatter_language_javascript(),
        });
      } else if (initialLanguage === "javascript") {
        dropdown.addOptions({
          javascript: m.settings_frontmatter_language_javascript(),
          liquid: m.settings_frontmatter_language_liquid(),
        });
      } else {
        dropdown.addOptions({
          liquid: m.settings_frontmatter_language_liquid(),
        });
      }
      dropdown.setValue(initialLanguage);
      dropdown.onChange((value) => {
        exprTextarea.setCustomValidity("");
        const readonly = !javascriptTemplatesEnabled && value === "javascript";
        exprTextarea.readOnly = readonly;
        exprSetting.setDesc(buildExprDesc(readonly));
        // Gate off, the language switch is one-directional: once a
        // javascript field is rewritten as liquid, this device must not offer
        // javascript again (cancel still discards the whole edit).
        if (
          !javascriptTemplatesEnabled &&
          initialLanguage === "javascript" &&
          value === "liquid"
        ) {
          dropdown.selectEl
            .querySelector('option[value="javascript"]')
            ?.remove();
        }
      });
    });

  const exprSetting = new Setting(form)
    .setName(m.settings_frontmatter_expr_name())
    .setDesc(buildExprDesc(initiallyReadonly))
    .addTextArea((text) => {
      text.inputEl.name = "expr";
      text.inputEl.rows = 4;
      text.inputEl.cols = 32;
      text.inputEl.readOnly = initiallyReadonly;
      text.setValue(field?.expr ?? "");
      exprTextarea = text.inputEl;
      text.inputEl.addEventListener("input", () => {
        text.inputEl.setCustomValidity("");
        exprSetting.setDesc(buildExprDesc(text.inputEl.readOnly));
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
    const languageInput = form.elements.namedItem(
      "language",
    ) as HTMLSelectElement;

    const key = keyInput.value.trim();
    const expr = exprInput.value.trim();
    const merge = mergeInput.value as FrontmatterMergeStrategy;
    const language = languageInput.value as FrontmatterLanguage;

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

    const exprError = validateExpr(expr, language);
    if (exprError) {
      const desc = createFragment();
      desc.append(m.settings_frontmatter_expr_desc());
      appendCompileError(desc, exprError);
      exprSetting.setDesc(desc);
      return;
    }

    resolve({ key, expr, merge, language });
    modal.close();
  });

  modal.setCloseCallback(() => reject(new AbortError()));

  modal.open();
  return promise;
}
