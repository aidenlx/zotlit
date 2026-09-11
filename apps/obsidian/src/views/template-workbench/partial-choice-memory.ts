// The caller and Profile each Shared Partial was last previewed under, held
// per file on this device. The workspace carries the choice back with a leaf
// it restores; this carries it back when the reader closes the partial and
// opens it again, which is the same file and the same choice.
//
// The key is the vault path, so a renamed partial opens on the default caller
// again — ZotLit rewrites nothing on a rename, and a preview choice is not
// worth following one.

import type { App } from "obsidian";

import {
  DEFAULT_PARTIAL_CONTEXT,
  isPartialContext,
} from "@zotlit/workbench/render";
import type { PartialChoice } from "@zotlit/workbench/render";

import { getLogger } from "@/lib/log";

const logger = getLogger(["views", "template-workbench"]);

/** Device-local, so a vault synced between machines carries no preview choice. */
const STORAGE_KEY = "zotlit-partial-choice";

export type PartialChoiceStore = Pick<
  App,
  "loadLocalStorage" | "saveLocalStorage"
>;

/** The choice a partial opens on when this device remembers none for it. */
export const DEFAULT_PARTIAL_CHOICE: PartialChoice = {
  context: DEFAULT_PARTIAL_CONTEXT,
  profile: null,
};

/**
 * What this device last remembered for the Shared Partial at `path`, or
 * {@link DEFAULT_PARTIAL_CHOICE} when it holds none — an unsaved document
 * among them, which has no path to key on.
 */
export function readPartialChoice(
  store: PartialChoiceStore,
  path: string | null,
): PartialChoice {
  if (path === null) return DEFAULT_PARTIAL_CHOICE;
  const held = heldChoices(store)[path];
  if (!held) return DEFAULT_PARTIAL_CHOICE;
  return {
    context: isPartialContext(held.context)
      ? held.context
      : DEFAULT_PARTIAL_CONTEXT,
    profile: typeof held.profile === "string" ? held.profile : null,
  };
}

/**
 * Remember `choice` for the Shared Partial at `path`. A choice that is the
 * default again is forgotten rather than stored, so the store holds only the
 * partials the reader actually moved off Note.
 */
export function writePartialChoice(
  store: PartialChoiceStore,
  path: string | null,
  choice: PartialChoice,
): void {
  if (path === null) return;
  const held = heldChoices(store);
  const isDefault =
    choice.context === DEFAULT_PARTIAL_CHOICE.context &&
    choice.profile === DEFAULT_PARTIAL_CHOICE.profile;
  if (isDefault) {
    if (!(path in held)) return;
    delete held[path];
  } else {
    held[path] = { context: choice.context, profile: choice.profile };
  }
  store.saveLocalStorage(STORAGE_KEY, held);
}

type HeldChoice = { context?: unknown; profile?: unknown };

/** The stored map, as a fresh object a caller may edit; `{}` on anything else. */
function heldChoices(store: PartialChoiceStore): Record<string, HeldChoice> {
  const held: unknown = store.loadLocalStorage(STORAGE_KEY);
  if (held === null || typeof held !== "object" || Array.isArray(held)) {
    if (held !== null)
      logger.debug("Discarded an unreadable partial choice store");
    return {};
  }
  return { ...(held as Record<string, HeldChoice>) };
}
