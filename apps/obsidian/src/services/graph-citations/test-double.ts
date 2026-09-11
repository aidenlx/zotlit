// Test doubles for the graph controls-panel sections, shared by the row, groups and service suites. Needs a DOM environment.

import type {
  GraphColorGroup,
  GraphColorGroupSection,
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

/**
 * Test double for the Groups section. Keeps the rule anything built into that
 * section rests on: `setColorQueries` empties the section body and builds it
 * again, taking whatever else stood in it. The native "New group" and the
 * per-row delete reach no such rebuild — they mutate the group rows in place —
 * so the fake models the rows as a list alone.
 */
export class FakeColorGroupSection implements GraphColorGroupSection {
  readonly childrenEl: HTMLElement = document.createElement("div");
  #groups: GraphColorGroup[] = [];

  getColoredQueries(): GraphColorGroup[] {
    return this.#groups.map((group) => ({ ...group }));
  }

  setColorQueries(queries: GraphColorGroup[]): void {
    this.#groups = queries.map((group) => ({ ...group }));
    this.childrenEl.replaceChildren();
    this.childrenEl.createDiv("graph-color-groups-container");
    this.childrenEl.createDiv("graph-color-button-container", (el) => {
      el.createEl("button", { text: "New group" });
    });
  }
}
