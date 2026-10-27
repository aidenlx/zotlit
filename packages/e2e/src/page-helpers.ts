/** Page state between calls. Migration batches augment this interface with their slots. */
export interface PageScratch {
  windowBeforeReload?: boolean;
  listenersBeforeReload?: Set<import("./page-host.ts").RenameListener>;
}

/**
 * Self-contained: serialized into each receiving window. Keep all runtime
 * dependencies inside this function; type-only imports are erased.
 */
export function createPageHelpers(app: import("obsidian").App) {
  const scratch: PageScratch = {};
  function press<T extends HTMLElement>(
    el: T | null | undefined,
    what: string,
  ): T {
    if (!el) throw new Error(`Missing: ${what}`);
    el.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: "instant",
    });
    const r = el.getBoundingClientRect();
    if (!el.checkVisibility() || r.width === 0 || r.height === 0)
      throw new Error(
        `Not visible: ${what} (${r.width}x${r.height}${el.checkVisibility() ? "" : ", hidden"})`,
      );
    const hit = el.ownerDocument.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2,
    );
    if (!hit || !(hit === el || el.contains(hit)))
      throw new Error(
        `Covered: ${what} (by ${hit ? hit.outerHTML.slice(0, 80) : "nothing"})`,
      );
    el.click();
    return el;
  }
  async function until<T>(
    what: string,
    ok: () => T | Promise<T>,
    timeout = 2000,
  ): Promise<NonNullable<Exclude<T, false | 0 | "">>> {
    const end = performance.now() + timeout;
    for (;;) {
      const value = await ok();
      if (value) return value as NonNullable<Exclude<T, false | 0 | "">>;
      if (performance.now() > end) throw new Error(`Timed out: ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  function stands<T extends HTMLElement>(
    el: T | null | undefined,
    what: string,
    timeout = 5000,
  ) {
    return until(
      `${what} stands`,
      () => {
        if (!el) return false;
        const split = el.closest(".workspace-split") ?? el;
        const r = el.getBoundingClientRect();
        const hit = el.ownerDocument.elementFromPoint(
          r.left + r.width / 2,
          r.top + r.height / 2,
        );
        return split.getAnimations({ subtree: true }).length === 0 &&
          hit &&
          (hit === el || el.contains(hit))
          ? el
          : false;
      },
      timeout,
    );
  }
  function valueOf(
    el:
      | HTMLButtonElement
      | HTMLSelectElement
      | HTMLInputElement
      | null
      | undefined,
  ) {
    return el
      ? el.tagName === "BUTTON"
        ? el.dataset.value
        : el.value
      : undefined;
  }
  async function pick<T extends HTMLButtonElement | HTMLSelectElement>(
    el: T | null | undefined,
    value: string,
    what: string,
  ): Promise<T> {
    if (!el) throw new Error(`Missing: ${what}`);
    if (el.tagName === "SELECT") {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el;
    }
    press(el, what);
    const button = el as HTMLButtonElement;
    const popup = await until(
      `${what} opens`,
      () =>
        button.popoverTargetElement?.matches(":popover-open") &&
        button.popoverTargetElement,
    );
    const row = await until(`${what} offers ${value}`, () =>
      popup.querySelector<HTMLElement>(
        `[role=option][data-value="${CSS.escape(value)}"]`,
      ),
    );
    press(row, `${what} row ${value}`);
    await until(`${what} shuts`, () => !popup.matches(":popover-open"));
    return el;
  }
  // oxlint-disable-next-line max-params -- Preserve the page gesture API during the migration (#1848).
  function fire(
    type: string,
    x: number,
    y: number,
    target?: Element | null,
    extra?: PointerEventInit,
  ): Element {
    const node = target ?? document.elementFromPoint(x, y);
    if (!node) throw new Error(`No element at ${x},${y}`);
    const init = {
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      button: 0,
      buttons: type === "pointerup" || type === "click" ? 0 : 1,
      view: window,
      ...extra,
    };
    node.dispatchEvent(
      type === "click"
        ? new MouseEvent(type, init)
        : new PointerEvent(type, init),
    );
    return node;
  }
  function tap(x: number, y: number) {
    const node = fire("pointerdown", x, y);
    fire("pointerup", x, y, node);
    fire("click", x, y, node);
    return node;
  }
  function trusted(win: Window) {
    const contents = (
      win as Window & {
        electronWindow: {
          webContents: { sendInputEvent(event: object): void };
        };
      }
    ).electronWindow.webContents;
    const zoom = (
      require("electron") as { webFrame: { getZoomFactor(): number } }
    ).webFrame.getZoomFactor();
    const delivered = (type: string) =>
      new Promise<Event>((resolve) =>
        win.addEventListener(type, resolve, { once: true, capture: true }),
      );
    return {
      key: async (keyCode: string, modifiers: string[] = []) => {
        const up = delivered("keyup");
        contents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
        contents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
        await up;
      },
      click: async (el: Element) => {
        const b = el.getBoundingClientRect();
        const at = {
          x: Math.round((b.left + b.width / 2) * zoom),
          y: Math.round((b.top + b.height / 2) * zoom),
          button: "left",
          clickCount: 1,
        };
        const up = delivered("mouseup");
        contents.sendInputEvent({ type: "mouseDown", ...at });
        contents.sendInputEvent({ type: "mouseUp", ...at });
        await up;
      },
    };
  }
  function menuReady(): Promise<string> {
    return new Promise((resolve) =>
      activeWindow.setTimeout(() => resolve("ready"), 0),
    );
  }
  function windowDocuments(): Document[] {
    const docs = new Set([document]);
    app.workspace.iterateAllLeaves((leaf) => {
      docs.add(leaf.view.containerEl.doc);
    });
    return [...docs];
  }
  function popupEditor() {
    return document.querySelector<HTMLElement>(
      ".zt-pdf-mark-popup .cm-content",
    );
  }
  async function pickQueryView(view: { contentEl: HTMLElement }, name: string) {
    press(
      view.contentEl.querySelector<HTMLElement>("[data-query-view-menu]"),
      "View menu",
    );
    const row = await until(`view menu row ${name}`, () =>
      view.contentEl.querySelector<HTMLElement>(
        `[data-query-view-list]:popover-open [data-query-view-row="${CSS.escape(name)}"]`,
      ),
    );
    press(row, name);
  }
  function listAnnotations(source: string): string {
    const start = source.indexOf("## Annotations\n\n```zotquery\n");
    const end =
      start < 0
        ? -1
        : source.indexOf(
            "```\n",
            start + "## Annotations\n\n```zotquery\n".length,
          );
    if (end < 0) throw new Error("Default Profile has no Query Block");
    return `${source.slice(0, start)}{% managed %}\n{% for annotation in zt.annotations %}\n{% render_annotation annotation %}\n{% endfor %}\n{% endmanaged %}\n${source.slice(end + 4)}`;
  }
  function pdfView(
    path: string,
  ): import("./page-notes-types.ts").PagePdfView | undefined {
    return app.workspace
      .getLeavesOfType("pdf")
      .map(({ view }) => view as import("./page-notes-types.ts").PagePdfView)
      .find(
        (view) =>
          view.file?.path === path &&
          view.containerEl.getBoundingClientRect().width > 0,
      );
  }
  function clientOfFirstPage(
    view: import("./page-notes-types.ts").PagePdfView,
    x: number,
    y: number,
  ) {
    const overlay = view.viewer.child
      .getPage(1)!
      .div.querySelector<SVGSVGElement>(".zt-pdf-annotation-overlay")!;
    const box = overlay.getBoundingClientRect();
    const frame = overlay.viewBox.baseVal;
    return {
      x: box.left + ((x - frame.x) * box.width) / frame.width,
      y: box.top + ((frame.y + frame.height - y) * box.height) / frame.height,
    };
  }
  function toolButton(
    view: import("./page-notes-types.ts").PagePdfView,
    tool: string,
  ) {
    return view.containerEl.querySelector<HTMLButtonElement>(
      `[data-zt-tool="${  CSS.escape(tool)  }"]`,
    );
  }
  function pageContainer(view: import("./page-notes-types.ts").PagePdfView) {
    return view.viewer.child.pdfViewer.pdfViewer.container;
  }
  function showBehind(win: import("./page-notes-types.ts").BackgroundWindow) {
    if (process.platform !== "darwin") {
      win.showInactive();
      return;
    }
    if (!win.isMinimized()) {
      win.showInactive();
      win.blur();
      return;
    }
    const opacity = win.getOpacity();
    win.setOpacity(0);
    win.once("restore", () => {
      win.blur();
      setTimeout(() => win.setOpacity(opacity), 100);
    });
    win.showInactive();
  }
  return {
    scratch,
    pdfView,
    clientOfFirstPage,
    toolButton,
    pageContainer,
    showBehind,
    press,
    until,
    stands,
    valueOf,
    pick,
    fire,
    tap,
    trusted,
    menuReady,
    windowDocuments,
    popupEditor,
    pickQueryView,
    listAnnotations,
  };
}
