// Test double for one graph controls-panel section, shared by the row and service suites. Needs a DOM environment.

import type {
  GraphControlSection,
  GraphOptionListener,
  GraphOptions,
} from "obsidian";

/** What Obsidian's own `setDefaultOptions` replays: native keys alone. */
export const NATIVE_DEFAULT_OPTIONS: GraphOptions = {
  showTags: false,
  showOrphans: true,
};

/**
 * Keeps the two rules that decide whether a plugin row persists: `setOptions`
 * reaches a key only through its registered listener, and `getOptions`
 * enumerates the listeners rather than the engine's options.
 */
export class FakeControlSection implements GraphControlSection {
  readonly childrenEl: HTMLElement = document.createElement("div");
  readonly optionListeners: Record<string, GraphOptionListener> = {};
  /** How many times the native "Restore default settings" path ran. */
  natives = 0;

  setDefaultOptions(): void {
    this.natives += 1;
    this.setOptions(NATIVE_DEFAULT_OPTIONS);
  }

  setOptions(options: GraphOptions): void {
    for (const [key, value] of Object.entries(options)) {
      this.optionListeners[key]?.(value);
    }
  }

  getOptions(): GraphOptions {
    const options: GraphOptions = {};
    for (const [key, listener] of Object.entries(this.optionListeners)) {
      const value = listener();
      if (value !== undefined) options[key] = value;
    }
    return options;
  }
}
