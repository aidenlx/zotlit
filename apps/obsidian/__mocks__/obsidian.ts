/**
 * Runtime stand-in for the `obsidian` module, used by Vitest via
 * `vitest.config.ts` `resolve.alias`. The real `obsidian` package is
 * types-only (`packages/obsidian-api`), so without this alias any test
 * that imports values from `"obsidian"` fails to resolve.
 *
 * Only the surface area the plugin actually touches in tests is exposed
 * here — extend as needed alongside the services that consume it.
 */

import type {
  App,
  Command,
  Debouncer,
  GraphOptionListener,
  EditorSuggestContext,
  FrontMatterInfo,
  EventRef,
  Events,
  HoverParent,
  HoverPopover as ObsidianHoverPopover,
  IconName,
  WorkspaceLeaf,
  Instruction,
  Modifier,
  PaneType,
  SearchMatchPart,
  SearchResult,
  UserEvent,
} from "obsidian";
import {
  parse as parseYamlSource,
  stringify as stringifyYamlSource,
} from "yaml";

/**
 * Stand-in for Obsidian's simple search: every whitespace-separated term of the
 * query must appear in the text, case-insensitively.
 */
export function prepareSimpleSearch(
  query: string,
): (text: string) => SearchResult | null {
  const terms = query.toLowerCase().split(/\s+/u).filter(Boolean);
  return (text) => {
    const haystack = text.toLowerCase();
    const matches: SearchMatchPart[] = [];
    for (const term of terms) {
      const at = haystack.indexOf(term);
      if (at === -1) return null;
      matches.push([at, at + term.length]);
    }
    return { score: -matches.length, matches };
  };
}

export function getIcon(name: IconName): SVGSVGElement | null {
  const svg = globalThis.document?.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  if (!svg) return null;
  svg.setAttribute("class", `svg-icon lucide-${name}`);
  return svg;
}

export function setIcon(el: HTMLElement, name: IconName): void {
  const icon = getIcon(name);
  el.replaceChildren(...(icon ? [icon] : []));
  el.setAttribute("data-icon", name);
}

/** Stand-in for Obsidian's delegated tooltip attributes. */
export function setTooltip(el: HTMLElement, tooltip: string): void {
  el.setAttribute("aria-label", tooltip);
}

