// A selected Annotation Mark dragged out of Obsidian's PDF reader into a note.
//
// The drag starts in Chromium itself: a press on the selected mark makes its
// page draggable, so the browser's own drag detection has to start it. The
// gesture is sent through the DevTools protocol with drags intercepted, which
// starts the drag the browser would start and hands back its data for the
// drop, with no operating-system drag session and no window focus.
import { expect } from "vitest";

import { obRun } from "./obsidian-cli.ts";

/**
 * Drags the selected highlight `annotationKey` from the open PDF at `pdfPath`
 * and drops it on the empty middle line of a note in a split beside it.
 */
export async function verifyReaderAnnotationDrag(
  vaultId: string,
  { pdfPath, annotationKey }: { pdfPath: string; annotationKey: string },
) {
  const notePath = "Reader drag.md";
  const before = "BEFORE\n\nAFTER";
  const outcome = await obRun(
    vaultId,
    async ({ app, page }, { pdfPath, annotationKey, notePath, before }) => {
      type DragData = { items: { mimeType: string; data: string }[] };
      const pdf = app.vault.getFileByPath(pdfPath);
      if (!pdf) throw new Error(`PDF missing: ${pdfPath}`);
      const pdfLeaf = app.workspace.getLeaf("tab");
      await pdfLeaf.openFile(pdf);
      await app.workspace.revealLeaf(pdfLeaf);
      const file =
        app.vault.getFileByPath(notePath) ??
        (await app.vault.create(notePath, before));
      await app.vault.modify(file, before);
      const noteLeaf = app.workspace.createLeafBySplit(pdfLeaf, "vertical");
      await noteLeaf.setViewState({
        type: "markdown",
        state: { file: notePath, mode: "source", source: false },
      });
      const editor = (noteLeaf.view as import("obsidian").MarkdownView).editor;
      const container = pdfLeaf.view.containerEl;
      const mark = await page.until(
        `mark of ${annotationKey}`,
        () =>
          container.querySelector<SVGElement>(
            `[data-zotero-annotation-key="${annotationKey}"]`,
          ) ?? undefined,
        15000,
      );
      mark.scrollIntoView({ block: "center", behavior: "instant" });
      app.workspace.setActiveLeaf(pdfLeaf, { focus: true });
      const rect = await page.until("the mark inside the reader", () => {
        const box = container.getBoundingClientRect();
        const at = mark.getBoundingClientRect();
        return at.width > 0 && at.top >= box.top && at.bottom <= box.bottom
          ? at
          : undefined;
      });
      const from = {
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2),
      };
      const line = editor.cm.coordsAtPos(editor.cm.state.doc.line(2).from);
      if (!line) throw new Error("Drop line unavailable");
      const to = {
        x: Math.round(line.left + 4),
        y: Math.round((line.top + line.bottom) / 2),
      };
      const contents = (
        container.win as Window & {
          electronWindow: { webContents: import("electron").WebContents };
        }
      ).electronWindow.webContents;
      const cdp = contents.debugger;
      const attached = cdp.isAttached();
      if (!attached) cdp.attach("1.3");
      const send = (method: string, params: object) =>
        cdp.sendCommand(method, params) as Promise<unknown>;
      const mouse = (
        type: string,
        { x, y }: { x: number; y: number },
        buttons: number,
      ) =>
        send("Input.dispatchMouseEvent", {
          type,
          x,
          y,
          button: "left",
          buttons,
          clickCount: 1,
        });
      let data: DragData | null = null;
      const onMessage = (
        _event: unknown,
        method: string,
        params: { data: DragData },
      ) => {
        if (method === "Input.dragIntercepted") data = params.data;
      };
      try {
        // A click selects the mark, as the reader's own click does.
        await mouse("mouseMoved", from, 0);
        await mouse("mousePressed", from, 1);
        await mouse("mouseReleased", from, 0);
        await page.until(
          "the selected mark's outline",
          () =>
            container.querySelector(".zt-pdf-annotation-selection-outline") !==
            null,
          5000,
        );
        cdp.on("message", onMessage);
        await send("Input.setInterceptDrags", { enabled: true });
        await mouse("mousePressed", from, 1);
        for (let step = 1; step <= 8; step++)
          await mouse(
            "mouseMoved",
            { x: from.x + step * 6, y: from.y + step * 4 },
            1,
          );
        await page.until(
          "the drag the press started",
          () => data !== null,
          5000,
        );
        const dragged: DragData = data!;
        for (const type of ["dragEnter", "dragOver", "drop"])
          await send("Input.dispatchDragEvent", { type, ...to, data: dragged });
        await mouse("mouseReleased", to, 0);
        await page.until(
          "the inserted annotation",
          () => editor.getValue() !== before,
          15000,
        );
        return {
          types: dragged.items.map(({ mimeType }) => mimeType),
          text: editor.getValue(),
          pageDraggable: Array.from(
            container.querySelectorAll<HTMLElement>(".page"),
          ).some((node) => node.draggable),
        };
      } finally {
        cdp.removeListener("message", onMessage);
        await send("Input.setInterceptDrags", { enabled: false }).catch(
          () => {},
        );
        if (!attached) cdp.detach();
        noteLeaf.detach();
        pdfLeaf.detach();
      }
    },
    { pdfPath, annotationKey, notePath, before },
    { timeoutMs: 60000 },
  );
  // The drag carries the quote for any editor, and ZotLit's own tag.
  expect(outcome.types).toEqual(
    expect.arrayContaining(["text/plain", "application/x-zotlit-annotation"]),
  );
  // The drop inserts the Annotation by the Profile's template, at the drop.
  expect(outcome.text.startsWith("BEFORE\n\n> [!note] Page ")).toBe(true);
  expect(outcome.text).toContain(`?annotation=${annotationKey}&page=`);
  expect(outcome.text).toContain("[@rougierTenSimpleRules2014, {p. 1}]");
  expect(outcome.text.endsWith("\n\nAFTER")).toBe(true);
  expect(outcome.pageDraggable).toBe(false);
}
