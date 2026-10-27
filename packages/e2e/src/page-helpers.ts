import type { WorkspaceLeaf } from "obsidian";
import type { MouseEvent as ReactMouseEvent } from "react";

import type { E2eServices } from "@zotlit/obsidian/e2e";

import type { Effect as PluginEffect } from "@/lib/effect";
import type { QueryView } from "@/views/query-view/view";
import type { TemplateWorkbenchView } from "@/views/template-workbench/view";

import type { RenameListener, PageApp } from "./page-host.ts";
import type {
  LinkMarkdownView,
  LinkSettings,
  LinkGesture,
} from "./page-links-types.ts";
import type {
  PreparationTrial,
  PreparationService,
  PagePdfView,
  BackgroundWindow,
} from "./page-notes-types.ts";
import type {
  WalkthroughLeaf,
  WalkthroughViews,
} from "./page-walkthrough-types.ts";

/** JSON handle for a Query View embedded in a Markdown note. */
export interface NoteQueryView {
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
  zotlitQueryView?: QueryView;
};
/** Page state between calls. Migration batches augment this interface with their slots. */
export interface PageScratch {
  windowBeforeReload?: boolean;
  listenersBeforeReload?: Set<RenameListener>;
}

/**
 * Self-contained: serialized into each receiving window. Keep all runtime
 * dependencies inside this function; type-only imports are erased.
 */
