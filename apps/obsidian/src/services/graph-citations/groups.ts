// The "Add literature notes group" button beside the graph's native "New group" control, and the one colour group it inserts.

import type {
  GraphColor,
  GraphColorGroupSection,
  GraphEngine,
  GraphOptions,
} from "obsidian";

import { FIELD_ZOTERO_KEY } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";

import { targetOnce, wrapMember } from "./install";
import type { GraphNodeColors } from "./node-color";

const logger = getLogger("graph-citations");

/**
 * The search query the inserted group carries: every note holding the
 * `zotero-key` property, which is what makes a note a Literature Note.
 * `[property]` is Obsidian's own property-existence operator, and the quotes
 * carry the hyphen through it.
 */
export const LITERATURE_NOTES_QUERY = `["${FIELD_ZOTERO_KEY}"]`;

/**
 * Obsidian's own `--color-purple`, which the Literature Note colour falls back
 * to. Reached only where the browser states no colour at all for what the theme
 * says, so that the inserted group always carries a colour: a group with none
 * is a filter rather than a colour group.
 */
export const DEFAULT_COLOR: GraphColor = { a: 1, rgb: 0x7852ee };

/** What `targetOnce` keeps this probe's own report under. */
const PROBE_KEY = "color-groups";

/** The engine member the button writes a group through. */
export interface GroupsEngine {
  setOptions(options: GraphOptions): void;
}

/** The engine members the button reads and writes. */
export interface GroupsTarget {
  engine: GroupsEngine;
  section: GraphColorGroupSection;
}

/**
 * Locates the Groups section and the engine member the button writes through.
 * A build that moved any of them is reported at `warn` once per graph and gets
 * no button, so the panel keeps its native shape.
 *
 * @returns `null` when a member is missing.
 */
export function groupsTarget(engine: GraphEngine): GroupsTarget | null {
  const section = engine.colorGroupOptions;
  return targetOnce(engine, {
    key: PROBE_KEY,
    message: "Graph Groups section is missing a member; no button built",
    present: {
      "engine.setOptions": typeof engine.setOptions === "function",
      "engine.colorGroupOptions": Boolean(section),
      "section.childrenEl": Boolean(section?.childrenEl),
      "section.getColoredQueries":
        typeof section?.getColoredQueries === "function",
      "section.setColorQueries": typeof section?.setColorQueries === "function",
    },
    context: { section: PROBE_KEY },
    build: () => ({ engine: engine as GroupsEngine, section: section! }),
  });
}

/**
 * Inserts the literature notes colour group, unless a group already carries its
 * query. The insertion goes through the engine's set-options path, so the
 * result is an ordinary group the user can recolour, reorder, or delete: the
 * Groups section's own option listener rebuilds the rows, re-runs the search,
 * and saves the graph's options.
 *
 * @param color what the group starts at, which the user is free to change.
 * @returns whether a group was added.
 */
export function addLiteratureNotesGroup(
  target: GroupsTarget,
  color: GraphColor,
): boolean {
  const groups = target.section.getColoredQueries();
  if (groups.some((group) => group.query === LITERATURE_NOTES_QUERY)) {
    logger.debug("Literature notes group already present; none added");
    return false;
  }
  target.engine.setOptions({
    colorGroups: [...groups, { query: LITERATURE_NOTES_QUERY, color }],
  });
  logger.debug("Literature notes group added", { groups: groups.length + 1 });
  return true;
}

/**
 * Builds the "Add literature notes group" button into the Groups section, below
 * the native "New group" control and styled as it is.
 *
 * @param colors read at click time, so the group starts in the colour the graph
 *   draws Literature Notes in under the theme in force.
 * @returns a Disposable that leaves the section as found. Empty when the
 *   section could not be read; the panel then keeps its native shape.
 */
export function installGroupsButton(
  engine: GraphEngine,
  colors: GraphNodeColors,
): Disposable {
  const restores = new DisposableStack();
  const target = groupsTarget(engine);
  if (!target) return restores;
  const { section } = target;
  const container = section.childrenEl.createDiv(
    "graph-color-button-container",
    (el) => {
      el.createEl(
        "button",
        { text: m.graph_citations_add_literature_notes_group() },
        (button) => {
          button.addEventListener("click", () => {
            addLiteratureNotesGroup(
              target,
              colors.current().literatureNote ?? DEFAULT_COLOR,
            );
          });
        },
      );
    },
  );
  // Three paths rebuild the section body from scratch, which takes the button
  // with it: the section's own `colorGroups` option listener, a drag-reorder of
  // the rows, and the panel's "Restore default settings". Placing the button
  // again after each rebuild is what keeps it there; `append` moves the one
  // element rather than building another. The native "New group" and the
  // per-row delete instead mutate the group rows in place, and leave the
  // button's own container standing.
  restores.use(
    wrapMember(
      section,
      "setColorQueries",
      (setColorQueries) =>
        function (this: GraphColorGroupSection, queries) {
          setColorQueries.call(this, queries);
          this.childrenEl.append(container);
        },
    ),
  );
  restores.defer(() => container.remove());
  logger.debug("Graph groups button installed");
  return restores;
}
