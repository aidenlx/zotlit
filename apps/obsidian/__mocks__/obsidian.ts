/**
 * Runtime stand-in for the `obsidian` module, used by Vitest via
 * `vitest.config.ts` `resolve.alias`. The real `obsidian` package is
 * types-only (`packages/obsidian-api`), so without this alias any test
 * that imports values from `"obsidian"` fails to resolve.
 *
 * Only the surface area the plugin actually touches in tests is exposed
 * here — extend as needed alongside the services that consume it.
 */

import {
  type App,
  type Command,
  type Debouncer,
  type EditorSuggestContext,
  type Instruction,
  type Modifier,
  type PaneType,
  type UserEvent,
} from "obsidian";

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

export const editorInfoField = {};

/**
 * Constructible stand-in for `MarkdownView`, enough for the `instanceof` narrow
 * that reaches a leaf's reading view.
 */
export class MarkdownView {
  previewMode = {
    rerender(_full?: boolean): void {},
  };
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

export abstract class SuggestModal<T> {
  limit = 0;
  emptyStateText = "";
  readonly app: App;

  constructor(app: App) {
    this.app = app;
  }

  setPlaceholder(_placeholder: string): void {}
  setInstructions(_instructions: Instruction[]): void {}

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

export const Platform = {
  get isWin(): boolean {
    if (platformIsWin === undefined) {
      throw new Error(
        "Platform.isWin not configured — call setMockPlatform({ isWin }) in test setup",
      );
    }
    return platformIsWin;
  },
};

/**
 * Configure the mocked `Platform` for the current test. Mirrors the real
 * `obsidian` module, where `Platform` is effectively read-only — tests must
 * never assign to `Platform.isWin` directly.
 */
export function setMockPlatform(overrides: { isWin?: boolean }): void {
  if (overrides.isWin !== undefined) platformIsWin = overrides.isWin;
}

export function resetMockPlatform(): void {
  platformIsWin = undefined;
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
  #onClick: ((evt: MouseEvent) => unknown) | null = null;

  /** Populated by {@link setSubmenu}; lets tests inspect a submenu's items. */
  submenu: Menu | null = null;

  get title(): string {
    return this.#title;
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

  showAtMouseEvent(_evt: MouseEvent): this {
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

/** Base-class stand-ins for `Modal` and `ButtonComponent`. The plugin's
 * modal/button subclasses only need something constructible to extend at import
 * time; no test opens a modal, so the members stay unimplemented. */
export class Modal {
  containerEl: HTMLElement = noticeElStub;
  modalEl: HTMLElement = noticeElStub;
  contentEl: HTMLElement = noticeElStub;
  constructor(readonly app: App) {}
  open(): void {}
  close(): void {}
  onOpen(): void {}
  onClose(): void {}
}

export class ButtonComponent {
  buttonEl: HTMLElement = noticeElStub;
  constructor(readonly containerEl: HTMLElement) {}
  onClick(_cb: (evt: MouseEvent) => unknown): this {
    return this;
  }
  setButtonText(_text: string): this {
    return this;
  }
  setCta(): this {
    return this;
  }
  setWarning(): this {
    return this;
  }
}
