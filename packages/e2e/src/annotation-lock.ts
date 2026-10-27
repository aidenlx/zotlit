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
  expect(
    await ((options: { expected: string; tries?: number }) =>
      obRunUntil(
        vaultId,
        async ({ zotlit }, { __typedArg0, __typedArg1 }) => {
          const { annotationRepository: repository, bridge } = zotlit.services;
          await bridge.runPromise(repository.probe);
          const list = await bridge.runPromise(repository.read(__typedArg0));
          return String(
            `${String(list?.source.kind)}/${
              bridge.runSync(repository.capabilityFor(__typedArg1)).kind
            }`,
          );
        },
        { __typedArg0: attachment.key, __typedArg1: attachment.key },
        {
          ready: (value) => value === options.expected,
          tries: options.tries,
          what: "lock.ts:174",
        },
      ).then(
        () => true,
        () => false,
      ))({ expected: "zotero-local-api/writable" }),
  ).toBe(true);

  const reason = m.annot_view_lock_external();
  /** Selects the card alone, in whichever window its view stands. */
  const selectCardAlone = async () => {
    // Setup inside a poll that retries until the card shows, not the press
    // under test.
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          vaultId,
          async ({ app }, { __typedArg0 }) => {
            const card = (
              app.workspace.getLeavesOfType(
                "zotero-annotation-view",
              ) as AnnotationLeaf[]
            )[0]?.view?.containerEl.querySelector<HTMLElement>(
              `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
                __typedArg0,
              )}]`,
            )!;
            if (!card) return String("no card");
            if (!card!.hasAttribute("data-alone")) card!.click();
            return String(String(card!.hasAttribute("data-alone")));
          },
          { __typedArg0: annotationKey },
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "lock.ts:191",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
      "the card is not selected alone",
    ).toBe(true);
  };
  /** Whether the node that takes a verb's press is dimmed, or `absent`. */
  const dimmed = (node: string) =>
    obRun(
      vaultId,
      async ({ app }, { __typedArg0, __typedArg1 }) => {
        const node = (
          app.workspace.getLeavesOfType(
            "zotero-annotation-view",
          ) as AnnotationLeaf[]
        )[0]?.view?.containerEl
          .querySelector<HTMLElement>(
            `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
              __typedArg0,
            )}]`,
          )!
          .querySelector<HTMLElement>(__typedArg1)!;
        return String(
          node ? String(node.hasAttribute("data-blocked")) : "absent",
        );
      },
      { __typedArg0: annotationKey, __typedArg1: node },
    );

  // The card quotes the text Zotero took from the page, and shows the lock
  // with the Lock Reason as its name.
  expect(
    await ((options: { expected: string; tries?: number }) =>
      obRunUntil(
        vaultId,
        async ({ app }, { __typedArg0 }) => {
          return String(
            String(
              !!app.workspace
                .getLeavesOfType("zotero-annotation-view")[0]
                ?.view?.containerEl.querySelector<HTMLElement>(
                  `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
                    __typedArg0,
                  )}]`,
                )
                ?.querySelector<HTMLElement>(".zt-annot-lock")!,
            ),
          );
        },
        { __typedArg0: annotationKey },
        {
          ready: (value) => value === options.expected,
          tries: options.tries,
          what: "lock.ts:209",
        },
      ).then(
        () => true,
        () => false,
      ))({ expected: "true" }),
    "the imported Annotation's card shows no lock",
  ).toBe(true);
  expect(
    await obRun(
      vaultId,
      async ({ app }, { __typedArg0 }) => {
        const card = (
          app.workspace.getLeavesOfType(
            "zotero-annotation-view",
          ) as AnnotationLeaf[]
        )[0]?.view?.containerEl.querySelector<HTMLElement>(
          `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
            __typedArg0,
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
      { __typedArg0: annotationKey },
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
      async ({ app, page }, { __typedArg0, __typedArg1, __typedArg2 }) => {
        const { press } = page;
        press(
          (
            app.workspace.getLeavesOfType(
              "zotero-annotation-view",
            ) as AnnotationLeaf[]
          )[0]?.view?.containerEl
            .querySelector<HTMLElement>(
              `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
                __typedArg0,
              )}]`,
            )!
            .querySelector<HTMLElement>(__typedArg1)!,
          __typedArg2,
        );
        return String(true);
      },
      { __typedArg0: annotationKey, __typedArg1: node, __typedArg2: verb },
    );
    // The press says the Lock Reason, and offers nothing to press: a lock
    // is not lifted from here.
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          vaultId,
          async ({ page }, { __typedArg0 }) => {
            return String(
              String(
                page
                  .windowDocuments()
                  .flatMap((doc) => [
                    ...doc.querySelectorAll<HTMLElement>(".notice"),
                  ])
                  .filter((node) => node.textContent.includes(__typedArg0))
                  .length,
              ),
            );
          },
          { __typedArg0: reason },
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "lock.ts:249",
          },
        ).then(
          () => true,
          () => false,
        ))({
        expected: "1",
      }),
      `a press on ${verb} gives no Lock Reason`,
    ).toBe(true);
    expect(
      await obRun(
        vaultId,
        async ({ page }, { __typedArg0 }) => {
          return String(
            String(
              page
                .windowDocuments()
                .flatMap((doc) => [
                  ...doc.querySelectorAll<HTMLElement>(".notice"),
                ])
                .filter((node) => node.textContent.includes(__typedArg0))[0]!
                .querySelectorAll<HTMLButtonElement>("button").length,
            ),
          );
        },
        { __typedArg0: reason },
      ),
      `a press on ${verb} offers a button`,
    ).toBe("0");
  }
  // No press opened an editor on the card!.
  expect(
    await obRun(
      vaultId,
      async ({ app }, { __typedArg0 }) => {
        return String(
          String(
            !!(app.workspace
              .getLeavesOfType("zotero-annotation-view")[0]
              ?.view?.containerEl.querySelector<HTMLElement>(
                `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
                  __typedArg0,
                )}]`,
              )!).querySelector<HTMLElement>(".cm-content, input")!,
          ),
        );
      },
      { __typedArg0: annotationKey },
    ),
  ).toBe("false");

  // A press on the card menu's delete entry gives the Lock Reason, and asks
  // nothing.
  await clearNotices(vaultId);
  await obRun(
    vaultId,
    async ({ app, page }, { __typedArg0 }) => {
      const { press } = page;
      press(
        ((
          app.workspace.getLeavesOfType(
            "zotero-annotation-view",
          ) as AnnotationLeaf[]
        )[0]?.view?.containerEl.querySelector<HTMLElement>(
          `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
            __typedArg0,
          )}]`,
        )!).querySelector<HTMLElement>(
          ".clickable-icon:has(svg.lucide-more-horizontal)",
        )!,
        "card menu",
      );
      return String(true);
    },
    { __typedArg0: annotationKey },
  );

  expect(
    await ((options: { expected: string; tries?: number }) =>
      obRunUntil(
        vaultId,
        async (_context, { __typedArg0 }) => {
          return String(
            String(
              !![
                ...document.querySelectorAll<HTMLElement>(".menu .menu-item"),
              ].find((node) => node.textContent.trim() === __typedArg0),
            ),
          );
        },
        { __typedArg0: m.annot_view_menu_delete() },
        {
          ready: (value) => value === options.expected,
          tries: options.tries,
          what: "lock.ts:279",
        },
      ).then(
        () => true,
        () => false,
      ))({
      expected: "true",
    }),
    "the card menu has no delete entry",
  ).toBe(true);
  await obRun(
    vaultId,
    async ({ page }, { __typedArg0 }) => {
      const { press } = page;
      press(
        [...document.querySelectorAll<HTMLElement>(".menu .menu-item")].find(
          (node) => node.textContent.trim() === __typedArg0,
        ),
        "delete entry",
      );
      return String(true);
    },
    { __typedArg0: m.annot_view_menu_delete() },
  );
  expect(
    await ((options: { expected: string; tries?: number }) =>
      obRunUntil(
        vaultId,
        async ({ page }, { __typedArg0 }) => {
          return String(
            String(
              page
                .windowDocuments()
                .flatMap((doc) => [
                  ...doc.querySelectorAll<HTMLElement>(".notice"),
                ])
                .filter((node) => node.textContent.includes(__typedArg0))
                .length,
            ),
          );
        },
        { __typedArg0: reason },
        {
          ready: (value) => value === options.expected,
          tries: options.tries,
          what: "lock.ts:289",
        },
      ).then(
        () => true,
        () => false,
      ))({
      expected: "1",
    }),
    "a press on the card menu's delete entry gives no Lock Reason",
  ).toBe(true);
  expect(
    await obRun(
      vaultId,
      async ({ page }, { __typedArg0 }) => {
        return {
          buttons: page
            .windowDocuments()
            .flatMap((doc) => [...doc.querySelectorAll<HTMLElement>(".notice")])
            .filter((node) => node.textContent.includes(__typedArg0))[0]!
            .querySelectorAll<HTMLButtonElement>("button").length,
          modals: document.querySelectorAll<HTMLElement>(".modal").length,
        };
      },
      { __typedArg0: reason },
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
  expect(
    await ((options: { expected: string; tries?: number }) =>
      obRunUntil(
        vaultId,
        async (_context) => {
          return String(
            String(document.querySelectorAll<HTMLElement>(".menu").length),
          );
        },
        undefined,
        {
          ready: (value) => value === options.expected,
          tries: options.tries,
          what: "lock.ts:305",
        },
      ).then(
        () => true,
        () => false,
      ))({
      expected: "0",
    }),
  ).toBe(true);

  // ── The Mark Popup ────────────────────────────────────────────────────────
  // A fresh binding holds no selection, so the mark click below opens the
  // popup on this mark.
  await reopenPdfView(vaultId, attachmentPath);

  expect(
    await ((options: { expected: string; tries?: number }) =>
      obRunUntil(
        vaultId,
        async ({ page }, { __typedArg0, __typedArg1 }) => {
          const rect = page
            .pdfView(__typedArg0)
            ?.containerEl.querySelector<HTMLElement>(
              `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(
                __typedArg1,
              )}]`,
            )
            ?.getBoundingClientRect();
          return String(String(!!rect && rect.width > 0));
        },
        { __typedArg0: attachmentPath, __typedArg1: annotationKey },
        {
          ready: (value) => value === options.expected,
          tries: options.tries,
          what: "lock.ts:320",
        },
      ).then(
        () => true,
        () => false,
      ))({ expected: "true" }),
    "the PDF view draws no mark for the imported Annotation",
  ).toBe(true);
  await obRun(
    vaultId,
    async ({ page }, { __typedArg0, __typedArg1 }) => {
      const { tap } = page;
      const rect = (page
        .pdfView(__typedArg0)
        ?.containerEl.querySelector<HTMLElement>(
          `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(
            __typedArg1,
          )}]`,
        )!).getBoundingClientRect();
      tap(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return String(true);
    },
    { __typedArg0: attachmentPath, __typedArg1: annotationKey },
  );
  expect(
    await ((options: { expected: string; tries?: number }) =>
      obRunUntil(
        vaultId,
        async ({ page }, { __typedArg0, __typedArg1 }) => {
          return String(
            String(
              !!document.querySelector<HTMLElement>(".zt-pdf-mark-popup")! &&
                (page
                  .pdfView(__typedArg0)
                  ?.containerEl.querySelector<HTMLElement>(
                    `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(
                      __typedArg1,
                    )}]`,
                  )!).classList.contains("is-selected"),
            ),
          );
        },
        { __typedArg0: attachmentPath, __typedArg1: annotationKey },
        {
          ready: (value) => value === options.expected,
          tries: options.tries,
          what: "lock.ts:332",
        },
      ).then(
        () => true,
        () => false,
      ))({ expected: "true" }),
    "a click on the mark opens no Mark Popup",
  ).toBe(true);
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
      async ({ page }, { __typedArg0 }) => {
        return String(
          String(
            page
              .pdfView(__typedArg0)!
              .containerEl.querySelectorAll<HTMLElement>(
                ".zt-pdf-annotation-handle",
              ).length,
          ),
        );
      },
      { __typedArg0: attachmentPath },
    ),
  ).toBe("0");
  // Each dimmed verb takes its press and runs nothing: it opens no menu, no
  // tag section and no confirmation, and it shows no notice, since its
  // tooltip already names the Lock Reason. The popup stays on the mark.
  for (const verb of ["color", "tags", "delete"]) {
    await clearNotices(vaultId);
    await obRun(
      vaultId,
      async ({ page }, { __typedArg0, __typedArg1 }) => {
        const { press } = page;
        press(
          document.querySelector<HTMLElement>(
            `.zt-pdf-mark-popup [data-zt-verb=${JSON.stringify(__typedArg0)}]`,
          )!,
          `popup ${__typedArg1}`,
        );
        return String(true);
      },
      { __typedArg0: verb, __typedArg1: verb },
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
  expect(
    await ((options: { expected: string; tries?: number }) =>
      obRunUntil(
        vaultId,
        async ({ app }, { __typedArg0 }) => {
          const card = (
            app.workspace.getLeavesOfType(
              "zotero-annotation-view",
            ) as AnnotationLeaf[]
          )[0]?.view?.containerEl.querySelector<HTMLElement>(
            `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
              __typedArg0,
            )}]`,
          )!;
          return String(
            String(
              !!card &&
                card!.win !== window &&
                !!card!.querySelector<HTMLElement>(".zt-annot-lock")!,
            ),
          );
        },
        { __typedArg0: annotationKey },
        {
          ready: (value) => value === options.expected,
          tries: options.tries,
          what: "lock.ts:397",
        },
      ).then(
        () => true,
        () => false,
      ))({ expected: "true" }),
    "the pop-out Annotation View shows no locked card",
  ).toBe(true);
  expect(
    await obRun(
      vaultId,
      async ({ app }, { __typedArg0 }) => {
        return (app.workspace
          .getLeavesOfType("zotero-annotation-view")[0]
          ?.view?.containerEl.querySelector<HTMLElement>(
            `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
              __typedArg0,
            )}]`,
          )!)
          .querySelector<HTMLElement>(".zt-annot-lock")!
          .getAttribute("aria-label");
      },
      { __typedArg0: annotationKey },
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
    async ({ app, page }, { __typedArg0, __typedArg1 }) => {
      const { press } = page;
      press(
        (
          app.workspace.getLeavesOfType(
            "zotero-annotation-view",
          ) as AnnotationLeaf[]
        )[0]?.view?.containerEl
          .querySelector<HTMLElement>(
            `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
              __typedArg0,
            )}]`,
          )!
          .querySelector<HTMLElement>(__typedArg1)!,
        "colour",
      );
      return String(true);
    },
    { __typedArg0: annotationKey, __typedArg1: cardVerbs.colour },
  );
  expect(
    await ((options: { expected: string; tries?: number }) =>
      obRunUntil(
        vaultId,
        async ({ page }, { __typedArg0 }) => {
          return String(
            String(
              page
                .windowDocuments()
                .flatMap((doc) => [
                  ...doc.querySelectorAll<HTMLElement>(".notice"),
                ])
                .filter((node) => node.textContent.includes(__typedArg0))
                .length,
            ),
          );
        },
        { __typedArg0: reason },
        {
          ready: (value) => value === options.expected,
          tries: options.tries,
          what: "lock.ts:421",
        },
      ).then(
        () => true,
        () => false,
      ))({
      expected: "1",
    }),
    "a press on colour in the pop-out window gives no Lock Reason",
  ).toBe(true);
  expect(
    await obRun(
      vaultId,
      async ({ page }, { __typedArg0 }) => {
        return {
          buttons: page
            .windowDocuments()
            .flatMap((doc) => [...doc.querySelectorAll<HTMLElement>(".notice")])
            .filter((node) => node.textContent.includes(__typedArg0))[0]!
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
      { __typedArg0: reason },
    ),
  ).toEqual({ buttons: 0, menus: 0 });

  // ── Zotero ────────────────────────────────────────────────────────────────
  expect(await readHeldAnnotation()).toEqual(imported);
}
