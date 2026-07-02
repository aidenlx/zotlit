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
} from "obsidian";

// Obsidian exposes `sleep` as a runtime global; classify loops await it to yield
// between chunks. Provide it for tests that exercise that code path.
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

export function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replaceAll(/\/+/g, "/").replace(/\/$/, "");
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
