import { expect } from "vitest";
// The Obsidian half of a gesture on a PDF page in the Paired Run: the PDF
// opened with the Annotation View beside it, the reader's view as an eval
// expression, pointer events dispatched as the browser sends them, the window
// raised so the page lays out, and the reads a Geometry Edit test takes of the
// plugin around a gesture.

import { obRun, obRunUntil } from "./obsidian-cli.ts";
import type { BackgroundWindow } from "./page-notes-types.ts";

/**
 * Brings page one on screen in a window that lays it out, and arms `tool`
 * from the Creation Toolbar. With `at`, the PDF point `at` on page one is
 * first brought to the middle of the window.
 */
export async function armToolOnFirstPage(
  vaultId: string,
  {
    attachmentPath,
    tool,
    at,
  }: { attachmentPath: string; tool: string; at?: readonly [number, number] },
): Promise<void> {
  await raiseWindow(vaultId);
  await obRunUntil(
    vaultId,
    ({ page }, { attachmentPath }) => {
      const view = page.pdfView(attachmentPath);
      if (!view) return false;
      view.viewer.child.pdfViewer.pdfViewer.currentPageNumber = 1;
      return !!view.viewer.child
        .getPage(1)
        ?.div.querySelector(".zt-pdf-annotation-overlay");
    },
    { attachmentPath },
    { what: "PDF first page overlay" },
  );
  if (at) {
    await obRun(
      vaultId,
      ({ page }, { attachmentPath, at }) => {
        const view = page.pdfView(attachmentPath)!;
        const point = page.clientOfFirstPage(view, at[0], at[1]);
        page.pageContainer(view).scrollTop += point.y - innerHeight / 2;
      },
      { attachmentPath, at },
    );
    await obRunUntil(
      vaultId,
      ({ page }, { attachmentPath, at }) => {
        const view = page.pdfView(attachmentPath)!;
        const point = page.clientOfFirstPage(view, at[0], at[1]);
        return (
          Math.abs(point.y - innerHeight / 2) < innerHeight / 4 &&
          view.viewer.child
            .getPage(1)!
            .div.contains(document.elementFromPoint(point.x, point.y))
        );
      },
      { attachmentPath, at },
      { what: "PDF point centered" },
    );
  }
  expect(
    await obRun(
      vaultId,
      ({ page }, { attachmentPath, tool }) => {
        const button = page.toolButton(page.pdfView(attachmentPath)!, tool)!;
        if (button.getAttribute("aria-pressed") !== "true")
          page.press(button, `tool ${tool}`);
        return button.getAttribute("aria-pressed");
      },
      { attachmentPath, tool },
    ),
  ).toBe("true");
}

/** Stands the named Creation Toolbar tool down after a test. */
export async function disarmTool(
  vaultId: string,
  { attachmentPath, tool }: { attachmentPath: string; tool: string },
): Promise<void> {
  await obRun(
    vaultId,
    ({ page }, { attachmentPath, tool }) => {
      const button = page.toolButton(page.pdfView(attachmentPath)!, tool);
      if (button?.getAttribute("aria-pressed") === "true") button.click();
    },
    { attachmentPath, tool },
  );
}

/**
 * Settles once the blocked gesture a press reported in the view on
 * `attachmentPath` has run to its end: the probe it starts, and the notice
 * after it.
 */
export async function settledGesture(
  vaultId: string,
  attachmentPath: string,
): Promise<void> {
  await obRun(
    vaultId,
    async ({ zotlit }, { __typedArg0 }) => {
      await zotlit.services.pdfAnnotationEditor.bindings.find(
        (candidate) => candidate.filePath === __typedArg0,
      )!.gestured;
      return String(true);
    },
    { __typedArg0: attachmentPath },
  );
}

/**
 * Closes the PDF view on `attachmentPath` that {@link pdfViewOf} answers and
 * opens the PDF again in the same leaf, in one step, so the view takes a new
 * binding. A background tab can hold the same PDF, and closing that one would
 * leave the view under test open.
 */
export async function reopenPdfView(
  vaultId: string,
  attachmentPath: string,
): Promise<void> {
  expect(
    await obRun(
      vaultId,
      async ({ page }, { attachmentPath }) => {
        const view = page.pdfView(attachmentPath)!;
        const file = view.file!;
        await view.leaf.setViewState({ type: "empty" });
        await view.leaf.openFile(file);
        return "reopened";
      },
      { attachmentPath },
    ),
  ).toBe("reopened");
}

