// The frame the Profile dialogs share: Obsidian's pinned title and footer
// around a scrolling body, plus the stacked form fields and preview panel the
// Create and Import dialogs lay out side by side.
import { ButtonComponent, stringifyYaml } from "obsidian";
import type { Modal } from "obsidian";

import type { ProfileNotePreview } from "@/services/note-feature";

/** `--dialog-width` is what `.modal` reads; the wide window borrows the
 * community-browser size so two columns fit. */
const WIDE_DIALOG_CLASSES = [
  "zt:[--dialog-width:var(--modal-width)]",
  "zt:[--dialog-max-width:var(--modal-max-width)]",
];

/** One label above its control, with the label's `for` wired by nesting. */
const FIELD_CLASS = "zt:flex zt:min-w-0 zt:flex-col zt:gap-1.5";
const FIELD_NAME_CLASS = "zt:text-sm zt:leading-(--line-height-tight)";
const HEADING_CLASS =
  "zt:text-sm zt:leading-(--line-height-tight) zt:font-semibold";
export const NOTE_CLASS =
  "zt:text-xs zt:leading-(--line-height-tight) zt:text-pretty zt:text-muted-foreground";
const CODE_CLASS =
  "zt:m-0 zt:font-mono zt:text-xs zt:leading-normal zt:whitespace-pre-wrap zt:break-words zt:select-text zt:text-foreground";

/**
 * Obsidian's scrolling-body mode: the title and the button row stay pinned
 * while `contentEl` scrolls. `wide` also opens the two-column window.
 */
export function frameDialog(modal: Modal, options: { wide?: boolean } = {}) {
  modal.modalEl.addClass("mod-scrollable-content");
  modal.modalEl.toggleClass(WIDE_DIALOG_CLASSES, options.wide ?? false);
  modal.contentEl.addClass("zt-root");
}

/** The pinned button row after `contentEl`; a second call replaces the first. */
export function dialogFooter(modal: Modal): HTMLElement {
  modal.modalEl.querySelector(":scope > .modal-button-container")?.remove();
  return modal.modalEl.createDiv({ cls: "modal-button-container zt-root" });
}

/** A button in the footer; buttons read in Obsidian's order, action first. */
export function footerButton(
  footer: HTMLElement,
  text: string,
  onClick: () => void,
): ButtonComponent {
  return new ButtonComponent(footer).setButtonText(text).onClick(onClick);
}

/** Form column beside a preview column; the columns stack when narrow. */
export function twoColumns(contentEl: HTMLElement): {
  controls: HTMLElement;
  preview: HTMLElement;
} {
  const layout = contentEl.createDiv({
    cls: "zt:grid zt:grid-cols-1 zt:gap-6 zt:md:grid-cols-2",
  });
  return {
    controls: layout.createDiv({
      cls: "zt:flex zt:min-w-0 zt:flex-col zt:gap-4",
    }),
    preview: layout.createDiv({ cls: "zt:min-w-0" }),
  };
}

/** A section title inside the body, one step below the dialog title. */
export function heading(parent: HTMLElement, text: string): HTMLElement {
  return parent.createDiv({
    text,
    cls: HEADING_CLASS,
    attr: { role: "heading", "aria-level": "3" },
  });
}

/** A labelled field; the control fills the returned container's width. */
export function field(parent: HTMLElement, name: string): HTMLElement {
  const label = parent.createEl("label", { cls: FIELD_CLASS });
  label.createSpan({ text: name, cls: FIELD_NAME_CLASS });
  return label.createDiv({ cls: "zt:flex zt:min-w-0 zt:*:w-full" });
}

/** A one-line note under the fields: muted, or in the error colour. */
export function note(
  parent: HTMLElement,
  options: { text?: string; status?: boolean } = {},
): { set(text: string, tone?: "muted" | "error"): void } {
  const el = parent.createEl("p", {
    cls: NOTE_CLASS,
    text: options.text ?? "",
    attr: options.status ? { role: "status" } : {},
  });
  return {
    set(text, tone = "muted") {
      el.setText(text);
      el.toggleClass("zt:text-(--text-error)", tone === "error");
      el.toggleClass("zt:text-muted-foreground", tone === "muted");
    },
  };
}

/** The rendered-note preview: path, properties, and body on one surface. */
export function previewPanel(
  parent: HTMLElement,
  titles: {
    path: string;
    properties: string;
    body: string;
  },
): { set(preview: ProfileNotePreview | undefined): void } {
  const panel = parent.createDiv({
    cls: "zt:flex zt:flex-col zt:gap-3 zt:rounded-md zt:border zt:border-border zt:bg-(--background-secondary) zt:p-3",
  });
  const block = (title: string, tag: "code" | "pre", cls?: string) => {
    const group = panel.createDiv({ cls: "zt:flex zt:flex-col zt:gap-1.5" });
    heading(group, title);
    return group.createEl(tag, { cls: [CODE_CLASS, cls ?? ""].join(" ") });
  };
  const path = block(titles.path, "code", "zt:break-all");
  const properties = block(titles.properties, "pre");
  const body = block(titles.body, "pre", "zt:max-h-72 zt:overflow-auto");
  return {
    set(preview) {
      path.setText(preview?.path ?? "");
      properties.setText(preview ? stringifyYaml(preview.properties) : "");
      body.setText(preview?.body ?? "");
    },
  };
}
