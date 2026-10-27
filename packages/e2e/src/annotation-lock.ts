import { expect } from "vitest";

import { ATTACHMENTS } from "@zotlit/scripts/fixture";
// The lock on an External Annotation, walked end to end: Zotero imports the
// highlight a Fixture PDF embeds, and ZotLit then refuses every edit of it on
// the Annotation Card and in the reader, as Zotero's own reader does.
//
// @see https://github.com/aidenlx/zotlit/issues/1270

import { obRunUntil, obRun } from "./obsidian-cli.ts";
import { clearNotices, waitFor } from "./obsidian-cli.ts";
import type { AnnotationLeaf } from "./page-notes-types.ts";
import type { ZoteroRdp } from "./paired-zotero.ts";
import {
  openPdfWithAnnotationView,
  raiseWindow,
  reopenPdfView,
  settledGesture,
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
 * - in an Annotation View moved to a pop-out window, the card shows the lock,
 *   its colour is dimmed, and a press gives the Lock Reason;
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
  await raiseWindow(vaultId);
  await openPdfWithAnnotationView(vaultId, { attachmentPath, cleanup });
  // The lock is the only thing in the way: the Attachment is writable, so a
  // press that says the Lock Reason says it for the lock alone.
  await obRunUntil(
    vaultId,
    async ({ zotlit }, { attachmentKey }) => {
      const { annotationRepository: repository, bridge } = zotlit.services;
      await bridge.runPromise(repository.probe);
      const list = await bridge.runPromise(repository.read(attachmentKey));
      return `${String(list?.source.kind)}/${
        bridge.runSync(repository.capabilityFor(attachmentKey)).kind
      }`;
    },
    { attachmentKey: attachment.key },
    {
      ready: (value) => value === "zotero-local-api/writable",
      what: "the attachment source and capability to read zotero-local-api/writable",
    },
  );

  const reason = m.annot_view_lock_external();
  /** Selects the card alone, in whichever window its view stands. */
  const selectCardAlone = async () => {
    // Setup inside a poll that retries until the card shows, not the press
    // under test.
    await obRunUntil(
      vaultId,
      async ({ app }, { annotationKey }) => {
        const card = (
          app.workspace.getLeavesOfType(
            "zotero-annotation-view",
          ) as AnnotationLeaf[]
        )[0]?.view?.containerEl.querySelector<HTMLElement>(
          `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
            annotationKey,
          )}]`,
        )!;
        if (!card) return "no card";
        if (!card!.hasAttribute("data-alone")) card!.click();
        return card!.hasAttribute("data-alone");
      },
      { annotationKey },
      { what: "the annotation card to be marked alone in the Annotation View" },
    );
  };
  /** Whether the node that takes a verb's press is dimmed, or `absent`. */
  const dimmed = (node: string) =>
    obRun(
      vaultId,
      async ({ app }, { annotationKey, nodeSelector }) => {
        const node = (
          app.workspace.getLeavesOfType(
            "zotero-annotation-view",
          ) as AnnotationLeaf[]
        )[0]?.view?.containerEl
          .querySelector<HTMLElement>(
            `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
              annotationKey,
            )}]`,
          )!
          .querySelector<HTMLElement>(nodeSelector)!;
        return node ? String(node.hasAttribute("data-blocked")) : "absent";
      },
      { annotationKey, nodeSelector: node },
    );

  // The card quotes the text Zotero took from the page, and shows the lock
  // with the Lock Reason as its name.
  await obRunUntil(
    vaultId,
    async ({ app }, { annotationKey }) => {
      return !!app.workspace
        .getLeavesOfType("zotero-annotation-view")[0]
        ?.view?.containerEl.querySelector<HTMLElement>(
          `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
            annotationKey,
          )}]`,
        )
        ?.querySelector<HTMLElement>(".zt-annot-lock")!;
    },
    { annotationKey },
    { what: "the lock icon on the annotation card in the Annotation View" },
  );
  expect(
    await obRun(
      vaultId,
      async ({ app }, { annotationKey }) => {
        const card = (
          app.workspace.getLeavesOfType(
            "zotero-annotation-view",
          ) as AnnotationLeaf[]
        )[0]?.view?.containerEl.querySelector<HTMLElement>(
          `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
            annotationKey,
          )}]`,
        )!;
        return {
          quote:
            card!
              .querySelector<HTMLElement>("blockquote")
              ?.textContent.trim() ?? "",
          lock: card!
            .querySelector<HTMLElement>(".zt-annot-lock")!
            .getAttribute("aria-label"),
        };
      },
      { annotationKey },
    ),
  ).toEqual({
    quote: QUOTED_TEXT,
    lock: m.annot_view_lock_label({ reason }),
  });

  // ── The card selected alone ───────────────────────────────────────────────
  await selectCardAlone();

  const buttonByLabel = (label: string) =>
    `[role=button][aria-label=${JSON.stringify(label)}]`;
  /** Each verb the lock refuses on the card, by the node that takes its press. */
  const cardVerbs = {
    "Edit quoted text": buttonByLabel(m.annot_view_menu_edit_text()),
    comment: ".zt-annot-comment-field",
    colour: buttonByLabel(m.annot_view_card_color()),
    tags: buttonByLabel(m.annot_view_card_add_tags()),
  };

  for (const [verb, node] of Object.entries(cardVerbs)) {
    expect(await dimmed(node), `${verb} is not dimmed`).toBe("true");
    await clearNotices(vaultId);
    await obRun(
      vaultId,
      async ({ app, page }, { annotationKey, node, verb }) => {
        const { press } = page;
        press(
          (
            app.workspace.getLeavesOfType(
              "zotero-annotation-view",
            ) as AnnotationLeaf[]
          )[0]?.view?.containerEl
            .querySelector<HTMLElement>(
              `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
                annotationKey,
              )}]`,
            )!
            .querySelector<HTMLElement>(node)!,
          verb,
        );
        return String(true);
      },
      { annotationKey, node, verb },
    );
    // The press says the Lock Reason, and offers nothing to press: a lock
    // is not lifted from here.
    await obRunUntil(
      vaultId,
      async ({ page }, { reason }) => {
        return page
          .windowDocuments()
          .flatMap((doc) => [...doc.querySelectorAll<HTMLElement>(".notice")])
          .filter((node) => node.textContent.includes(reason)).length;
      },
      { reason },
      {
        ready: (value) => value === 1,
        what: "the lock notice naming the Lock Reason to appear once",
      },
    );
    expect(
      await obRun(
        vaultId,
        async ({ page }, { reason }) => {
          return String(
            page
              .windowDocuments()
              .flatMap((doc) => [
                ...doc.querySelectorAll<HTMLElement>(".notice"),
              ])
              .filter((node) => node.textContent.includes(reason))[0]!
              .querySelectorAll<HTMLButtonElement>("button").length,
          );
        },
        { reason },
      ),
      `a press on ${verb} offers a button`,
    ).toBe("0");
  }
  // No press opened an editor on the card!.
  expect(
    await obRun(
      vaultId,
      async ({ app }, { annotationKey }) => {
        return String(
          !!(app.workspace
            .getLeavesOfType("zotero-annotation-view")[0]
            ?.view?.containerEl.querySelector<HTMLElement>(
              `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
                annotationKey,
              )}]`,
            )!).querySelector<HTMLElement>(".cm-content, input")!,
        );
      },
      { annotationKey },
    ),
  ).toBe("false");

  // A press on the card menu's delete entry gives the Lock Reason, and asks
  // nothing.
  await clearNotices(vaultId);
  await obRun(
    vaultId,
    async ({ app, page }, { annotationKey }) => {
      const { press } = page;
      press(
        ((
          app.workspace.getLeavesOfType(
            "zotero-annotation-view",
          ) as AnnotationLeaf[]
        )[0]?.view?.containerEl.querySelector<HTMLElement>(
          `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
            annotationKey,
          )}]`,
        )!).querySelector<HTMLElement>(
          ".clickable-icon:has(svg.lucide-more-horizontal)",
        )!,
        "card menu",
      );
      return String(true);
    },
    { annotationKey },
  );

  await obRunUntil(
    vaultId,
    async (_context, { menuItemLabel }) => {
      return !![
        ...document.querySelectorAll<HTMLElement>(".menu .menu-item"),
      ].find((node) => node.textContent.trim() === menuItemLabel);
    },
    { menuItemLabel: m.annot_view_menu_delete() },
    { what: "the lock menu item to appear in the open menu" },
  );
  await obRun(
    vaultId,
    async ({ page }, { menuItemLabel }) => {
      const { press } = page;
      press(
        [...document.querySelectorAll<HTMLElement>(".menu .menu-item")].find(
          (node) => node.textContent.trim() === menuItemLabel,
        ),
        "delete entry",
      );
      return String(true);
    },
    { menuItemLabel: m.annot_view_menu_delete() },
  );
  await obRunUntil(
    vaultId,
    async ({ page }, { reason }) => {
      return page
        .windowDocuments()
        .flatMap((doc) => [...doc.querySelectorAll<HTMLElement>(".notice")])
        .filter((node) => node.textContent.includes(reason)).length;
    },
    { reason },
    {
      ready: (value) => value === 1,
      what: "the second lock notice naming the Lock Reason to appear",
    },
  );
  expect(
    await obRun(
      vaultId,
      async ({ page }, { reason }) => {
        return {
          buttons: page
            .windowDocuments()
            .flatMap((doc) => [...doc.querySelectorAll<HTMLElement>(".notice")])
            .filter((node) => node.textContent.includes(reason))[0]!
            .querySelectorAll<HTMLButtonElement>("button").length,
          modals: document.querySelectorAll<HTMLElement>(".modal").length,
        };
      },
      { reason },
    ),
  ).toEqual({ buttons: 0, modals: 0 });
  await obRun(
    vaultId,
    async (_context) => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      return String(true);
    },
    undefined,
  );
  await obRunUntil(
    vaultId,
    async (_context) => {
      return document.querySelectorAll<HTMLElement>(".menu").length;
    },
    undefined,
    { ready: (value) => value === 0, what: "the open menus to close" },
  );

  // ── The Mark Popup ────────────────────────────────────────────────────────
  // A fresh binding holds no selection, so the mark click below opens the
  // popup on this mark.
  await reopenPdfView(vaultId, attachmentPath);

  await obRunUntil(
    vaultId,
    async ({ page }, { attachmentPath, annotationKey }) => {
      const rect = page
        .pdfView(attachmentPath)
        ?.containerEl.querySelector<HTMLElement>(
          `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(
            annotationKey,
          )}]`,
        )
        ?.getBoundingClientRect();
      return !!rect && rect.width > 0;
    },
    { attachmentPath, annotationKey },
    {
      what: "the PDF annotation mark for the locked annotation to have a width",
    },
  );
  await obRun(
    vaultId,
    async ({ page }, { attachmentPath, annotationKey }) => {
      const { tap } = page;
      const rect = (page
        .pdfView(attachmentPath)
        ?.containerEl.querySelector<HTMLElement>(
          `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(
            annotationKey,
          )}]`,
        )!).getBoundingClientRect();
      tap(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return String(true);
    },
    { attachmentPath, annotationKey },
  );
  await obRunUntil(
    vaultId,
    async ({ page }, { attachmentPath, annotationKey }) => {
      return (
        !!document.querySelector<HTMLElement>(".zt-pdf-mark-popup")! &&
        (page
          .pdfView(attachmentPath)
          ?.containerEl.querySelector<HTMLElement>(
            `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(
              annotationKey,
            )}]`,
          )!).classList.contains("is-selected")
      );
    },
    { attachmentPath, annotationKey },
    { what: "the PDF mark popup to open with the annotation mark selected" },
  );
  expect(
    await obRun(
      vaultId,
      async (_context) => {
        const popup =
          document.querySelector<HTMLElement>(".zt-pdf-mark-popup")!;
        const verbs: Record<
          string,
          { dimmed: boolean; tooltip: string | null }
        > = {};
        for (const id of ["color", "tags", "delete"]) {
          const node = popup!.querySelector<HTMLElement>(
            `[data-zt-verb=${id}]`,
          )!;
          verbs[id] = {
            dimmed: node?.getAttribute("aria-disabled") === "true",
            tooltip: node?.getAttribute("aria-label") ?? null,
          };
        }
        return verbs;
      },
      undefined,
    ),
  ).toEqual({
    color: { dimmed: true, tooltip: reason },
    tags: { dimmed: true, tooltip: reason },
    delete: { dimmed: true, tooltip: reason },
  });
  // The popup stands on the selected mark, so its handles would stand too.
  expect(
    await obRun(
      vaultId,
      async ({ page }, { attachmentPath }) => {
        return String(
          page
            .pdfView(attachmentPath)!
            .containerEl.querySelectorAll<HTMLElement>(
              ".zt-pdf-annotation-handle",
            ).length,
        );
      },
      { attachmentPath },
    ),
  ).toBe("0");
  // Each dimmed verb takes its press and runs nothing: it opens no menu, no
  // tag section and no confirmation, and it shows no notice, since its
  // tooltip already names the Lock Reason. The popup stays on the mark.
  for (const verb of ["color", "tags", "delete"]) {
    await clearNotices(vaultId);
    await obRun(
      vaultId,
      async ({ page }, { verb }) => {
        const { press } = page;
        press(
          document.querySelector<HTMLElement>(
            `.zt-pdf-mark-popup [data-zt-verb=${JSON.stringify(verb)}]`,
          )!,
          `popup ${verb}`,
        );
        return String(true);
      },
      { verb },
    );
    // The press and whatever it would open are done: the gesture settles.
    await settledGesture(vaultId, attachmentPath);
    expect(
      await obRun(
        vaultId,
        async (_context) => {
          return {
            popup: !!document.querySelector<HTMLElement>(".zt-pdf-mark-popup")!,
            menus: document.querySelectorAll<HTMLElement>(".menu").length,
            modals: document.querySelectorAll<HTMLElement>(".modal").length,
            tagSection: !!document.querySelector<HTMLElement>(
              ".zt-pdf-mark-popup input",
            )!,
            notices: document.querySelectorAll<HTMLElement>(".notice").length,
          };
        },
        undefined,
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

  // ── The Annotation View in a pop-out window ───────────────────────────────
  // The view keeps the Attachment it shows, and moves to a window of its own.
  expect(
    await obRun(
      vaultId,
      async ({ app }) => {
        const leaf = (
          app.workspace.getLeavesOfType(
            "zotero-annotation-view",
          ) as AnnotationLeaf[]
        )[0]!;
        if (!leaf) return String(false);
        leaf.view.gestures!.onPinCurrentItem();
        app.workspace.moveLeafToPopout(leaf);
        return String(true);
      },
      undefined,
    ),
  ).toBe("true");
  cleanup.defer(async () => {
    await obRun(
      vaultId,
      async ({ app }) => {
        for (const leaf of app.workspace.getLeavesOfType(
          "zotero-annotation-view",
        ) as AnnotationLeaf[])
          if (leaf.view.containerEl.win !== window) leaf.detach();
        return String(true);
      },
      undefined,
    );
  });
  await obRunUntil(
    vaultId,
    async ({ app }, { annotationKey }) => {
      const card = (
        app.workspace.getLeavesOfType(
          "zotero-annotation-view",
        ) as AnnotationLeaf[]
      )[0]?.view?.containerEl.querySelector<HTMLElement>(
        `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
          annotationKey,
        )}]`,
      )!;
      return (
        !!card &&
        card!.win !== window &&
        !!card!.querySelector<HTMLElement>(".zt-annot-lock")!
      );
    },
    { annotationKey },
    { what: "the lock icon on the annotation card in the detached window" },
  );
  expect(
    await obRun(
      vaultId,
      async ({ app }, { annotationKey }) => {
        return (app.workspace
          .getLeavesOfType("zotero-annotation-view")[0]
          ?.view?.containerEl.querySelector<HTMLElement>(
            `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
              annotationKey,
            )}]`,
          )!)
          .querySelector<HTMLElement>(".zt-annot-lock")!
          .getAttribute("aria-label");
      },
      { annotationKey },
    ),
  ).toBe(m.annot_view_lock_label({ reason }));
  await selectCardAlone();
  expect(
    await dimmed(cardVerbs.colour),
    "colour is not dimmed in the pop-out window",
  ).toBe("true");
  await clearNotices(vaultId);
  await obRun(
    vaultId,
    async ({ app, page }, { annotationKey, colour }) => {
      const { press } = page;
      press(
        (
          app.workspace.getLeavesOfType(
            "zotero-annotation-view",
          ) as AnnotationLeaf[]
        )[0]?.view?.containerEl
          .querySelector<HTMLElement>(
            `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
              annotationKey,
            )}]`,
          )!
          .querySelector<HTMLElement>(colour)!,
        "colour",
      );
      return String(true);
    },
    { annotationKey, colour: cardVerbs.colour },
  );
  await obRunUntil(
    vaultId,
    async ({ page }, { reason }) => {
      return page
        .windowDocuments()
        .flatMap((doc) => [...doc.querySelectorAll<HTMLElement>(".notice")])
        .filter((node) => node.textContent.includes(reason)).length;
    },
    { reason },
    {
      ready: (value) => value === 1,
      what: "the lock notice naming the Lock Reason after the detached window press",
    },
  );
  expect(
    await obRun(
      vaultId,
      async ({ page }, { reason }) => {
        return {
          buttons: page
            .windowDocuments()
            .flatMap((doc) => [...doc.querySelectorAll<HTMLElement>(".notice")])
            .filter((node) => node.textContent.includes(reason))[0]!
            .querySelectorAll<HTMLButtonElement>("button").length,
          menus: page
            .windowDocuments()
            .reduce(
              (count, doc) =>
                count + doc.querySelectorAll<HTMLElement>(".menu").length,
              0,
            ),
        };
      },
      { reason },
    ),
  ).toEqual({ buttons: 0, menus: 0 });

  // ── Zotero ────────────────────────────────────────────────────────────────
  expect(await readHeldAnnotation()).toEqual(imported);
}
