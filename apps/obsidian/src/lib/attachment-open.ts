// Sending a reader to one Item's Attachments, shared by every surface that offers the action.

import { Keymap, Menu, SuggestModal } from "obsidian";
import type { App, PaneType } from "obsidian";
import type { MouseEvent as ReactMouseEvent } from "react";

import { ATTACHMENT_ANCHOR_KEY, attachmentOpenUri } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { showMenuAtBox, showMenuAtButton } from "@/lib/menu";
import type { MenuAnchor } from "@/lib/menu";
import type { WorkspaceEventHost } from "@/lib/obsidian-workspace";
import type {
  ReaderOutcome,
  TargetReader,
} from "@/services/attachment-open/open-target";
import type { ObsidianOpenableAttachment } from "@/services/attachment-open/resolve";
import type { ZoteroOpenableAttachment } from "@/services/citation-index/service";
import { menuSections, raiseMenu } from "@/services/menu-events";

const logger = getLogger("attachment-open");

const SECTION = menuSections("zotlit:attachments-menu");

/** One row a picker offers, whichever reader it opens through. */
type OpenableRow = ObsidianOpenableAttachment | ZoteroOpenableAttachment;

/** Where an Attachment opens, and how — the selection policy stays written once and shared by both. */
export interface AttachmentReader<T extends OpenableRow> {
  /** Icon a picker row gets. */
  icon: string;
  /** Open one Attachment, honoring a Mod-click/Mod-Enter's new-pane request. */
  open: (attachment: T, pane: PaneType | boolean) => unknown;
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
  return {
    ...reader,
    open: (attachment) => reader.open(attachment, pane),
  };
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
 * picker instead. The picker differs by invocation, not by reader. The modal
 * is hosted on the `App`; the menu needs only the `host` workspace it raises
 * `zotlit:attachments-menu` on.
 */
export type OpenAttachmentsOptions<T extends OpenableRow> =
  | {
      reader: AttachmentReader<T>;
      host: WorkspaceEventHost;
      event: AttachmentOpenClickEvent;
      /**
       * The box and window the picker anchors to when the trigger cannot be
       * measured at show time. An async handler reaches its first `await`
       * before the picker opens, and `currentTarget` is null by then, so such a
       * caller reads the box while dispatch is still live and passes it here.
       */
      anchor?: MenuAnchor;
    }
  | { reader: AttachmentReader<T>; app: App; event?: never };

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
      "host" in options
        ? Keymap.isModEvent(nativeEventOf(options.event))
        : false,
    );
    return;
  }
  if ("host" in options) {
    showAttachmentMenu(attachments, reader, {
      host: options.host,
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
 * that offered it and the click needs to be caught by. The reader reports it
 * and shows nothing: the caller decides what a missing file means.
 *
 * @param onOpened runs once the file is on screen, and only then — a missing
 * file leaves it unrun, so a caller can hang follow-up UI off a real open.
 */
export function createObsidianAttachmentReader(
  app: App,
  { onOpened }: { onOpened?: () => void } = {},
): TargetReader {
  return {
    async open(attachment, pane): Promise<ReaderOutcome> {
      const file = app.vault.getFileByPath(attachment.openPath);
      if (!file) {
        logger.debug("Obsidian did not resolve the Attachment's open path", {
          openPath: attachment.openPath,
        });
        return "file-missing";
      }
      // Obsidian's PDF view reads `#page=N` and the rest of its subpath
      // grammar off `eState.subpath`; an absent page opens at the start.
      await app.workspace.getLeaf(pane).openFile(file, {
        eState: { subpath: namingAttachment(attachment) },
      });
      onOpened?.();
      return "opened";
    },
  };
}

/**
 * The subpath an open carries: where to land, and the Attachment it opens.
 * Two Attachments can keep one file, and the PDF view's binding names its
 * Attachment from this rather than from the path when the open names one.
 * Appended rather than re-serialised, so the keys Obsidian reads by name keep
 * the spelling they were written in.
 *
 * @see apps/obsidian/docs/adr/0046-landing-on-a-mark-is-an-ephemeral-state-contract-read-at-the-leaf.md
 */
function namingAttachment({
  subpath,
  indexedKey,
}: ObsidianOpenableAttachment): string {
  const named = `${ATTACHMENT_ANCHOR_KEY}=${encodeURIComponent(indexedKey)}`;
  return subpath ? `${subpath}&${named}` : `#${named}`;
}

/**
 * Offer one row per Attachment, anchored under the control that asked for it —
 * so it lands in the same place whether the control was clicked or activated
 * from the keyboard.
 */
function showAttachmentMenu<T extends OpenableRow>(
  attachments: readonly T[],
  reader: AttachmentReader<T>,
  click: {
    host: WorkspaceEventHost;
    event: AttachmentOpenClickEvent;
    anchor?: MenuAnchor;
  },
): void {
  const menu = new Menu();
  for (const attachment of attachments) {
    menu.addItem((item) =>
      item
        .setSection(SECTION.open)
        .setTitle(attachment.label)
        .setIcon(reader.icon)
        .onClick((evt) => void reader.open(attachment, Keymap.isModEvent(evt))),
    );
  }
  raiseMenu(menu, {
    workspace: click.host.workspace,
    name: "zotlit:attachments-menu",
    info: {
      attachments,
    },
  });

  const { event, anchor } = click;
  if (anchor) {
    showMenuAtBox(menu, anchor);
    return;
  }
  showMenuAtButton(menu, event.currentTarget as HTMLElement);
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
