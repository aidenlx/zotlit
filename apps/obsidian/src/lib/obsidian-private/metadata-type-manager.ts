// The one place ZotLit reads Obsidian's private property type manager, which
// keeps the type each property is assigned in the Properties panel
// (`.obsidian/types.json`). A build without it assigns no type: a vault
// property then takes the type its values show as, which may differ from the
// one the Properties panel shows.
//
// @see apps/obsidian/docs/adr/0068-query-files-are-a-zotlit-file-type-embedded-through-the-private-embed-registry.md
import type { App } from "obsidian";

import { getLogger } from "@/lib/log";

const logger = getLogger(["obsidian-private", "metadata-type-manager"]);

/** The apps already warned of a missing manager, so each warns once. */
const warned = new WeakSet<App>();

function manager(app: App, members: ("getAssignedWidget" | "on" | "offref")[]) {
  const types = app.metadataTypeManager;
  const missing = types
    ? members.filter((member) => typeof types[member] !== "function")
    : ["metadataTypeManager"];
  if (missing.length === 0) return types!;
  if (!warned.has(app)) {
    warned.add(app);
    logger.warn(
      "Obsidian's property type manager is missing; vault properties take the type of their values",
      { missing },
    );
  }
  return null;
}

/**
 * The id of the property widget assigned to the property `name`, as the
 * Properties panel shows it: `text`, `multitext`, `number`, `checkbox`,
 * `date`, `datetime` and others; `null` where none is assigned or this
 * Obsidian build has no manager to read.
 */
export function assignedWidget(app: App, name: string): string | null {
  const types = manager(app, ["getAssignedWidget"]);
  return types?.getAssignedWidget!(name) ?? null;
}

/**
 * Run `listener` each time the type assigned to a property changes.
 *
 * @returns the callback that stops it; a no-op where this build has no
 *   manager.
 */
export function onTypesChanged(app: App, listener: () => void): () => void {
  const types = manager(app, ["on", "offref"]);
  if (!types) return () => {};
  const ref = types.on!("changed", () => listener());
  return () => types.offref!(ref);
}
