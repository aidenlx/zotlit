import type { BackgroundWindow } from "./page-notes-types.ts";

/** Page state between calls. Migration batches augment this interface with their slots. */
export interface PageScratch {
  windowBeforeReload?: boolean;
  listenersBeforeReload?: Set<import("./page-host.ts").RenameListener>;
}

/** JSON handle for a Query View embedded in a Markdown note. */
export interface NoteQueryView {
  /** Temporary legacy source handle; remove when all callers migrate in #1855. */
  el: string;
  path: string;
  kind: {
    name: string;
    opens: string;
    closes: string | null;
    index: number;
    selector: string;
    src: string | null;
  };
}
export type QueryViewElement = HTMLElement & {
  zotlitQueryView?: import("@/views/query-view/view").QueryView;
};

/**
 * Self-contained: serialized into each receiving window. Keep all runtime
 * dependencies inside this function; type-only imports are erased.
 */
export function createPageHelpers(app: import("obsidian").App) {
  const scratch: PageScratch = {};
  async function annotationOpenSubpath(
    gesture: () => void | Promise<void>,
  ): Promise<Record<string, string>> {
    const proto = Object.getPrototypeOf(
      app.workspace.getMostRecentLeaf(),
    ) as Pick<import("obsidian").WorkspaceLeaf, "setEphemeralState">;
    const native = proto.setEphemeralState;
    let subpath: string | null = null;
    proto.setEphemeralState = new Proxy(native, {
      apply: (
        target,
        receiver: import("obsidian").WorkspaceLeaf,
        args: [state: { subpath?: string } | null | undefined],
      ) => {
        const [state] = args;
        if (
          subpath === null &&
          typeof state?.subpath === "string" &&
          state.subpath.includes("zt-annotation=")
        )
          subpath = state.subpath;
        return Reflect.apply(target, receiver, args);
      },
    });
    try {
      await gesture();
      const found = await until(
        "the PDF opens at the Annotation",
        () => subpath,
        10000,
      );
      return Object.fromEntries(
        new URLSearchParams(found.startsWith("#") ? found.slice(1) : found),
      );
    } finally {
      proto.setEphemeralState = native;
    }
  }
  function showBehind(win: BackgroundWindow) {
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
  async function revealQueryView({ path, kind }: NoteQueryView) {
    const leaves = app.workspace
      .getLeavesOfType("markdown")
      .filter(
        (l) => (l.view as import("obsidian").MarkdownView).file?.path === path,
      );
    const leaf =
      leaves.find((l) => l === app.workspace.getMostRecentLeaf()) ?? leaves[0];
    if (!leaf) throw new Error(`Cannot reveal: note not open: ${  path}`);
    const view = leaf.view as import("obsidian").MarkdownView & {
      previewMode: {
        renderer: { sections: { el: HTMLElement; lines: number }[] };
      };
    };
    const lines = view.data.split("\n");
    const opens = new RegExp(kind.opens);
    const from = lines.flatMap((text, index) =>
      opens.test(text) ? [index] : [],
    )[kind.index];
    if (from === undefined)
      throw new Error(`Cannot reveal: no ${  kind.name  } in ${  path}`);
    let to = from;
    if (kind.closes !== null) {
      const closes = new RegExp(kind.closes);
      to = lines.findIndex((text, index) => index > from && closes.test(text));
      if (to === -1) to = lines.length - 1;
    }
    const lineOf = (el: HTMLElement) => {
      if (view.getMode() === "source") {
        const cm = view.editor.cm;
        if (!cm.contentDOM.contains(el)) return null;
        return cm.state.doc.lineAt(cm.posAtDOM(el)).number - 1;
      }
      let start = 0;
      for (const section of view.previewMode.renderer.sections) {
        if (section.el.contains(el))
          return Math.max(start, Math.min(from, start + section.lines - 1));
        start += section.lines;
      }
      return null;
    };
    const viewOf = (el: QueryViewElement) =>
      el.zotlitQueryView
        ? el
        : el.querySelector<QueryViewElement>(".block-language-zotquery");
    const drawn = () =>
      [...view.containerEl.querySelectorAll<QueryViewElement>(kind.selector)]
        .filter(
          (el) =>
            el.isShown() &&
            (kind.src === null || el.getAttribute("src") === kind.src) &&
            viewOf(el)?.zotlitQueryView,
        )
        .find((el) => {
          const line = lineOf(el);
          return line !== null && line >= from && line <= to;
        });
    const end = Temporal.Now.instant().epochMilliseconds + 10_000;
    for (;;) {
      const el = drawn();
      if (el) {
        const host = viewOf(el);
        await host!.zotlitQueryView!.settled;
        if (host!.isConnected && host!.isShown()) return host!;
      }
      if (Temporal.Now.instant().epochMilliseconds > end)
        throw new Error(
          `Not drawn: ${ 
            kind.name 
            } in ${ 
            path 
            } (${ 
            view.getMode() 
            }, lines ${ 
            from 
            }-${ 
            to 
            })`,
        );
      if (view.getMode() === "preview")
        view.setEphemeralState({ scroll: from });
      else {
        const editor = view.editor;
        if (
          editor
            .listSelections()
            .some(
              ({ anchor, head }) =>
                Math.max(anchor.line, head.line) >= from &&
                Math.min(anchor.line, head.line) <= to,
            )
        ) {
          const off =
            to < editor.lastLine()
              ? { line: to + 1, ch: 0 }
              : { line: Math.max(from - 1, 0), ch: 0 };
          editor.setCursor(off);
        }
        const at = { line: from, ch: 0 };
        editor.scrollIntoView({ from: at, to: at }, true);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

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
  return {
    annotationOpenSubpath,
    showBehind,
    revealQueryView,
    scratch,
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
