// One native-styled toggle row in the graph's Filters section, persisted the way a native row is.

import { Setting } from "obsidian";
import type { GraphControlSection, GraphEngine, GraphOptions } from "obsidian";

import { getLogger } from "@/lib/log";

import { membersPresent, wrapMember } from "./install";

const logger = getLogger("graph-citations");

/**
 * Engines whose controls panel could not be read. An engine lives as long as
 * the view that owns it and is collected with it, so the report is once per
 * graph however many times its rows are rebuilt.
 */
const reported = new WeakSet<GraphEngine>();

/** The engine members one row writes when its value changes. */
export interface RowEngine {
  options: GraphOptions;
  render(): unknown;
  onOptionsChange(): void;
}

/** Where a row is built, and what the graph persisted before it existed. */
export interface ToggleRowTarget {
  engine: RowEngine;
  section: GraphControlSection;
  /**
   * The graph's saved options, or `null` when they cannot be read. A graph
   * applies them before a plugin row exists to hear them, so the row reads
   * its own key back out of them instead of starting at its default.
   */
  saved: GraphOptions | null;
}

/** One toggle row: what it says, what it persists under, what it defaults to. */
export interface ToggleRow {
  /** The option key the value round-trips under; ZotLit's keys are `zotlit-` prefixed. */
  key: string;
  /** The row label, in sentence case. */
  name: string;
  /** The native hover tooltip. */
  tooltip: string;
  /** What a fresh row starts at, and what "Restore default settings" returns it to. */
  defaultValue: boolean;
}

export interface ToggleRowTargetOptions {
  /** What the graph persisted; see {@link ToggleRowTarget.saved}. */
  saved: GraphOptions | null;
}

/**
 * Locates the Filters section and the engine members a row writes. A build
 * that moved any of them is reported at `warn` once per graph and gets no
 * rows, so the panel keeps its native shape.
 *
 * @returns `null` when a member is missing.
 */
export function toggleRowTarget(
  engine: GraphEngine,
  options: ToggleRowTargetOptions,
): ToggleRowTarget | null {
  if (reported.has(engine)) return null;
  const section = engine.filterOptions;
  const present = membersPresent(
    "Graph controls section is missing a member; no rows built",
    {
      "engine.options": Boolean(engine.options),
      "engine.render": typeof engine.render === "function",
      "engine.onOptionsChange": typeof engine.onOptionsChange === "function",
      "engine.filterOptions": Boolean(section),
      "section.childrenEl": Boolean(section?.childrenEl),
      "section.optionListeners": Boolean(section?.optionListeners),
      "section.setDefaultOptions":
        typeof section?.setDefaultOptions === "function",
    },
    { section: "filter" },
  );
  if (!present) {
    reported.add(engine);
    return null;
  }
  return {
    engine: engine as RowEngine,
    section: section!,
    saved: options.saved,
  };
}

/**
 * Builds one native-styled toggle row into the section and registers it as an
 * option listener, which is what makes the value round-trip: `getOptions`
 * enumerates the listeners, so the row persists where its graph persists —
 * Graph core plugin data for the global graph, leaf state for a local one.
 *
 * A change has the three effects a native row has: it writes
 * `engine.options[key]`, re-renders, and saves. "Restore default settings"
 * replays native keys alone, so the row also wraps the section's
 * `setDefaultOptions` to return itself to {@link ToggleRow.defaultValue}.
 *
 * @returns a Disposable that removes the row, its listener, and the wrap. The
 *   value stays in `engine.options`, where nothing native reads it and no
 *   `getOptions` reports it, so a re-install finds the row as the user left
 *   it while a native render is unchanged.
 */
export function installToggleRow(
  target: ToggleRowTarget,
  row: ToggleRow,
): Disposable {
  const { engine, section } = target;
  const value = rowValue(target, row);
  engine.options[row.key] = value;
  const setting = new Setting(section.childrenEl)
    .setName(row.name)
    .setTooltip(row.tooltip)
    .setClass("mod-toggle")
    .addToggle((toggle) =>
      toggle
        .setValue(value)
        .registerOptionListener(section.optionListeners, row.key)
        .onChange((next) => {
          engine.options[row.key] = next;
          logger.debug("Graph row changed", { key: row.key, value: next });
          engine.render();
          engine.onOptionsChange();
        }),
    );
  const restores = new DisposableStack();
  restores.use(
    wrapMember(section, "setDefaultOptions", (native) => {
      return function (this: GraphControlSection) {
        native.call(this);
        section.optionListeners[row.key]?.(row.defaultValue);
      };
    }),
  );
  restores.defer(() => {
    setting.settingEl.remove();
    delete section.optionListeners[row.key];
  });
  logger.debug("Graph row installed", { key: row.key, value });
  return restores;
}

/** The value a row starts at: the live options, else the saved ones, else its default. */
function rowValue(target: ToggleRowTarget, row: ToggleRow): boolean {
  for (const options of [target.engine.options, target.saved]) {
    const value = options?.[row.key];
    if (typeof value === "boolean") return value;
  }
  return row.defaultValue;
}