/**
 * Opens the PDF `attachmentPath` in a new tab and waits for its binding, then
 * opens the Annotation View and sets it to follow the active tab. The
 * workspace layout goes back as it was found when `cleanup` disposes; the
 * restore is on the stack before the tab opens, so a failed open puts it back
 * too.
 *
 * @param attachmentPath the vault path of the PDF.
 * @param cleanup the stack that restores the workspace layout.
 */
export async function openPdfWithAnnotationView(
  vaultId: string,
  {
    attachmentPath,
    cleanup,
  }: {
    attachmentPath: string;
    cleanup: AsyncDisposableStack;
  },
): Promise<void> {
  const layout = await obRun(
    vaultId,
    async ({ app }) => {
      return String(JSON.stringify(app.workspace.getLayout()));
    },
    undefined,
  );
  cleanup.defer(async () => {
    await obRun(
      vaultId,
      async ({ app }, { __typedArg0 }) => {
        await app.workspace.changeLayout(JSON.parse(__typedArg0));
        return String(true);
      },
      { __typedArg0: layout },
    );
  });
  await obRun(
    vaultId,
    async ({ app }, { __typedArg0 }) => {
      const file = app.vault.getFileByPath(__typedArg0)!;
      await app.workspace.getLeaf("tab").openFile(file);
      return String(true);
    },
    { __typedArg0: attachmentPath },
  );
  await obRunUntil(
    vaultId,
    async ({ zotlit }, { __typedArg0 }) => {
      return !!zotlit.services.pdfAnnotationEditor.bindings.find(
        (b) => b.filePath === __typedArg0,
      )?.session;
    },
    { __typedArg0: attachmentPath },
    { what: "reader-gestures.ts:198" },
  );
  await obRun(
    vaultId,
    async ({ app }) => {
      app.commands.executeCommandById("zotlit:open-annot-view");
      return String(true);
    },
    undefined,
  );
  await obRun(
    vaultId,
    async ({ app }) => {
      app.commands.executeCommandById("zotlit:annot-view-follow-active-tab");
      return String(true);
    },
    undefined,
  );
}

/**
 * Shows the vault's window if it is hidden or minimized, behind other apps'
 * windows, and leaves the OS focus where it is. A pointer gesture is hit-tested against the page as laid
 * out; `prepareRunWindow` keeps a covered window laying it out.
 */
export async function raiseWindow(vaultId: string): Promise<void> {
  await obRunUntil(
    vaultId,
    ({ page }) => {
      const electronWindow = (
        require("@electron/remote") as {
          getCurrentWindow(): BackgroundWindow & {
            isVisible(): boolean;
          };
        }
      ).getCurrentWindow();
      if (!electronWindow.isVisible() || electronWindow.isMinimized())
        page.showBehind(electronWindow);
      return document.visibilityState;
    },
    undefined,
    { what: "visible vault window", ready: (state) => state === "visible" },
  );
}

/**
 * Selects text in the open comment editor of the Mark Popup three ways — a
 * double click, a drag, and "Select all" from the editor's own context menu —
 * and expects each selection to land while the editor stays open. The menu is
 * Obsidian's DOM menu for the run, whatever the vault set.
 */
