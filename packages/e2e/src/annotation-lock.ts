// The lock on an External Annotation, walked end to end: Zotero imports the
// highlight a Fixture PDF embeds, and ZotLit then refuses every edit of it on
// the Annotation Card and in the reader, as Zotero's own reader does.
//
// @see https://github.com/aidenlx/zotlit/issues/1270

import { expect } from "vitest";

import { ATTACHMENTS } from "@zotlit/scripts/fixture";

import {
  clearNotices,
  obEval,
  obEvalUntil,
  obJson,
  waitFor,
} from "./obsidian-cli.ts";
import type { ZoteroRdp } from "./paired-zotero.ts";
import {
  FIRE,
  pdfViewOf,
  raiseWindow,
  reopenPdfView,
  settledGesture,
  TAP,
} from "./reader-gestures.ts";

type Messages = typeof import("@obsidian-messages");

/** The Fixture Attachment whose PDF embeds one highlight and seeds nothing. */
const attachment = ATTACHMENTS.find(({ key }) => key === "EXTPDF25")!;
/** Its vault-relative path: the Fixture declares it as a `vault`-rooted link. */
const attachmentPath = attachment.path!;

/**
 * What the embedded highlight covers and says, as
 * `packages/scripts/lib/fixture/assets/external-annotation/generate.ts` writes
 * the PDF.
 */
const QUOTED_TEXT = "Another PDF reader highlighted this sentence.";
const COMMENT = "Noted in another PDF reader.";

const ATTACHMENT_ITEM = `Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, ${JSON.stringify(attachment.key)})`;

/** One Annotation as Zotero holds it: every field an edit or a delete moves. */
interface HeldAnnotation {
  isExternal: boolean;
  version: number;
  dateModified: string;
  deleted: boolean;
  text: string;
  comment: string;
  color: string;
  position: string;
  sortIndex: string;
  pageLabel: string;
  tags: { tag: string; type?: number }[];
}

/**
 * Opens the External Annotation PDF in Zotero's reader, which imports its
 * embedded highlight, and walks the lock ZotLit puts on it:
 *
 * - the card quotes the imported text and shows the lock;
 * - on the card selected alone, "Edit quoted text", the comment field, colour
 *   and tags are dimmed, and a press gives the Lock Reason with no Allow
 *   editing;
 * - a press on the delete entry of the card menu gives the Lock Reason, and
 *   asks nothing;
 * - the Mark Popup dims colour, tags and delete with the Lock Reason as
 *   tooltip, and draws no Mark Handles;
 * - Zotero keeps the Annotation unchanged.
 *
 * Every write refused here is a lock refusal only while the Attachment is
 * otherwise writable, so the caller seeds the Write Authorization first.
 */
