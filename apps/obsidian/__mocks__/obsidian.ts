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
  EditorSuggestContext,
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
 * Stand-in for Obsidian's own hover popover: the element a plugin fills, the
 * unload hook its content is torn down through, and the placement `position()`
 * records as an inline style. Placement is inert here — a test that asserts a
 * placement writes the style itself, the way Obsidian's positioning engine does.
 *
 * The opening sequence follows the runtime one — the constructor arms the wait
 * timer, and the timer opens the popover — so a subclass meets the lifecycle it
 * inherits rather than a stub of it.
 */
export class HoverPopover {
  readonly hoverEl: HTMLElement;
  readonly targetEl: HTMLElement | null;
  readonly waitTime: number;
  hidden = false;
  readonly #parent: HoverParent;
  readonly #unload: (() => void)[] = [];
  readonly #timer: ReturnType<typeof setTimeout>;

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
    this.#timer = setTimeout(() => {
      this.show();
    }, waitTime);
  }

  register(cb: () => void): void {
    this.#unload.push(cb);
  }

  registerEvent(ref: EventRef): void {
    const { e } = ref as unknown as { e: Events };
    this.#unload.push(() => e.offref(ref));
  }

  show(): void {
    this.position();
    this.onShow();
  }

  /** This popover as the parent holds it, which the vendored type names. */
  get #self(): ObsidianHoverPopover {
    return this as unknown as ObsidianHoverPopover;
  }

  onShow(): void {
    this.#parent.hoverPopover = this.#self;
  }

  position(): void {
    if (this.hoverEl.parentElement !== document.body) {
      document.body.appendChild(this.hoverEl);
    }
  }

  watchResize(_el: HTMLElement): void {}

  hide(): void {
    clearTimeout(this.#timer);
    this.hidden = true;
    this.hoverEl.remove();
    this.onHide();
    for (const cb of this.#unload.splice(0)) cb();
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

  constructor(readonly leaf: WorkspaceLeaf) {
    const content = globalThis.document?.createElement("div");
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

  registerEvent(_event: EventRef): void {}
  register<T extends () => void>(disposer: T): T {
    return disposer;
  }

  protected onOpen(): Promise<void> {
    return Promise.resolve();
  }

  protected onClose(): Promise<void> {
    return Promise.resolve();
  }

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

export class Vault {
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

export function stringifyYaml(data: Record<string, unknown>): string {
  return Object.entries(data)
    .map(([key, value]) => `${key}: ${String(value)}\n`)
    .join("");
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
  setInstructions(_instructions: Instruction[]): void {}
  open(): void {}
  selectActiveSuggestion(_evt: MouseEvent | KeyboardEvent): void {}

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

export const Platform = {
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
}): void {
  if (overrides.isWin !== undefined) platformIsWin = overrides.isWin;
  if (overrides.isMacOS !== undefined) platformIsMacOS = overrides.isMacOS;
}

export function resetMockPlatform(): void {
  platformIsWin = undefined;
  platformIsMacOS = undefined;
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

  setTitle(title: string): this {
    this.#title = title;
    return this;
  }

  setIcon(_icon: string | null): this {
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

  /** Test helper: invoke the registered `onClick` handler. */
  click(): void {
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
  modalEl: HTMLElement = noticeElStub;
  contentEl: HTMLElement = containerElStub();

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

/**
 * Stand-in for one `Setting` row. It records what it was named and holds the
 * components it was given, so a test reads a dialog the way a user does and
 * drives it through {@link DropdownComponent.choose}, {@link
 * TextComponent.type}, and {@link ButtonComponent.click}.
 */
export class Setting {
  /** Every component added to this row, in the order it was added. */
  readonly components: (
    | ButtonComponent
    | DropdownComponent
    | ExtraButtonComponent
    | TextComponent
  )[] = [];

  name = "";
  desc = "";

  constructor(readonly containerEl: HTMLElement) {
    const rows = settingRows.get(containerEl) ?? [];
    rows.push(this);
    settingRows.set(containerEl, rows);
  }

  setName(name: string): this {
    this.name = name;
    return this;
  }

  setDesc(desc: string): this {
    this.desc = desc;
    return this;
  }

  addDropdown(cb: (dropdown: DropdownComponent) => unknown): this {
    return this.#add(new DropdownComponent(this.containerEl), cb);
  }

  addText(cb: (text: TextComponent) => unknown): this {
    return this.#add(new TextComponent(this.containerEl), cb);
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
      | TextComponent,
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

  constructor(readonly containerEl: HTMLElement) {}

  addOption(value: string, label: string): this {
    this.options.push({ value, label });
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

  constructor(readonly containerEl: HTMLElement) {}

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

/**
 * The borderless icon action a row carries beside its control. It is read by
 * the tooltip it names, which is the label the user gets from it.
 */
export class ExtraButtonComponent {
  icon = "";
  /** The label the button carries, as the user reads it on hover. */
  tooltip = "";

  #clicked: ((evt: MouseEvent) => unknown) | null = null;

  constructor(readonly containerEl: HTMLElement) {}

  setIcon(icon: string): this {
    this.icon = icon;
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
  buttonEl: HTMLElement = noticeElStub;

  /** The label the button carries, as the user reads it. */
  text = "";

  #clicked: ((evt: MouseEvent) => unknown) | null = null;

  constructor(readonly containerEl: HTMLElement) {}

  onClick(cb: (evt: MouseEvent) => unknown): this {
    this.#clicked = cb;
    return this;
  }

  setButtonText(text: string): this {
    this.text = text;
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
  setContent(_content: string): this {
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