export async function expectEditorKeepsSelections(
  vaultId: string,
): Promise<void> {
  const nativeMenus = await obRun(vaultId, ({ app }) =>
    app.vault.getConfig("nativeMenus"),
  );
  await obRun(vaultId, ({ app }) => {
    app.vault.setConfig("nativeMenus", false);
  });
  try {
    const type = () =>
      obRun(vaultId, ({ page }) => {
        page.popupEditor()!.focus();
        document.execCommand("selectAll");
        document.execCommand("insertText", false, "hello world");
      });
    const gesture = async (kind: "double" | "drag" | "context" | "all") => {
      await obRun(
        vaultId,
        ({ page }, { kind }) => {
          const send = (
            type: string,
            { x, y }: { x: number; y: number },
            extra?: PointerEventInit,
          ) => {
            const init = {
              clientX: x,
              clientY: y,
              bubbles: true,
              cancelable: true,
              composed: true,
              pointerId: 1,
              button: 0,
              buttons: 1,
              view: window,
              ...extra,
            };
            document
              .elementFromPoint(x, y)!
              .dispatchEvent(
                type.startsWith("pointer")
                  ? new PointerEvent(type, init)
                  : new MouseEvent(type, init),
              );
          };
          const press = (point: { x: number; y: number }, detail: number) => {
            send("pointerdown", point, { detail });
            send("mousedown", point, { detail });
            send("pointerup", point, { detail, buttons: 0 });
            send("mouseup", point, { detail, buttons: 0 });
            send("click", point, { detail, buttons: 0 });
          };
          const text = [...page.popupEditor()!.querySelectorAll(".cm-line")]
            .flatMap((line) => [...line.childNodes])
            .map((node) => (node.nodeType === 3 ? node : node.firstChild))
            .find((node) => node?.textContent?.includes("hello"))!;
          const at = (from: number, to: number) => {
            const range = document.createRange();
            range.setStart(text, from);
            range.setEnd(text, to);
            const box = range.getBoundingClientRect();
            return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
          };
          if (kind === "double") {
            const word = at(1, 2);
            press(word, 1);
            press(word, 2);
            send("dblclick", word, { detail: 2, buttons: 0 });
          }
          if (kind === "drag") {
            const from = at(1, 2),
              to = at(8, 9);
            send("pointerdown", from, { detail: 1 });
            send("mousedown", from, { detail: 1 });
            send("pointermove", to);
            send("mousemove", to);
            send("pointerup", to, { buttons: 0 });
            send("mouseup", to, { buttons: 0 });
            send("click", to, { buttons: 0 });
          }
          if (kind === "context")
            send("contextmenu", at(1, 2), { button: 2, buttons: 2 });
          if (kind === "all") {
            const menu = [
              ...document.querySelectorAll(".menu .menu-item"),
            ].find((item) => item.textContent.trim() === "Select all")!;
            const box = menu.getBoundingClientRect();
            press(
              { x: box.left + box.width / 2, y: box.top + box.height / 2 },
              1,
            );
          }
        },
        { kind },
      );
    };
    const selected = async (text: string) => {
      await obRunUntil(vaultId, () => String(getSelection()), undefined, {
        what: "editor selection",
        ready: (value) => value === text,
      });
      await obRunUntil(vaultId, ({ page }) => !!page.popupEditor(), undefined, {
        what: "popup editor stays open",
      });
    };
    await type();
    await gesture("double");
    await selected("hello");
    await type();
    await gesture("drag");
    await selected("ello wo");
    await type();
    await gesture("context");
    await obRunUntil(
      vaultId,
      () =>
        [...document.querySelectorAll(".menu .menu-item")].some(
          (item) => item.textContent.trim() === "Select all",
        ),
      undefined,
      { what: "Select all menu item" },
    );
    await gesture("all");
    await selected("hello world");
  } finally {
    await obRun(
      vaultId,
      ({ app }, { nativeMenus }) => {
        app.vault.setConfig("nativeMenus", nativeMenus);
      },
      { nativeMenus },
    );
  }
}

/**
 * The Sort Index the reader's text structure gives a stored position, through
 * the binding of the view on `attachmentPath` — the value a Geometry Edit is
 * saved with.
 *
 * @param position the position as Zotero stores it, a JSON string.
 */
export async function recomputedSortIndex(
  vaultId: string,
  { attachmentPath, position }: { attachmentPath: string; position: string },
): Promise<string> {
  return obRun(
    vaultId,
    async ({ zotlit }, { attachmentPath, position }) => {
      const binding = zotlit.services.pdfAnnotationEditor.bindings.find(
        (candidate) => candidate.filePath === attachmentPath,
      )!;
      return (await binding.sortIndex(position))!;
    },
    {
      attachmentPath,
      position: JSON.parse(position) as Parameters<
        import("@zotlit/obsidian/e2e").E2eServices["pdfAnnotationEditor"]["bindings"][number]["sortIndex"]
      >[0],
    },
  );
}

/**
 * Records the Annotations whose Excerpt Image pixels the repository announces
 * as changed, from now until disposal, which lets go of the listener on every
 * exit.
 */
export async function watchExcerptPixels(
  vaultId: string,
): Promise<AsyncDisposable & { keys(): Promise<string[]> }> {
  await obRun(
    vaultId,
    async ({ zotlit, page }) => {
      page.scratch.pixelsOff?.();
      page.scratch.pixels = [];
      page.scratch.pixelsOff = zotlit.services.bridge.subscribe(
        zotlit.services.annotationRepository.excerptPixelsChanged,
        ({ record }) => page.scratch.pixels!.push(record.key),
      );
      return String(true);
    },
    undefined,
  );
  return {
    async keys() {
      return JSON.parse(
        await obRun(
          vaultId,
          async ({ page }) => {
            return String(JSON.stringify(page.scratch.pixels));
          },
          undefined,
        ),
      ) as string[];
    },
    async [Symbol.asyncDispose]() {
      await obRun(
        vaultId,
        async ({ page }) => {
          page.scratch.pixelsOff?.();
          delete page.scratch.pixelsOff;
          delete page.scratch.pixels;
          return String(true);
        },
        undefined,
      );
    },
  };
}
