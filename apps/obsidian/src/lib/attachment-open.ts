// Sending a reader to one Item's Attachments, shared by every surface that offers the action.

import { Keymap, Menu, SuggestModal } from "obsidian";
import type { App, PaneType } from "obsidian";
import type { MouseEvent as ReactMouseEvent } from "react";

import { attachmentOpenUri } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import type { ObsidianOpenableAttachment } from "@/services/attachment-open/resolve";
import type { ZoteroOpenableAttachment } from "@/services/citation-index/service";

const logger = getLogger("attachment-open");

/** One row a picker offers, whichever reader it opens through. */
interface OpenableRow {
  label: string;
}

/** Where an Attachment opens, and how — the selection policy stays written once and shared by both. */
export interface AttachmentReader<T extends OpenableRow> {
  /** Icon a picker row gets. */
  icon: string;
  /** Open one Attachment, honoring a Mod-click/Mod-Enter's new-pane request. */
  open: (attachment: T, pane: PaneType | boolean) => void | Promise<void>;
  /**
   * Nothing qualified. Omit to leave the click inert — a reader whose caller
   * already hides its own control over an empty list (the Zotero readers)
   * needs no notice of its own.
   */
  onEmpty?: () => void;
}

/** A reader that always opens onto `pane`, ignoring what its own click would have chosen. */
export function withFixedPane<T extends OpenableRow>(
  reader: AttachmentReader<T>,
  pane: PaneType | boolean,
): AttachmentReader<T> {
  return { ...reader, open: (attachment) => reader.open(attachment, pane) };
}

/**
 * A click a caller can hand `openAttachments`: React's `SyntheticEvent` wrapper
 * from the two React surfaces (Citation Popover, References Sidebar), or the
 * DOM event Obsidian's own `MenuItem.onClick` hands the Literature Note file
 * menu — Obsidian dispatches either a `MouseEvent` or, for a keyboard-driven
 * selection, a `KeyboardEvent`.
 */
export type AttachmentOpenClickEvent =
  | ReactMouseEvent
  | MouseEvent
  | KeyboardEvent;

/**
 * A pointer event shows a context menu at the click; no event (the protocol
 * handler, the command palette, the quick switcher) shows a Suggest modal
 * picker instead, which then needs an `App` to host it. The picker differs by
 * invocation, not by reader.
 */
export type OpenAttachmentsOptions<T extends OpenableRow> =
  | {
      reader: AttachmentReader<T>;
      event: AttachmentOpenClickEvent;
      /**
       * Where a keyboard click anchors its picker. An async handler reaches
       * its first `await` before the picker opens, and `currentTarget` is null
       * by then, so such a caller reads the rect while dispatch is still live
       * and passes it here.
       */
      anchor?: DOMRect;
    }
  | { reader: AttachmentReader<T>; app: App };

/** The DOM event a click carries, unwrapped from React's `SyntheticEvent`. */
function nativeEventOf(
  event: AttachmentOpenClickEvent,
): MouseEvent | KeyboardEvent {
  return "nativeEvent" in event ? event.nativeEvent : event;
}

/**
 * Send a reader to the Item's Attachments: one opens straight away, several
 * offer a picker, and an empty list defers to {@link AttachmentReader.onEmpty}
 * — the selection policy stays written once here, for every entry point.
 */
export function openAttachments<T extends OpenableRow>(
  attachments: readonly T[],
  options: OpenAttachmentsOptions<T>,
): void {
  const { reader } = options;
  const [first, ...rest] = attachments;
  if (!first) {
    reader.onEmpty?.();
    return;
  }
  if (rest.length === 0) {
    void reader.open(
      first,
      "event" in options
        ? Keymap.isModEvent(nativeEventOf(options.event))
        : false,
    );
    return;
  }
  if ("event" in options) {
    showAttachmentMenu(attachments, reader, {
      event: options.event,
      anchor: options.anchor,
    });
    return;
  }
  new AttachmentPickerModal(options.app, attachments, reader).open();
}

/** Zotero's own reader, reached through the deep link it registers on the OS. */
export const zoteroAttachmentReader: AttachmentReader<ZoteroOpenableAttachment> =
  {
    icon: "paperclip",
    open({ key, groupID }) {
      window.open(attachmentOpenUri(key, groupID));
    },
  };

/**
 * Obsidian's own PDF view, opened through its workspace. `Vault.getFileByPath`
 * already answers `null` for a path with no real file behind it — an in-vault
 * path absent from `fileMap`, or (via Obsidian's external-file fall-through) a
 * `file:`-prefixed path `lstat` finds nothing at — so that `null` is the one
 * signal a Zotero library moving or deleting an Attachment between the read
 * that offered it and the click needs to be caught by.
 *
 * @param onOpened runs once the file is on screen, and only then — a missing
 * file leaves it unrun, so a caller can hang follow-up UI off a real open.
 */
export function createObsidianAttachmentReader(
  app: App,
  { onOpened }: { onOpened?: () => void } = {},
): AttachmentReader<ObsidianOpenableAttachment> {
  return {
    icon: "file-text",
    onEmpty: () => new BaseNotice(m.notice_no_pdf_attachment()),
    async open(attachment, pane) {
      const file = app.vault.getFileByPath(attachment.openPath);
      if (!file) {
        logger.warn("Obsidian did not resolve the Attachment's open path", {
          openPath: attachment.openPath,
        });
        new BaseNotice(m.notice_pdf_file_missing());
        return;
      }
      await app.workspace.getLeaf(pane).openFile(file);
      onOpened?.();
    },
  };
}

/**
 * Offer one row per Attachment. A keyboard click carries no pointer position
 * (`detail` of `0`), so the menu takes the button's own corner instead of the
 * window's.
 */
function showAttachmentMenu<T extends OpenableRow>(
  attachments: readonly T[],
  reader: AttachmentReader<T>,
  click: { event: AttachmentOpenClickEvent; anchor?: DOMRect },
): void {
  const menu = new Menu();
  for (const attachment of attachments) {
    menu.addItem((item) =>
      item
        .setTitle(attachment.label)
        .setIcon(reader.icon)
        .onClick((evt) => void reader.open(attachment, Keymap.isModEvent(evt))),
    );
  }

  const { event, anchor } = click;
  if (event.detail === 0) {
    const { left, bottom } =
      anchor ??
      (
        event.currentTarget as { getBoundingClientRect: () => DOMRect }
      ).getBoundingClientRect();
    menu.showAtPosition({ x: left, y: bottom });
    return;
  }
  menu.showAtMouseEvent(nativeEventOf(event) as MouseEvent);
}

/** The picker for an event-less invocation: the protocol handler, the command palette, the quick switcher. */
class AttachmentPickerModal<T extends OpenableRow> extends SuggestModal<T> {
  readonly #attachments: readonly T[];
  readonly #reader: AttachmentReader<T>;

  constructor(
    app: App,
    attachments: readonly T[],
    reader: AttachmentReader<T>,
  ) {
    super(app);
    this.#attachments = attachments;
    this.#reader = reader;
    this.setPlaceholder(m.modal_select_pdf_placeholder());
  }

  override getSuggestions(query: string): T[] {
    const needle = query.toLowerCase();
    return this.#attachments.filter((attachment) =>
      attachment.label.toLowerCase().includes(needle),
    );
  }

  override renderSuggestion(attachment: T, el: HTMLElement): void {
    el.setText(attachment.label);
  }

  override onChooseSuggestion(
    attachment: T,
    evt: MouseEvent | KeyboardEvent,
  ): void {
    void this.#reader.open(attachment, Keymap.isModEvent(evt));
  }
}
