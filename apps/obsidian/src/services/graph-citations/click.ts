// The node-click wrap: a Cited Work Node runs the Citekey Navigation open action; every other node stays native.

import { Keymap } from "obsidian";

import { getLogger } from "@/lib/log";
import type { NavigationPane } from "@/services/citekey-navigation";

import { wrapMember } from "./install";
import type { GraphLeafMembers } from "./install";

const logger = getLogger("graph-citations");

export interface NodeClickDeps {
  /** The citekey a Cited Work Node id stands for, from the last render; `undefined` for any other node. */
  citekeyOf: (id: string) => string | undefined;
  /** The Citekey Navigation open action. */
  open: (citekey: string, pane: NavigationPane) => void;
}

/**
 * The native click opens the node id as a link text, which creates an empty
 * note for an id no file answers to — so a Cited Work Node never reaches it.
 * The pane follows the same modifier rule the native click uses.
 */
export function wrapNodeClick(
  renderer: GraphLeafMembers["renderer"],
  deps: NodeClickDeps,
): Disposable {
  return wrapMember(renderer, "onNodeClick", (native) => (evt, id, type) => {
    const citekey = deps.citekeyOf(id);
    if (citekey === undefined) return native(evt, id, type);
    const pane = Keymap.isModEvent(evt);
    logger.debug("Cited Work Node clicked", { citekey, pane });
    deps.open(citekey, pane);
  });
}