export async function verifyExternalAnnotationLock({
  vaultId,
  rdp,
  m,
}: {
  vaultId: string;
  rdp: ZoteroRdp;
  m: Messages;
}): Promise<void> {
  await using cleanup = new AsyncDisposableStack();

  // ── The import ────────────────────────────────────────────────────────────
  // The Fixture seeds no Annotation on this Attachment and leaves its PDF
  // unprocessed, so opening it in Zotero's reader imports the embedded
  // highlight, as it does for a researcher who opens the PDF.
  expect(
    await rdp.json<number>(`${ATTACHMENT_ITEM}.getAnnotations().length`),
  ).toBe(0);
  const readerTab = await rdp.json<string>(`(async () => {
    const reader = await Zotero.Reader.open(${ATTACHMENT_ITEM}.id);
    return reader.tabID;
  })()`);
  cleanup.defer(async () => {
    // Puts the Attachment back as the Fixture seeds it: no Annotation, and a
    // PDF Zotero has not processed, so its next open imports again.
    await rdp.json(`(async () => {
      const attachment = ${ATTACHMENT_ITEM};
      for (const annotation of attachment.getAnnotations()) {
        await annotation.eraseTx();
      }
      attachment.attachmentLastProcessedModificationTime = 0;
      await attachment.saveTx({ skipAll: true });
      return "restored";
    })()`);
  });
  cleanup.defer(async () => {
    await rdp.json(`(() => {
      Zotero.Reader.getByTabID(${JSON.stringify(readerTab)})?.close();
      return "closed";
    })()`);
  });
  const heldKeys = () =>
    rdp.json<string[]>(
      `${ATTACHMENT_ITEM}.getAnnotations().map(({ key }) => key)`,
    );
  expect(
    await waitFor(async () => (await heldKeys()).length > 0),
    "Zotero imported no Annotation from the PDF",
  ).toBe(true);
  const [annotationKey = ""] = await heldKeys();

  const readHeldAnnotation = () =>
    rdp.json<{ count: number; annotation: HeldAnnotation }>(`(() => {
      const attachment = ${ATTACHMENT_ITEM};
      const item = Zotero.Items.getByLibraryAndKey(
        Zotero.Libraries.userLibraryID,
        ${JSON.stringify(annotationKey)},
      );
      return {
        count: attachment.getAnnotations().length,
        annotation: {
          isExternal: item.annotationIsExternal,
          version: item.version,
          dateModified: item.dateModified,
          deleted: item.deleted,
          text: item.annotationText,
          comment: item.annotationComment,
          color: item.annotationColor,
          position: item.annotationPosition,
          sortIndex: item.annotationSortIndex,
          pageLabel: item.annotationPageLabel,
          tags: item.getTags(),
        },
      };
    })()`);
  const imported = await readHeldAnnotation();
  expect(imported).toMatchObject({
    count: 1,
    annotation: {
      isExternal: true,
      deleted: false,
      text: QUOTED_TEXT,
      comment: COMMENT,
    },
  });

  // ── The PDF and its card in Obsidian ──────────────────────────────────────
  const layout = await obEval(
    vaultId,
    "JSON.stringify(app.workspace.getLayout())",
  );
  cleanup.defer(async () => {
    await obEval(
      vaultId,
      `(async()=>{await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));return true;})()`,
    );
  });
  await raiseWindow(vaultId);
  await obEval(
    vaultId,
    `(async()=>{const file=app.vault.getFileByPath(${JSON.stringify(attachmentPath)});await app.workspace.getLeaf('tab').openFile(file);return true;})()`,
  );
  expect(
    await obEvalUntil(
      vaultId,
      `String(!!app.plugins.plugins.zotlit.services.pdfAnnotationEditor.sessionForPath(${JSON.stringify(attachmentPath)}))`,
      { expected: "true" },
    ),
  ).toBe(true);
  await obEval(
    vaultId,
    "app.commands.executeCommandById('zotlit:open-annot-view');true",
  );
  await obEval(
    vaultId,
    "app.commands.executeCommandById('zotlit:annot-view-follow-active-tab');true",
  );
  // The lock is the only thing in the way: the Attachment is writable, so a
  // press that says the Lock Reason says it for the lock alone.
  expect(
    await obEvalUntil(
      vaultId,
      `(async()=>{const repository=app.plugins.plugins.zotlit.services.annotationRepository;await repository.probe();const list=await repository.read(${JSON.stringify(attachment.key)});return String(list?.source.kind)+'/'+repository.capabilityFor(${JSON.stringify(attachment.key)}).kind;})()`,
      { expected: "zotero-local-api/writable" },
    ),
  ).toBe(true);

  const pdfView = pdfViewOf(attachmentPath);
  const annotView =
    "app.workspace.getLeavesOfType('zotero-annotation-view')[0]?.view";
  const card = `${annotView}?.containerEl.querySelector('.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(annotationKey)}]')`;
  const reason = m.annot_view_lock_external();

  // The card quotes the text Zotero took from the page, and shows the lock
  // with the Lock Reason as its name.
  expect(
    await obEvalUntil(
      vaultId,
      `String(!!(${card})?.querySelector('.zt-annot-lock'))`,
      { expected: "true" },
    ),
    "the imported Annotation's card shows no lock",
  ).toBe(true);
  expect(
    await obJson<{ quote: string; lock: string | null }>(
      vaultId,
      `(function(){const card=${card};return JSON.stringify({quote:card.querySelector('blockquote')?.textContent.trim()??'',lock:card.querySelector('.zt-annot-lock').getAttribute('aria-label')});})()`,
    ),
  ).toEqual({
    quote: QUOTED_TEXT,
    lock: m.annot_view_lock_label({ reason }),
  });

  // ── The card selected alone ───────────────────────────────────────────────
  expect(
    await obEvalUntil(
      vaultId,
      `(function(){const card=${card};if(!card)return 'no card';if(!card.hasAttribute('data-alone'))card.click();return String(card.hasAttribute('data-alone'));})()`,
      { expected: "true" },
    ),
  ).toBe(true);

  const buttonByLabel = (label: string) =>
    `(${card}).querySelector('[role=button][aria-label=${JSON.stringify(label)}]')`;
  /** Each verb the lock refuses on the card, by the node that takes its press. */
  const cardVerbs = {
    "Edit quoted text": buttonByLabel(m.annot_view_menu_edit_text()),
    comment: `(${card}).querySelector('.zt-annot-comment-field')`,
    colour: buttonByLabel(m.annot_view_card_color()),
    tags: buttonByLabel(m.annot_view_card_add_tags()),
  };
  const noticeShown = `[...document.querySelectorAll('.notice')].filter((node)=>node.textContent.includes(${JSON.stringify(reason)}))`;
  for (const [verb, node] of Object.entries(cardVerbs)) {
    expect(
      await obEval(
        vaultId,
        `(function(){const node=${node};return node?String(node.hasAttribute('data-blocked')):'absent';})()`,
      ),
      `${verb} is not dimmed`,
    ).toBe("true");
    await clearNotices(vaultId);
    await obEval(vaultId, `((${node}).click(),true)`);
    // The press says the Lock Reason, and offers nothing to press: a lock
    // is not lifted from here.
    expect(
      await obEvalUntil(vaultId, `String(${noticeShown}.length)`, {
        expected: "1",
      }),
      `a press on ${verb} gives no Lock Reason`,
    ).toBe(true);
    expect(
      await obEval(
        vaultId,
        `String(${noticeShown}[0].querySelectorAll('button').length)`,
      ),
      `a press on ${verb} offers a button`,
    ).toBe("0");
  }
  // No press opened an editor on the card.
  expect(
    await obEval(
      vaultId,
      `String(!!(${card}).querySelector('.cm-content, input'))`,
    ),
  ).toBe("false");

  // A press on the card menu's delete entry gives the Lock Reason, and asks
  // nothing.
  await clearNotices(vaultId);
  await obEval(
    vaultId,
    `((${card}).querySelector('.clickable-icon:has(svg.lucide-more-horizontal)').click(),true)`,
  );
  const deleteEntry = `[...document.querySelectorAll('.menu .menu-item')].find((node)=>node.textContent.trim()===${JSON.stringify(m.annot_view_menu_delete())})`;
  expect(
    await obEvalUntil(vaultId, `String(!!${deleteEntry})`, {
      expected: "true",
    }),
    "the card menu has no delete entry",
  ).toBe(true);
  await obEval(vaultId, `(${deleteEntry}.click(),true)`);
  expect(
    await obEvalUntil(vaultId, `String(${noticeShown}.length)`, {
      expected: "1",
    }),
    "a press on the card menu's delete entry gives no Lock Reason",
  ).toBe(true);
  expect(
    await obJson<{ buttons: number; modals: number }>(
      vaultId,
      `JSON.stringify({buttons:${noticeShown}[0].querySelectorAll('button').length,modals:document.querySelectorAll('.modal').length})`,
    ),
  ).toEqual({ buttons: 0, modals: 0 });
  await obEval(
    vaultId,
    "(function(){document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return true;})()",
  );
  expect(
    await obEvalUntil(
      vaultId,
      "String(document.querySelectorAll('.menu').length)",
      {
        expected: "0",
      },
    ),
  ).toBe(true);

  // ── The Mark Popup ────────────────────────────────────────────────────────
  // A fresh binding holds no selection, so the mark click below opens the
  // popup on this mark.
  await reopenPdfView(vaultId, attachmentPath);
  const mark = `${pdfView}?.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(annotationKey)}]')`;
  expect(
    await obEvalUntil(
      vaultId,
      `(function(){const rect=(${mark})?.getBoundingClientRect();return String(!!rect&&rect.width>0);})()`,
      { expected: "true" },
    ),
    "the PDF view draws no mark for the imported Annotation",
  ).toBe(true);
  await obEval(
    vaultId,
    `(function(){${FIRE}${TAP}const rect=(${mark}).getBoundingClientRect();tap(rect.left+rect.width/2,rect.top+rect.height/2);return true;})()`,
  );
  expect(
    await obEvalUntil(
      vaultId,
      `String(!!document.querySelector('.zt-pdf-mark-popup')&&(${mark}).classList.contains('is-selected'))`,
      { expected: "true" },
    ),
    "a click on the mark opens no Mark Popup",
  ).toBe(true);
  expect(
    await obJson<Record<string, { dimmed: boolean; tooltip: string | null }>>(
      vaultId,
      `(function(){const popup=document.querySelector('.zt-pdf-mark-popup');const verbs={};for(const id of ['color','tags','delete']){const node=popup.querySelector('[data-zt-verb='+id+']');verbs[id]={dimmed:node?.getAttribute('aria-disabled')==='true',tooltip:node?.getAttribute('aria-label')??null};}return JSON.stringify(verbs);})()`,
    ),
  ).toEqual({
    color: { dimmed: true, tooltip: reason },
    tags: { dimmed: true, tooltip: reason },
    delete: { dimmed: true, tooltip: reason },
  });
  // The popup stands on the selected mark, so its handles would stand too.
  expect(
    await obEval(
      vaultId,
      `String(${pdfView}.containerEl.querySelectorAll('.zt-pdf-annotation-handle').length)`,
    ),
  ).toBe("0");
  // Each dimmed verb takes its press and runs nothing: it opens no menu, no
  // tag section and no confirmation, and it shows no notice, since its
  // tooltip already names the Lock Reason. The popup stays on the mark.
  for (const verb of ["color", "tags", "delete"]) {
    await clearNotices(vaultId);
    await obEval(
      vaultId,
      `(document.querySelector('.zt-pdf-mark-popup [data-zt-verb=${verb}]').click(),true)`,
    );
    // The press and whatever it would open are done: the gesture settles.
    await settledGesture(vaultId, attachmentPath);
    expect(
      await obJson<Record<string, number | boolean>>(
        vaultId,
        "JSON.stringify({popup:!!document.querySelector('.zt-pdf-mark-popup'),menus:document.querySelectorAll('.menu').length,modals:document.querySelectorAll('.modal').length,tagSection:!!document.querySelector('.zt-pdf-mark-popup input'),notices:document.querySelectorAll('.notice').length})",
      ),
      `a press on the popup's ${verb} verb ran`,
    ).toEqual({
      popup: true,
      menus: 0,
      modals: 0,
      tagSection: false,
      notices: 0,
    });
  }

  // ── Zotero ────────────────────────────────────────────────────────────────
  expect(await readHeldAnnotation()).toEqual(imported);
}