export function createPageHelpers(app: PageApp) {
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
  /** The Template Workbench leaves, their companions, and the focus they sit under. */
  function workbenchSurfaces() {
    const surfaces = (type: keyof WalkthroughViews) =>
      leavesOfType(type).map((leaf) => {
        const win = leaf.getContainer().win;
        return {
          window: win === window ? "main" : "popout",
          closed: win.closed,
          state: JSON.stringify(leaf.view.getState()),
          tabs: Array.from(
            leaf.view.containerEl.querySelectorAll("[role=tab]"),
            (tab) => tab.textContent.trim(),
          ),
          content:
            leaf.view.containerEl.querySelector(".view-content")
              ?.childElementCount ?? null,
        };
      });
    return {
      workbench: surfaces("zotlit-template-workbench"),
      explorer: surfaces("zotlit-template-data-explorer"),
      preview: surfaces("zotlit-note-preview"),
      activeLeaf: app.workspace.activeLeaf?.view.getViewType() ?? null,
      activeWindow: activeWindow === window ? "main" : "popout",
      focused: activeDocument.hasFocus(),
      modals: windowDocuments().flatMap((doc) =>
        Array.from(
          doc.querySelectorAll(".modal-container .modal"),
          (modal) => ({
            className: modal.className,
            title: modal.querySelector(".modal-title")?.textContent ?? null,
            text: modal.textContent.slice(0, 400),
          }),
        ),
      ),
    };
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
  function menuEvent(currentTarget: HTMLElement): ReactMouseEvent<HTMLElement> {
    const nativeEvent = new MouseEvent("click");
    return {
      currentTarget,
      target: currentTarget,
      nativeEvent,
      altKey: false,
      button: 0,
      buttons: 0,
      clientX: 0,
      clientY: 0,
      ctrlKey: false,
      metaKey: false,
      movementX: 0,
      movementY: 0,
      pageX: 0,
      pageY: 0,
      relatedTarget: null,
      screenX: 0,
      screenY: 0,
      shiftKey: false,
      getModifierState: (key) => nativeEvent.getModifierState(key),
      bubbles: false,
      cancelable: false,
      defaultPrevented: false,
      eventPhase: 0,
      isTrusted: false,
      preventDefault: () => nativeEvent.preventDefault(),
      isDefaultPrevented: () => nativeEvent.defaultPrevented,
      stopPropagation: () => nativeEvent.stopPropagation(),
      isPropagationStopped: () => nativeEvent.cancelBubble,
      persist: () => {},
      timeStamp: nativeEvent.timeStamp,
      type: "click",
      detail: 0,
      // The menu action uses currentTarget; the remaining fields satisfy its synthetic event interface.
      view: {
        document,
        styleMedia: {
          type: "screen",
          matchMedium: (query: string) => matchMedia(query).matches,
        },
      },
    };
  }
  async function installAnnotationPreparation(
    services: E2eServices,
    trial: PreparationTrial,
    effectPath: string,
  ) {
    const Effect = require(effectPath) as typeof PluginEffect;
    const context = await services.runtime.context();
    trial.preparation = context.mapUnsafe.get(
      "zotlit/excerpt-image/ExcerptPreparation",
    ) as PreparationService;
    if (!trial.preparation)
      throw new Error("ExcerptPreparation service missing");
    trial.originalPreparation = trial.preparation.forCard;
    trial.preparation.forCard = (options) =>
      Effect.gen(function* () {
        trial.started = true;
        trial.prepareCalls++;
        trial.options = options;
        yield* Effect.promise(() => trial.gate);
        return yield* trial.originalPreparation.call(
          trial.preparation,
          options,
        );
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            trial.finished++;
          }),
        ),
      );
  }
  function resetAnnotationPreparation(trial: PreparationTrial) {
    trial.started = false;
    trial.prepareCalls = 0;
    trial.finished = 0;
    trial.options = null;
    trial.gate = new Promise<void>((resolve) => {
      trial.release = resolve;
    });
  }
  function restoreAnnotationPreparation(trial: PreparationTrial) {
    trial.release?.();
    if (trial.originalPreparation)
      trial.preparation.forCard = trial.originalPreparation;
  }
  function leavesOfType<K extends keyof WalkthroughViews>(
    type: K,
  ): WalkthroughLeaf<K>[] {
    return app.workspace.getLeavesOfType(type) as WalkthroughLeaf<K>[];
  }
  // Walkthrough waits use native layout completion where available; waitFor
  // compares arrivals at the existing 25 ms polling interval.
  function measure(
    cm: import("obsidian").MarkdownView["editor"]["cm"],
  ): Promise<void> {
    return new Promise((resolve) =>
      cm.requestMeasure({ read: () => null, write: () => resolve() }),
    );
  }
  async function waitFor<T>(
    read: () => T,
    expected: T,
    label: string,
  ): Promise<T> {
    using timers = new DisposableStack();
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 200; attempt++) {
      const actual = read();
      if (JSON.stringify(actual) === JSON.stringify(expected)) return actual;
      lastError = new Error(
        `${label}: expected ${JSON.stringify(
          expected,
        )}, received ${JSON.stringify(actual)}`,
      );
      await new Promise<void>((resolve) =>
        timers.adopt(setTimeout(resolve, 25), clearTimeout),
      );
    }
    throw lastError;
  }
  async function pressKey(
    debugger_: {
      sendCommand(method: string, params: object): Promise<unknown>;
    },
    key: string,
    code: number,
  ) {
    await debugger_.sendCommand("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code: key,
      windowsVirtualKeyCode: code,
    });
    await debugger_.sendCommand("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code: key,
      windowsVirtualKeyCode: code,
    });
  }
  async function annotationOpenSubpath(
    gesture: () => void | Promise<void>,
  ): Promise<Record<string, string>> {
    const proto = Object.getPrototypeOf(
      app.workspace.getMostRecentLeaf(),
    ) as Pick<WorkspaceLeaf, "setEphemeralState">;
    const native = proto.setEphemeralState;
    let subpath: string | null = null;
    proto.setEphemeralState = new Proxy(native, {
      apply: (
        target,
        receiver: WorkspaceLeaf,
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
  function workbench(
    selector: { path?: string; originatingNote?: string } = {},
  ) {
    const views = app.workspace
      .getLeavesOfType("zotlit-template-workbench")
      .map((leaf) => leaf.view as TemplateWorkbenchView);
    if (selector.path)
      return views.find((view) => view.file?.path === selector.path);
    if (selector.originatingNote)
      return (
        views.find(
          (view) => view.originatingNote?.path === selector.originatingNote,
        ) ?? views[0]
      );
    return app.workspace.activeLeaf?.view.getViewType() ===
      "zotlit-template-workbench"
      ? (app.workspace.activeLeaf.view as TemplateWorkbenchView)
      : undefined;
  }
  function pdfView(path: string): PagePdfView | undefined {
    return app.workspace
      .getLeavesOfType("pdf")
      .map(({ view }) => view as PagePdfView)
      .find(
        (view) =>
          view.file?.path === path &&
          view.containerEl.getBoundingClientRect().width > 0,
      );
  }
  function clientOfFirstPage(view: PagePdfView, x: number, y: number) {
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
  function toolButton(view: PagePdfView, tool: string) {
    return view.containerEl.querySelector<HTMLButtonElement>(
      `[data-zt-tool="${CSS.escape(tool)}"]`,
    );
  }
  function pageContainer(view: PagePdfView) {
    return view.viewer.child.pdfViewer.pdfViewer.container;
  }
  /**
   * Shows the Electron window and leaves the OS focus
   * and the developer's windows alone. `showInactive` keeps the focus but puts the
   * window in front of every other app's windows on macOS; `blur` there orders it
   * behind them. A minimized window comes back from the Dock in front for the
   * length of the animation, so it stays transparent until it is restored and
   * ordered back. Restore a minimized window with this, not `restore()`.
   * The run preparation keeps a covered window rendering.
   */
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
  function annotationLinkTools(getServices: () => E2eServices) {
    const sleep = (milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
    const deadline = () => Temporal.Now.instant().add({ seconds: 15 });
    const past = (end: Temporal.Instant) =>
      Temporal.Instant.compare(Temporal.Now.instant(), end) > 0;
    function within<T>(
      promise: Promise<T>,
      end: Temporal.Instant,
      what: string,
    ): Promise<T> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(what)),
          Math.max(0, Temporal.Now.instant().until(end).total("milliseconds")),
        );
      });
      return Promise.race([promise, late]).finally(() => clearTimeout(timer));
    }
    async function until<T>(
      found: () => T,
      what: () => string,
    ): Promise<NonNullable<Exclude<T, false | 0 | "">>> {
      for (const end = deadline(); ; await sleep(100)) {
        const value = found();
        if (value) return value as NonNullable<Exclude<T, false | 0 | "">>;
        if (past(end)) throw new Error(what());
      }
    }
    function restoreLedger(cleanup: AsyncDisposableStack): void {
      const savedLedger = JSON.stringify(
        app.loadLocalStorage("zotlit-use-ledger") ?? null,
      );
      cleanup.defer(async () => {
        if (
          JSON.stringify(app.loadLocalStorage("zotlit-use-ledger") ?? null) ===
          savedLedger
        )
          return;
        app.workspace.requestActiveLeafEvents.run();
        const old = getServices();
        await app.plugins.disablePlugin("zotlit");
        const stillOpen = () =>
          !old.bridge.closed() ||
          old.bridge.runSync(old.pdfAnnotationEditor.bindings).length > 0;
        for (let i = 0; i < 200 && stillOpen(); i++) await sleep(25);
        if (stillOpen()) throw new Error("The ZotLit services did not close");
        app.saveLocalStorage("zotlit-use-ledger", JSON.parse(savedLedger));
        await app.plugins.enablePlugin("zotlit");
        const fresh = getServices();
        const restored = JSON.stringify(
          app.loadLocalStorage("zotlit-use-ledger") ?? null,
        );
        if (restored !== savedLedger)
          throw new Error(`The Use Ledger came back changed: ${restored}`);
        await within(
          fresh.bridge.runPromise(fresh.attachmentResolver.indexed),
          deadline(),
          "The Attachment index was not built again",
        );
      });
    }
    async function draft(
      cleanup: AsyncDisposableStack,
      { notePath, content }: { notePath: string; content: string },
    ) {
      const layout = app.workspace.getLayout();
      cleanup.defer(() => app.workspace.changeLayout(layout));
      const file = await app.vault.create(notePath, content);
      cleanup.defer(() => app.vault.delete(file));
      const leaf = cleanup.adopt(app.workspace.getLeaf("tab"), async (leaf) => {
        await (leaf.view as LinkMarkdownView).save?.();
        leaf.detach();
      });
      await leaf.setViewState({
        type: "markdown",
        state: { file: file.path, mode: "source", source: false },
        active: true,
      });
      return {
        file,
        leaf,
        view: leaf.view as LinkMarkdownView,
      };
    }
    async function inlineProfile(
      cleanup: AsyncDisposableStack,
      { template, suffix }: { template: string; suffix: string },
    ) {
      const services = getServices();
      const profilePath = services.bridge.runSync(
        services.profile.defaultDocumentPath,
      );
      const existing = app.vault.getFileByPath(profilePath);
      const original = existing
        ? await app.vault.read(existing)
        : services.bridge.runSync(services.profile.getBuiltInSource);
      const header = "--- zotlit:annotation ---";
      if (!original.includes(header))
        throw new Error("The default profile has no annotation section");
      if (!original.includes("{%"))
        throw new Error("The default profile does not render through Liquid");
      const inline =
        original.slice(0, original.indexOf(header) + header.length) + suffix;
      if (existing) {
        cleanup.defer(async () => {
          await app.vault.modify(existing, original);
          await services.bridge.runPromise(services.template.refresh);
        });
        await app.vault.modify(existing, inline);
      } else {
        const folder = profilePath.slice(0, profilePath.lastIndexOf("/"));
        if (folder && !app.vault.getFolderByPath(folder)) {
          cleanup.defer(async () => {
            const made = app.vault.getFolderByPath(folder);
            if (made && made.children.length === 0)
              await app.vault.delete(made);
          });
          await app.vault.createFolder(folder);
        }
        cleanup.defer(async () => {
          const made = app.vault.getFileByPath(profilePath);
          if (made) await app.vault.delete(made);
          await services.bridge.runPromise(services.template.refresh);
        });
        await app.vault.create(profilePath, inline);
      }
      await services.bridge.runPromise(services.template.refresh);
      await until(
        () =>
          services.bridge
            .runSync(services.template.getLoadedDocumentSource(profilePath))
            ?.includes(template),
        () => "The inline annotation template did not load",
      );
    }
    function applySettings(
      cleanup: AsyncDisposableStack,
      changes: LinkSettings,
    ): void {
      const services = getServices();
      for (const key of Object.keys(changes) as (keyof typeof changes)[]) {
        const was = services.bridge.runSync(services.settings.current)[key];
        cleanup.defer(() => {
          services.bridge.runSync(services.settings.update({ [key]: was }));
        });
        services.bridge.runSync(
          services.settings.update({ [key]: changes[key] }),
        );
      }
    }
    async function showNote(
      cleanup: AsyncDisposableStack,
      {
        notePath,
        content,
        gesture,
      }: {
        notePath: string;
        content: string;
        gesture: LinkGesture;
      },
    ) {
      const file = await app.vault.create(notePath, content);
      cleanup.defer(() => app.vault.delete(file));
      const leaf = cleanup.adopt(app.workspace.getLeaf("tab"), (leaf) =>
        leaf.detach(),
      );
      const state =
        gesture === "reading"
          ? { mode: "preview" }
          : { mode: "source", source: gesture === "source" };
      await leaf.setViewState({
        type: "markdown",
        state: { file: file.path, ...state },
        active: true,
      });
      app.workspace.setActiveLeaf(leaf, { focus: true });
      const view = leaf.view as LinkMarkdownView;
      if (gesture !== "reading")
        view.editor.setCursor({ line: view.editor.lastLine(), ch: 0 });
      return { file, leaf, view };
    }
    async function linkTarget(
      view: LinkMarkdownView,
      {
        url,
        gesture,
        linkText,
      }: {
        url: string;
        gesture: LinkGesture;
        linkText: string;
      },
    ) {
      const find = () => {
        if (gesture === "reading")
          return [
            ...view.previewMode.containerEl.querySelectorAll<HTMLAnchorElement>(
              "a.external-link",
            ),
          ].find((a) => a.getAttribute("href") === url);
        if (gesture === "properties")
          return [
            ...(view.metadataEditor?.containerEl.querySelectorAll<HTMLElement>(
              ".metadata-link-inner.external-link",
            ) ?? []),
          ].find((link) => link.dataset.href === url);
        const selector =
          gesture === "live-preview" ? ".cm-link .cm-underline" : ".cm-link";
        return [
          ...view.editor.cm.contentDOM.querySelectorAll<HTMLElement>(selector),
        ].find((el) => el.textContent === linkText);
      };
      const link = await until(
        find,
        () => `The link did not render in ${gesture}`,
      );
      link.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "instant",
      });
      const box = link.getClientRects()[0]!;
      const x = box.left + Math.min(box.width / 2, 12),
        y = box.top + box.height / 2;
      const hit = link.ownerDocument.elementFromPoint(x, y);
      if (!hit || !(hit === link || link.contains(hit)))
        throw new Error(
          `The link is covered by ${hit?.outerHTML.slice(0, 120) ?? "nothing"}`,
        );
      return { link, x, y };
    }
    return {
      sleep,
      deadline,
      past,
      within,
      until,
      restoreLedger,
      draft,
      inlineProfile,
      applySettings,
      showNote,
      linkTarget,
    };
  }

  async function revealQueryView({ path, kind }: NoteQueryView) {
    const leaves = app.workspace
      .getLeavesOfType("markdown")
      .filter((l) => (l.view as LinkMarkdownView).file?.path === path);
    const leaf =
      leaves.find((l) => l === app.workspace.getMostRecentLeaf()) ?? leaves[0];
    if (!leaf) throw new Error(`Cannot reveal: note not open: ${path}`);
    const view = leaf.view as LinkMarkdownView & {
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
      throw new Error(`Cannot reveal: no ${kind.name} in ${path}`);
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
          `Not drawn: ${kind.name} in ${path} (${view.getMode()}, lines ${
            from
          }-${to})`,
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

  return {
    leavesOfType,
    measure,
    waitFor,
    pressKey,
    scratch,
    revealQueryView,
    annotationLinkTools,
    menuEvent,
    installAnnotationPreparation,
    resetAnnotationPreparation,
    restoreAnnotationPreparation,
    annotationOpenSubpath,
    workbench,
    workbenchSurfaces,
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
