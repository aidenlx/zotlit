// Choosing which Attachment of the Item on screen the Annotation View reads.
//
// Obsidian's own pattern for picking from a list, in parallel with the item
// picker behind "Choose item…": the menu row opens the suggester, and the
// suggester alone offers the names.
import { FuzzySuggestModal } from "obsidian";
import type { App } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";

import type { AttachmentLine } from "./presentation";

/** The Attachments to choose between, named as `attachmentLine` names them. */
export type AttachmentOptions = Extract<
  AttachmentLine,
  { kind: "picker" }
>["options"];

/**
 * The class the stylesheet lets a long name wrap under. Obsidian clips a
 * suggestion row unlayered, where no `zt:` utility reaches it.
 *
 * @see apps/obsidian/src/views/annot-view/style.css
 */
const SUGGESTER_CLASS = "zt-annot-attachment-suggester";

/**
 * Every Attachment of the Item on screen, by name and Annotation count. This is
 * the one surface whose whole job is telling two similar names apart, so it
 * spends the height a wrapped name takes.
 */
class AttachmentSuggester extends FuzzySuggestModal<AttachmentOptions[number]> {
  readonly #options: AttachmentOptions;
  readonly #choose: (indexedKey: string) => void;

  constructor(
    app: App,
    options: AttachmentOptions,
    choose: (indexedKey: string) => void,
  ) {
    super(app);
    this.#options = options;
    this.#choose = choose;
    this.setPlaceholder(m.annot_view_attachment_choose());
    this.modalEl.addClass(SUGGESTER_CLASS);
  }

  override getItems(): AttachmentOptions {
    return this.#options;
  }

  override getItemText(option: AttachmentOptions[number]): string {
    return option.label;
  }

  override onChooseItem(option: AttachmentOptions[number]): void {
    this.#choose(option.key);
  }
}

/** Open the picker over `options`, showing the Attachment chosen from it. */
export function chooseAttachment(
  app: App,
  options: AttachmentOptions,
  choose: (indexedKey: string) => void,
): void {
  new AttachmentSuggester(app, options, choose).open();
}