// Obsidian exposes `sleep` as a runtime global; toast durations await it.
// Provide it for tests that exercise that code path.
globalThis.sleep ??= (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Minimal element stub covering the `addClasses` / `querySelector` surface
 * `BaseNotice` touches in its constructor. */
const noticeElStub = {
  addClasses: (_classes: string[]) => {},
  querySelector: (_selector: string): HTMLElement | null => null,
} as unknown as HTMLElement;

export class Notice {
  noticeEl: HTMLElement = noticeElStub;
  containerEl: HTMLElement = noticeElStub;
  messageEl: HTMLElement = noticeElStub;
  constructor(_message: string | DocumentFragment, _duration?: number) {}
  setMessage(_message: string | DocumentFragment): this {
    return this;
  }
  hide(): void {}
}

// The three CodeMirror facets/fields Obsidian adds to its editors. A state
// without them answers `state.field(field, false)` with `undefined` and
// `view.plugin(plugin)` with `null`, which is what an editor-less test needs.
export const editorInfoField = {};
export const editorLivePreviewField = {};
export const livePreviewState = {};

/**
 * Constructible stand-in for `MarkdownView`, enough for the `instanceof` narrow
 * that reaches a leaf's reading view.
 */
export class MarkdownView {
  previewMode = {
    rerender(_full?: boolean): void {},
  };
}

/**
 * Stand-in for Obsidian's `Component`: the load/unload pair and the child
 * list, which is what a post-processor's `ctx.addChild` hangs a render child
 * on and what Obsidian tears down with the section.
 */
export class Component {
  #loaded = false;
  readonly #children: Component[] = [];

  load(): void {
    if (this.#loaded) return;
    this.#loaded = true;
    this.onload();
    for (const child of this.#children) child.load();
  }

  unload(): void {
    if (!this.#loaded) return;
    this.#loaded = false;
    for (const child of this.#children) child.unload();
    this.onunload();
  }

  addChild<T extends Component>(child: T): T {
    this.#children.push(child);
    if (this.#loaded) child.load();
    return child;
  }

  onload(): void {}
  onunload(): void {}
}

/** Stand-in for `MarkdownRenderChild`: a component bound to one element. */
export class MarkdownRenderChild extends Component {
  constructor(readonly containerEl: HTMLElement) {
    super();
  }
}

export enum PopoverState {
  Showing,
  Shown,
  Hiding,
  Hidden,
}

/**
 * Stand-in for Obsidian's own hover popover: the element a plugin fills, the
 * unload hook its content is torn down through, and the placement `position()`
 * records as an inline style. Placement is inert here — a test that asserts a
 * placement writes the style itself, the way Obsidian's positioning engine does.
 *
 * The opening sequence follows the runtime one — the constructor arms the wait
 * timer, and the timer opens the popover — so a subclass meets the lifecycle it
 * inherits rather than a stub of it. Timers keep the runtime's windows too: each
 * is armed on `activeWindow` and cancelled with the main window's
 * `clearTimeout`, which is what misses while a popout owns focus.
 */
export class HoverPopover {
  readonly hoverEl: HTMLElement;
  targetEl: HTMLElement | null;
  onTarget = true;
  onHover = false;
  state = PopoverState.Showing;
  readonly waitTime: number;
  hidden = false;
  readonly #parent: HoverParent;
  readonly #unload: (() => void)[] = [];
  #loaded = false;
  timer: number;

  constructor(
    parent: HoverParent,
    targetEl: HTMLElement | null,
    waitTime = 300,
  ) {
    this.hoverEl = document.createElement("div");
    this.hoverEl.className = "popover hover-popover";
    this.targetEl = targetEl;
    this.waitTime = waitTime;
    this.#parent = parent;
    targetEl?.addEventListener("mouseover", this.onMouseIn);
    targetEl?.addEventListener("mouseout", this.onMouseOut);
    this.hoverEl.addEventListener("mouseover", (event) => {
      if (this.hoverEl.contains(event.relatedTarget as Node | null)) return;
      this.onHover = true;
      this.transition();
    });
    this.hoverEl.addEventListener("mouseout", (event) => {
      if (this.hoverEl.contains(event.relatedTarget as Node | null)) return;
      this.onHover = false;
      this.transition();
    });
    this.timer = activeWindow.setTimeout(() => {
      this.show();
    }, waitTime);
  }

  onMouseIn = (event: MouseEvent): void => {
    if (this.targetEl?.contains(event.relatedTarget as Node | null)) return;
    this.onTarget = true;
    this.transition();
  };

  onMouseOut = (event: MouseEvent): void => {
    if (this.targetEl?.contains(event.relatedTarget as Node | null)) return;
    this.onTarget = false;
    this.transition();
  };

  #shouldShow(): boolean {
    return (
      this.onTarget ||
      this.onHover ||
      this.hoverEl.contains(document.activeElement)
    );
  }

  transition(): void {
    if (this.#shouldShow()) {
      if (this.state === PopoverState.Hiding) {
        this.state = PopoverState.Shown;
        clearTimeout(this.timer);
      }
    } else if (this.state === PopoverState.Showing) {
      this.hide();
    } else if (this.state === PopoverState.Shown) {
      this.state = PopoverState.Hiding;
      this.timer = activeWindow.setTimeout(() => {
        if (this.#shouldShow()) this.transition();
        else this.hide();
      }, this.waitTime);
    }
  }

  register(cb: () => void): void {
    this.#unload.push(cb);
  }

  load(): void {
    this.#loaded = true;
  }

  registerEvent(ref: EventRef): void {
    const { e } = ref as unknown as { e: Events };
    this.#unload.push(() => e.offref(ref));
  }

  show(): void {
    if (this.targetEl && !document.body.contains(this.targetEl)) {
      this.hide();
      return;
    }
    this.state = PopoverState.Shown;
    this.position();
    this.onShow();
    this.load();
  }

  /** This popover as the parent holds it, which the vendored type names. */
  get #self(): ObsidianHoverPopover {
    return this as unknown as ObsidianHoverPopover;
  }

  onShow(): void {
    this.#parent.hoverPopover?.hide();
    this.#parent.hoverPopover = this.#self;
  }

  position(): void {
    if (this.hoverEl.parentElement !== document.body) {
      document.body.appendChild(this.hoverEl);
    }
  }

  watchResize(_el: HTMLElement): void {}

  hide(): void {
    clearTimeout(this.timer);
    this.state = PopoverState.Hidden;
    this.targetEl?.removeEventListener("mouseover", this.onMouseIn);
    this.targetEl?.removeEventListener("mouseout", this.onMouseOut);
    this.onTarget = false;
    this.onHover = false;
    this.hidden = true;
    this.hoverEl.remove();
    this.onHide();
    if (this.#loaded) {
      this.#loaded = false;
      for (const cb of this.#unload.splice(0).reverse()) cb();
    }
  }

  onHide(): void {
    if (this.#parent.hoverPopover === this.#self) {
      this.#parent.hoverPopover = null;
    }
  }
}

export class TAbstractFile {
  vault: Vault = undefined as unknown as Vault;
  path = "";
  name = "";
  parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
  stat = { type: "file", ctime: 0, mtime: 0, size: 0 } as const;
  basename = "";
  extension = "";
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];

  isRoot(): boolean {
    return this.parent === null;
  }
}

/** Minimal ItemView shell for tests of plugin-registered views. */
export class ItemView {
  readonly contentEl: HTMLElement;
  readonly titleEl: HTMLElement;

  constructor(readonly leaf: WorkspaceLeaf) {
    if (typeof Reflect.get(leaf, "updateHeader") !== "function")
      leaf.updateHeader = () => {};
    const content = globalThis.document?.createElement("div");
    this.titleEl =
      globalThis.document?.createElement("div") ??
      ({ textContent: "" } as HTMLElement);
    if (!content) {
      this.contentEl = {
        addClass: (..._classes: string[]) => {},
      } as unknown as HTMLElement;
      return;
    }
    (
      content as HTMLElement & { addClass: (...classes: string[]) => void }
    ).addClass = (...classes) => content.classList.add(...classes);
    this.contentEl = content;
  }

  readonly actions: HTMLElement[] = [];

  addAction(
    _icon: string,
    title: string,
    callback: (evt: MouseEvent) => unknown,
  ): HTMLElement {
    const action = document.createElement("div");
    action.setAttribute("aria-label", title);
    action.addEventListener("click", callback);
    this.actions.push(action);
    return action;
  }

  registerEvent(_event: EventRef): void {}
  registerDomEvent(
    ...[element, type, callback, options]: [
      HTMLElement,
      string,
      EventListener,
      (boolean | AddEventListenerOptions)?,
    ]
  ): void {
    element.addEventListener(type, callback, options);
  }
  register<T extends () => void>(disposer: T): T {
    return disposer;
  }

  protected onOpen(): Promise<void> {
    return Promise.resolve();
  }

  protected onClose(): Promise<void> {
    return Promise.resolve();
  }

  onResize(): void {}
  onPaneMenu(_menu: Menu, _source: string): void {}
  getViewType(): string {
    return "";
  }

  getDisplayText(): string {
    return "";
  }

  getIcon(): string {
    return "";
  }

  getState(): Record<string, unknown> {
    return {};
  }

  setState(_state: unknown, _result: unknown): Promise<void> {
    return Promise.resolve();
  }
}

/** File serialization seam; tests drive the editor's load and save callbacks. */
export class TextFileView extends ItemView {
  readonly app: App;
  file: TFile | null = null;
  data = "";
  dirty = false;
  lastSavedData: string | null = null;
  scope: Scope | null = null;
  requestSave = (): void => {};
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.app = (leaf as unknown as { app: App }).app;
  }
  getViewData(): string {
    return this.data;
  }
  setViewData(data: string, _clear: boolean): void {
    this.data = data;
  }
  clear(): void {
    this.data = "";
  }
  async save(): Promise<void> {
    this.data = this.getViewData();
  }
  /** Native read/baseline ordering; real-app checks cover native three-way merging. */
  async loadFileInternal(file: TFile, clear: boolean): Promise<void> {
    const source = await this.app.vault.read(
      file as unknown as import("obsidian").TFile,
    );
    const previous = this.lastSavedData;
    this.lastSavedData = source;
    if (!clear && previous === source) return;
    this.data = source;
    this.setViewData(source, clear);
  }
  onPaneMenu(_menu: Menu, _source: string): void {}
  override async setState(state: unknown, result: unknown): Promise<void> {
    if (
      state &&
      typeof state === "object" &&
      "file" in state &&
      state.file === null &&
      this.file
    ) {
      await this.save();
      this.file = null;
    }
    await super.setState(state, result);
  }
  override getState(): Record<string, unknown> {
    return this.file ? { file: this.file.path } : {};
  }
}

export class Vault {
  getConfig(_key: string): boolean {
    return false;
  }
  static recurseChildren(
    root: TFolder,
    cb: (file: TAbstractFile) => any,
  ): void {
    for (const child of root.children) {
      cb(child);
      if (child instanceof TFolder) Vault.recurseChildren(child, cb);
    }
  }
}

export class FileSystemAdapter {
  constructor(readonly basePath = "/vault") {}

  getFullPath(normalizedPath: string): string {
    return `${this.basePath}/${normalizedPath}`;
  }
}

/**
 * Parses like the real `sanitizeHTMLToDom`, but sanitizes nothing — Obsidian
 * runs the markup through DOMPurify, which the plugin does not depend on.
 * A test that asserts on sanitizing belongs against the real Obsidian runtime.
 * Needs a DOM, so its callers run under `// @vitest-environment happy-dom`.
 */
export function sanitizeHTMLToDom(html: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

/**
 * Appends `text` to `el`, wrapping each match range in the highlight span the
 * real renderer uses. Needs a DOM, so its callers run under
 * `// @vitest-environment happy-dom`.
 */
// oxlint-disable-next-line max-params -- mirrors Obsidian's own signature.
export function renderMatches(
  el: HTMLElement,
  text: string,
  matches: [number, number][] | null,
  offset = 0,
): void {
  let at = 0;
  for (const [start, end] of matches ?? []) {
    const from = start + offset;
    const to = end + offset;
    if (from < at || from >= text.length) continue;
    el.appendChild(document.createTextNode(text.slice(at, from)));
    const highlight = document.createElement("span");
    highlight.className = "suggestion-highlight";
    highlight.textContent = text.slice(from, to);
    el.appendChild(highlight);
    at = to;
  }
  el.appendChild(document.createTextNode(text.slice(at)));
}

export function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replaceAll(/\/+/g, "/").replace(/\/$/, "");
}

/** Splits a linktext at its first `#`; the subpath keeps that separator. */
export function parseLinktext(linktext: string): {
  path: string;
  subpath: string;
} {
  const hash = linktext.indexOf("#");
  if (hash < 0) return { path: linktext, subpath: "" };
  return { path: linktext.slice(0, hash), subpath: linktext.slice(hash) };
}

export function stringifyYaml(data: unknown): string {
  return stringifyYamlSource(data);
}

export function parseYaml(source: string): unknown {
  return parseYamlSource(source);
}

/** Stand-in for Obsidian's Properties block scan: a leading `---` fence. */
export function getFrontMatterInfo(source: string): FrontMatterInfo {
  const end = source.startsWith("---\n") ? source.indexOf("\n---\n", 4) : -1;
  return end < 0
    ? { exists: false, frontmatter: "", from: 0, to: 0, contentStart: 0 }
    : {
        exists: true,
        frontmatter: source.slice(4, end),
        from: 4,
        to: end,
        contentStart: end + 5,
      };
}

export abstract class EditorSuggest<T> {
  context: EditorSuggestContext | null = null;
  limit = 0;
  readonly app: App;

  constructor(app: App) {
    this.app = app;
  }

  setInstructions(_instructions: unknown[]): void {}

  close(): void {}

  abstract renderSuggestion(value: T, el: HTMLElement): void;
  abstract selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void;
}

export abstract class AbstractInputSuggest<T> {
  constructor(_app: App, _input: HTMLInputElement | HTMLDivElement) {}
  close(): void {}
  protected abstract getSuggestions(query: string): T[] | Promise<T[]>;
  abstract renderSuggestion(value: T, el: HTMLElement): void;
  abstract selectSuggestion(value: T, event: MouseEvent | KeyboardEvent): void;
}

/**
 * Records keymap registrations so a test can look one up by modifiers plus key
 * and invoke its handler, standing in for a real keypress.
 */
export class Scope {
  readonly handlers: {
    modifiers: Modifier[] | null;
    key: string | null;
    func: (evt: KeyboardEvent) => boolean | void;
  }[] = [];

  register(
    modifiers: Modifier[] | null,
    key: string | null,
    func: (evt: KeyboardEvent) => boolean | void,
  ): unknown {
    const handler = { modifiers, key, func };
    this.handlers.push(handler);
    return handler;
  }
}

export abstract class FuzzySuggestModal<T> {
  constructor(readonly app: App) {}
  setPlaceholder(_placeholder: string): void {}
  open(): void {}
  abstract getItems(): T[];
  abstract getItemText(item: T): string;
  abstract onChooseItem(item: T): void;
}

export abstract class SuggestModal<T> {
  limit = 0;
  readonly contentEl = { addClass: (_className: string) => {} };
  emptyStateText = "";
  readonly app: App;
  readonly scope = new Scope();

  constructor(app: App) {
    this.app = app;
  }

  setPlaceholder(_placeholder: string): void {}
  setTitle(_title: string): this {
    return this;
  }
  setInstructions(_instructions: Instruction[]): void {}
  open(): void {}
  close(): void {
    this.onClose();
  }
  onClose(): void {}
  selectActiveSuggestion(_evt: MouseEvent | KeyboardEvent): void {}
  selectSuggestion(value: T, event: MouseEvent | KeyboardEvent): void {
    this.close();
    this.onChooseSuggestion(value, event);
  }

  abstract getSuggestions(query: string): T[] | Promise<T[]>;
  abstract renderSuggestion(value: T, el: HTMLElement): void;
  abstract onChooseSuggestion(item: T, evt: MouseEvent | KeyboardEvent): void;
}

export const Keymap = {
  isModifier(_evt: MouseEvent | KeyboardEvent, _modifier: Modifier): boolean {
    return false;
  },
  isModEvent(_evt?: UserEvent | null): PaneType | boolean {
    return false;
  },
};

/**
 * Lightweight stand-in for the subset of `Plugin.addCommand` tests touch.
 * Holds the most-recently registered command per id so a test can invoke its
 * callback directly.
 */
export function createMockPlugin(): {
  addCommand(command: Command): Command;
  commands: Map<string, Command>;
} {
  const commands = new Map<string, Command>();
  return {
    commands,
    addCommand(command: Command): Command {
      commands.set(command.id, command);
      return command;
    },
  };
}

let platformIsWin: boolean | undefined;
let platformIsMacOS: boolean | undefined;
let platformIsDesktopApp: boolean | undefined;

export const Platform = {
  get isDesktopApp(): boolean {
    if (platformIsDesktopApp === undefined)
      throw new Error(
        "Platform.isDesktopApp not configured — call setMockPlatform({ isDesktopApp }) in test setup",
      );
    return platformIsDesktopApp;
  },
  get isWin(): boolean {
    if (platformIsWin === undefined) {
      throw new Error(
        "Platform.isWin not configured — call setMockPlatform({ isWin }) in test setup",
      );
    }
    return platformIsWin;
  },
  get isMacOS(): boolean {
    if (platformIsMacOS === undefined) {
      throw new Error(
        "Platform.isMacOS not configured — call setMockPlatform({ isMacOS }) in test setup",
      );
    }
    return platformIsMacOS;
  },
};

/**
 * Configure the mocked `Platform` for the current test. Mirrors the real
 * `obsidian` module, where `Platform` is effectively read-only — tests must
 * never assign to `Platform.isWin` directly.
 */
export function setMockPlatform(overrides: {
  isWin?: boolean;
  isMacOS?: boolean;
  isDesktopApp?: boolean;
}): void {
  if (overrides.isWin !== undefined) platformIsWin = overrides.isWin;
  if (overrides.isMacOS !== undefined) platformIsMacOS = overrides.isMacOS;
  if (overrides.isDesktopApp !== undefined)
    platformIsDesktopApp = overrides.isDesktopApp;
}

export function resetMockPlatform(): void {
  platformIsWin = undefined;
  platformIsMacOS = undefined;
  platformIsDesktopApp = undefined;
}

export function getLanguage(): string {
  return "en";
}

export async function requestUrl(): Promise<never> {
  throw new Error("requestUrl not configured in the Obsidian test mock");
}

/** Tests run against the current API surface, so every version check passes. */
export function requireApiVersion(_version: string): boolean {
  return true;
}

/** Minimal stand-in for `MenuItem`; only the builder methods the plugin
 * chains off `Menu.addItem` plus a test-only `click()` to invoke the
 * registered handler. */
export class MenuItem {
  #title = "";
  #section = "";
  #checked: boolean | null = null;
  #disabled = false;
  #onClick: ((evt: MouseEvent) => unknown) | null = null;

  /** Populated by {@link setSubmenu}; lets tests inspect a submenu's items. */
  submenu: Menu | null = null;

  get title(): string {
    return this.#title;
  }

  /** `null` for an item that carries no check mark, as in Obsidian. */
  get checked(): boolean | null {
    return this.#checked;
  }

  /** `""` for an unsectioned item, as in Obsidian. */
  get section(): string {
    return this.#section;
  }

  /** Whether the row is disabled, as in Obsidian. */
  get disabled(): boolean {
    return this.#disabled;
  }

  setTitle(title: string): this {
    this.#title = title;
    return this;
  }

  setIcon(_icon: string | null): this {
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.#disabled = disabled;
    return this;
  }

  setWarning(_isWarning: boolean): this {
    return this;
  }

  setSection(section: string): this {
    this.#section = section;
    return this;
  }

  setChecked(checked: boolean | null): this {
    this.#checked = checked;
    return this;
  }

  setSubmenu(): Menu {
    this.submenu = new Menu();
    return this.submenu;
  }

  onClick(cb: (evt: MouseEvent) => unknown): this {
    this.#onClick = cb;
    return this;
  }

  /** Test helper: invoke the registered `onClick` handler; a no-op while
   * disabled, as Obsidian ignores clicks on disabled items. */
  click(): void {
    if (this.#disabled) return;
    this.#onClick?.({} as MouseEvent);
  }
}

/**
 * Minimal stand-in for `Menu`. Records every constructed instance on
 * `Menu.instances` so tests can inspect the menu built by code under test
 * without the production code needing to return it.
 *
 * `items` stays in insertion order: Obsidian's section grouping runs in
 * `sort()` from `show()`, which this mock never performs, and a faithful
 * `sort()` would materialize separators into `items`, which {@link
 * Menu.addSeparator} deliberately keeps out. Assert
 * {@link MenuItem.section} instead of inferring grouping from position.
 */
export class Menu {
  static instances: Menu[] = [];

  readonly items: MenuItem[] = [];

  /** Where `showAtPosition` was asked to open, or `null` while it was not. */
  position: { x: number; y: number } | null = null;

  constructor() {
    Menu.instances.push(this);
  }

  addItem(cb: (item: MenuItem) => unknown): this {
    const item = new MenuItem();
    cb(item);
    this.items.push(item);
    return this;
  }

  /** No-op divider; kept out of `items` so index-based assertions see only actionable entries. */
  addSeparator(): this {
    return this;
  }

  setNoIcon(): this {
    return this;
  }

  showAtMouseEvent(_evt: MouseEvent): this {
    return this;
  }

  showAtPosition(position: { x: number; y: number }): this {
    this.position = position;
    return this;
  }
}

/**
 * Deterministic test stand-in for Obsidian's `debounce`. Unlike the real
 * implementation it does **not** use timers: the callback fires only when
 * `.run()` is invoked explicitly. This matches how `SettingsService.flush()`
 * drives writes and keeps tests free of fake-timer setup.
 */
export function debounce<T extends unknown[], V>(
  cb: (...args: T) => V,
  _timeout?: number,
  _resetTimer?: boolean,
): Debouncer<T, V> {
  let pending: T | undefined;
  const debouncer = function debouncer(...args: T) {
    pending = args;
    return debouncer;
  } as unknown as Debouncer<T, V> & {
    cancel(): Debouncer<T, V>;
    run(): V | void;
  };
  debouncer.cancel = () => {
    pending = undefined;
    return debouncer;
  };
  debouncer.run = () => {
    if (pending === undefined) return;
    const args = pending;
    pending = undefined;
    return cb(...args);
  };
  return debouncer;
}

/**
 * Stand-in for `Modal`. Every instance lands on `Modal.instances`, so a test
 * reaches the dialog a function opened without that function returning it. The
 * `contentEl` is the dialog's own, so the rows built on it are readable through
 * {@link settingsOf}, and `close()` runs the close callback the way dismissing
 * the dialog does.
 */
export class Modal {
  static instances: Modal[] = [];

  containerEl: HTMLElement = noticeElStub;
  modalEl: HTMLElement = elementOrStub();
  contentEl: HTMLElement = elementOrStub();

  title = "";
  isOpen = false;

  #closed: (() => unknown) | null = null;

  constructor(readonly app: App) {
    Modal.instances.push(this);
  }

  setTitle(title: string): this {
    this.title = title;
    return this;
  }

  setCloseCallback(cb: () => unknown): this {
    this.#closed = cb;
    return this;
  }

  open(): void {
    this.isOpen = true;
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.#closed?.();
  }

  onOpen(): void {}
  onClose(): void {}
}

/** A real element under a DOM environment, so a dialog can build its body and
 * footer; the row-only stub elsewhere. */
function elementOrStub(): HTMLElement {
  return globalThis.document
    ? document.createElement("div")
    : containerElStub();
}

/** Minimal container a `Setting` row attaches itself to. */
function containerElStub(): HTMLElement {
  return {
    addClass: (_cls: string) => {},
    addClasses: (_classes: string[]) => {},
    querySelector: (_selector: string): HTMLElement | null => null,
  } as unknown as HTMLElement;
}

const settingRows = new WeakMap<HTMLElement, Setting[]>();

/** The rows built on one container, in the order they were built. */
export function settingsOf(containerEl: HTMLElement): Setting[] {
  return settingRows.get(containerEl) ?? [];
}

type Control =
  | ButtonComponent
  | DropdownComponent
  | TextComponent
  | ToggleComponent;
const controls = new WeakMap<HTMLElement, Control[]>();
function registerControl(containerEl: HTMLElement, control: Control): void {
  const list = controls.get(containerEl) ?? [];
  list.push(control);
  controls.set(containerEl, list);
}

/** The controls built directly on one container, in the order built; a dialog
 * that lays its own fields out (no `Setting` row) is read through this. */
export function controlsOf(containerEl: HTMLElement): Control[] {
  return controls.get(containerEl) ?? [];
}

/**
 * Stand-in for one `Setting` row. It records what it was named and holds the
 * components it was given, so a test reads a dialog the way a user does and
 * drives it through {@link DropdownComponent.choose}, {@link
 * TextComponent.type}, and {@link ButtonComponent.click}.
 */
export class Setting {
  /** The row's own element. Removing it takes the row out of {@link settingsOf}, as it takes it off the screen. */
  readonly settingEl: HTMLElement = Object.assign(containerElStub(), {
    remove: () => this.#remove(),
    detach: () => this.#remove(),
  });
  readonly controlEl = containerElStub();
  /** Every component added to this row, in the order it was added. */
  readonly components: (
    | ButtonComponent
    | DropdownComponent
    | ExtraButtonComponent
    | TextComponent
    | ToggleComponent
  )[] = [];

  name = "";
  desc = "";
  /** The hover text the row carries, as the user reads it. */
  tooltip = "";
  /** The classes the row was given, in the order it was given them. */
  readonly classes: string[] = [];
  errorMessage: string | null = null;

  constructor(readonly containerEl: HTMLElement) {
    const rows = settingRows.get(containerEl) ?? [];
    rows.push(this);
    settingRows.set(containerEl, rows);
  }

  #remove(): void {
    const rows = settingRows.get(this.containerEl) ?? [];
    settingRows.set(
      this.containerEl,
      rows.filter((row) => row !== this),
    );
  }

  setName(name: string): this {
    this.name = name;
    return this;
  }

  setTooltip(tooltip: string): this {
    this.tooltip = tooltip;
    return this;
  }

  setClass(cls: string): this {
    this.classes.push(cls);
    return this;
  }

  setDesc(desc: string): this {
    this.desc = desc;
    return this;
  }

  setErrorMessage(message: string | null): this {
    this.errorMessage = message;
    return this;
  }

  setHeading(): this {
    return this;
  }

  addDropdown(cb: (dropdown: DropdownComponent) => unknown): this {
    return this.#add(new DropdownComponent(this.containerEl), cb);
  }

  addText(cb: (text: TextComponent) => unknown): this {
    return this.#add(new TextComponent(this.containerEl), cb);
  }

  addTextArea(cb: (text: TextAreaComponent) => unknown): this {
    return this.#add(new TextAreaComponent(this.containerEl), cb);
  }

  addToggle(cb: (toggle: ToggleComponent) => unknown): this {
    return this.#add(new ToggleComponent(this.containerEl), cb);
  }

  addButton(cb: (button: ButtonComponent) => unknown): this {
    return this.#add(new ButtonComponent(this.containerEl), cb);
  }

  addExtraButton(cb: (button: ExtraButtonComponent) => unknown): this {
    return this.#add(new ExtraButtonComponent(this.containerEl), cb);
  }

  #add<
    T extends
      | ButtonComponent
      | DropdownComponent
      | ExtraButtonComponent
      | TextComponent
      | ToggleComponent,
  >(component: T, cb: (component: T) => unknown): this {
    this.components.push(component);
    cb(component);
    return this;
  }
}

export class DropdownComponent {
  /** Every entry the dropdown offers, in the order it offers them. */
  options: { value: string; label: string; disabled?: boolean }[] = [];

  selectEl = {
    replaceChildren: () => {
      this.options.length = 0;
    },
    options: this.options,
  } as unknown as HTMLSelectElement;

  #value = "";
  #changed: ((value: string) => unknown) | null = null;

  constructor(readonly containerEl: HTMLElement) {
    registerControl(containerEl, this);
  }

  addOption(value: string, label: string): this {
    this.options.push({ value, label });
    return this;
  }

  addOptions(options: Record<string, string>): this {
    for (const [value, label] of Object.entries(options))
      this.addOption(value, label);
    return this;
  }

  getValue(): string {
    return this.#value;
  }

  setValue(value: string): this {
    this.#value = value;
    return this;
  }

  onChange(cb: (value: string) => unknown): this {
    this.#changed = cb;
    return this;
  }

  /** Test helper: pick an entry, as the user does; a disabled entry refuses. */
  choose(value: string): void {
    if (this.options.find((option) => option.value === value)?.disabled) return;
    this.#value = value;
    this.#changed?.(value);
  }
}

/** The input surface a dialog seeds a value in and refuses one through. */
function inputElStub(): HTMLInputElement {
  const input = {
    value: "",
    addClass: (..._classNames: string[]) => {},
    placeholder: "",
    validationMessage: "",
    setCustomValidity: (message: string) => {
      input.validationMessage = message;
    },
    reportValidity: () => !input.validationMessage,
  };
  return input as unknown as HTMLInputElement;
}

export class TextComponent {
  inputEl: HTMLInputElement = inputElStub();

  #changed: ((value: string) => unknown) | null = null;

  constructor(readonly containerEl: HTMLElement) {
    registerControl(containerEl, this);
  }

  getValue(): string {
    return this.inputEl.value;
  }

  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }

  setPlaceholder(placeholder: string): this {
    this.inputEl.placeholder = placeholder;
    return this;
  }

  onChange(cb: (value: string) => unknown): this {
    this.#changed = cb;
    return this;
  }

  /** Test helper: type a value, as the user does. */
  type(value: string): void {
    this.setValue(value);
    this.#changed?.(value);
  }
}

export class TextAreaComponent extends TextComponent {}

export class ToggleComponent {
  #value = false;
  #changed: ((value: boolean) => unknown) | undefined;
  readonly toggleEl: HTMLElement;
  disabled = false;
  constructor(readonly containerEl: HTMLElement) {
    registerControl(containerEl, this);
    this.toggleEl = containerEl.createEl("label");
  }
  getValue(): boolean {
    return this.#value;
  }
  setValue(value: boolean): this {
    if (this.#value !== value) {
      this.#value = value;
      this.#changed?.(value);
    }
    return this;
  }
  setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    return this;
  }
  /**
   * Publishes the value under `key`, the way a graph controls-panel row
   * persists: the listener reads the value, and writes it when called with
   * one — which fires `onChange`, as `setValue` does.
   */
  registerOptionListener(
    listeners: Record<string, GraphOptionListener>,
    key: string,
  ): this {
    listeners[key] = (value?: unknown) => {
      if (typeof value === "boolean") this.setValue(value);
      return this.getValue();
    };
    return this;
  }
  onChange(callback: (value: boolean) => unknown): this {
    this.#changed = callback;
    return this;
  }
  /** Test helper: change the checked state, as the user does. */
  toggle(value: boolean): void {
    if (!this.disabled) this.setValue(value);
  }
}

/**
 * The borderless icon action a row carries beside its control. It is read by
 * the tooltip it names, which is the label the user gets from it.
 */
export class ExtraButtonComponent {
  icon = "";
  /** The label the button carries, as the user reads it on hover. */
  tooltip = "";
  /** Whether the row locked the button, as the user finds it. */
  disabled = false;

  #clicked: ((evt: MouseEvent) => unknown) | null = null;

  constructor(readonly containerEl: HTMLElement) {}

  setIcon(icon: string): this {
    this.icon = icon;
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    return this;
  }

  setTooltip(tooltip: string): this {
    this.tooltip = tooltip;
    return this;
  }

  onClick(cb: (evt: MouseEvent) => unknown): this {
    this.#clicked = cb;
    return this;
  }

  /** Test helper: press the button, as the user does. */
  click(): void {
    this.#clicked?.({} as MouseEvent);
  }
}

export class ButtonComponent {
  setDestructive(): this {
    return this;
  }
  buttonEl: HTMLElement = noticeElStub;

  /** The label the button carries, as the user reads it. */
  text = "";
  icon = "";
  /** The label an icon-only button carries, as the user reads it on hover. */
  tooltip = "";

  setIcon(icon: string): this {
    this.icon = icon;
    return this;
  }

  setTooltip(tooltip: string): this {
    this.tooltip = tooltip;
    return this;
  }

  then(cb: (button: this) => unknown): this {
    cb(this);
    return this;
  }

  #clicked: ((evt: MouseEvent) => unknown) | null = null;

  constructor(readonly containerEl: HTMLElement) {
    registerControl(containerEl, this);
  }

  onClick(cb: (evt: MouseEvent) => unknown): this {
    this.#clicked = cb;
    return this;
  }

  setButtonText(text: string): this {
    this.text = text;
    return this;
  }

  setDisabled(_disabled: boolean): this {
    return this;
  }

  setCta(): this {
    return this;
  }

  setWarning(): this {
    return this;
  }

  /** Test helper: press the button, as the user does. */
  click(): void {
    this.#clicked?.({} as MouseEvent);
  }
}

export class ConfirmationButton extends ButtonComponent {
  setDisabled(_disabled: boolean): this {
    return this;
  }
  setDestructive(): this {
    return this;
  }
}

export class ConfirmationModal {
  readonly contentEl = globalThis.document
    ? document.createElement("div")
    : containerElStub();
  #closed: (() => void) | undefined;
  constructor(_app: App) {}
  setTitle(_title: string): this {
    return this;
  }
  setContent(content: string | DocumentFragment): this {
    if (typeof content === "string") this.contentEl.textContent = content;
    else this.contentEl.replaceChildren(content);
    return this;
  }
  addCheckbox(_label: string, _changed: (value: boolean) => void): this {
    return this;
  }
  addButton(cb: (button: ConfirmationButton) => unknown): this {
    cb(new ConfirmationButton(noticeElStub));
    return this;
  }
  addCancelButton(_label: string): this {
    return this;
  }
  setCloseCallback(callback: () => void): this {
    this.#closed = callback;
    return this;
  }
  open(): void {}
  close(): void {
    this.#closed?.();
  }
}
