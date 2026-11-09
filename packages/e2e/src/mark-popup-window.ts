// The Mark Popup of a PDF in a pop-out stays in the pop-out while focus is in
// the main window.
//
// Obsidian puts a popover with no target in whichever window holds focus each
// time it places it. The popup opens from a click in the pop-out, then focus
// moves to the main window, and a scroll of the pop-out's reader hides the
// popup and opens it again with no click.
import { expect } from "vitest";

import { obRun } from "./obsidian-cli.ts";

/** Opens `pdfPath` in a pop-out and selects the highlight `annotationKey`. */
export async function verifyMarkPopupWindow(
  vaultId: string,
  { pdfPath, annotationKey }: { pdfPath: string; annotationKey: string },
) {
  const outcome = await obRun(
    vaultId,
    async ({ app, page }, { pdfPath, annotationKey }) => {
      await using cleanup = new AsyncDisposableStack();
      const pdf = app.vault.getFileByPath(pdfPath);
      if (!pdf) throw new Error(`PDF missing: ${pdfPath}`);
      const leaf = cleanup.adopt(app.workspace.openPopoutLeaf(), (leaf) =>
        leaf.detach(),
      );
      await leaf.openFile(pdf);
      const container = leaf.view.containerEl;
      const own = container.doc;
      const where = () => {
        const popup = page
          .windowDocuments()
          .map((doc) => doc.querySelector(".zt-pdf-mark-popup"))
          .find((popup) => popup !== null);
        if (!popup) return "none";
        return popup.doc === own ? "its own window" : "another window";
      };
      const mark = await page.until(
        `mark of ${annotationKey}`,
        () =>
          container.querySelector<SVGElement>(
            `[data-zotero-annotation-key="${annotationKey}"]`,
          ) ?? undefined,
        15000,
      );
      mark.scrollIntoView({ block: "center", behavior: "instant" });
      const rect = await page.until("the mark inside the reader", () => {
        const box = container.getBoundingClientRect();
        const at = mark.getBoundingClientRect();
        return at.width > 0 && at.top >= box.top && at.bottom <= box.bottom
          ? at
          : undefined;
      });
      const at = {
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2),
      };
      const cdp = (
        container.win as Window & {
          electronWindow: { webContents: import("electron").WebContents };
        }
      ).electronWindow.webContents.debugger;
      if (!cdp.isAttached()) {
        cdp.attach("1.3");
        cleanup.defer(() => cdp.detach());
      }
      const mouse = (type: string, buttons: number) =>
        cdp.sendCommand("Input.dispatchMouseEvent", {
          type,
          ...at,
          button: "left",
          buttons,
          clickCount: 1,
        }) as Promise<unknown>;
      // The pop-out holds focus while the user clicks in it.
      activeWindow = container.win;
      activeDocument = own;
      await mouse("mouseMoved", 0);
      await mouse("mousePressed", 1);
      await mouse("mouseReleased", 0);
      await page.until("the popup", () => where() !== "none", 5000);
      const opened = where();
      // Focus last named the main window.
      activeWindow = window;
      activeDocument = document;
      const scroller = container.querySelector<HTMLElement>(
        ".pdf-viewer-container",
      );
      if (!scroller) throw new Error("PDF scroller missing");
      const top = scroller.scrollTop;
      scroller.scrollTop = top + 3000;
      await page.until("the popup hidden", () => where() === "none", 5000);
      scroller.scrollTop = top;
      await page.until("the popup again", () => where() !== "none", 5000);
      return { opened, reopened: where() };
    },
    { pdfPath, annotationKey },
    { timeoutMs: 60000 },
  );
  expect(outcome).toEqual({
    opened: "its own window",
    reopened: "its own window",
  });
}
