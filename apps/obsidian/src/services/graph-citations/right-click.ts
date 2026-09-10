// The node-right-click wrap: a Cited Work Node opens ZotLit's own menu; every other node keeps the native one.

import { Keymap, Menu } from "obsidian";

import { itemSelectUri, parseIndexedKey } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import * as toast from "@/lib/toast";
import type { CitekeyResolution } from "@/services/citation-index/service";

import type { NodeClickDeps } from "./click";
import { wrapMember } from "./install";
import type { GraphLeafMembers } from "./install";

const logger = getLogger("graph-citations");

export interface NodeRightClickDeps extends NodeClickDeps {
  /** What the citekey names in the current Library Scope; `null` while the resolution snapshot is cold. */
  resolveCitekey: (citekey: string) => CitekeyResolution | null;
}

/**
 * The native callback resolves the node id to a file before it builds
 * anything, so a Cited Work Node carries no menu at all today. ZotLit's menu
 * takes that empty place, and every other node keeps the file menu Obsidian
 * builds for it.
 */
export function wrapNodeRightClick(
  renderer: GraphLeafMembers["renderer"],
  deps: NodeRightClickDeps,
): Disposable {
  return wrapMember(
    renderer,
    "onNodeRightClick",
    (native) => (evt, id, type) => {
      const citekey = deps.citekeyOf(id);
      if (citekey === undefined) return native(evt, id, type);
      const resolution = deps.resolveCitekey(citekey);
      logger.debug("Cited Work Node right-clicked", {
        citekey,
        resolution: resolution?.kind ?? "pending",
      });
      citedWorkMenu({
        citekey,
        resolution,
        open: deps.open,
      }).showAtMouseEvent(evt);
    },
  );
}

interface CitedWorkMenuContext extends Pick<NodeClickDeps, "open"> {
  citekey: string;
  /** What the citekey names; `null` while the resolution snapshot is cold. */
  resolution: CitekeyResolution | null;
}

/**
 * The menu carries the actions the citekey can carry out, and only those:
 *
 * - **Create literature note** needs an Item to build the note from. A unique
 *   key names one, and an ambiguous key offers its candidates first and then
 *   names one. A cold snapshot names nothing the menu can read, so the entry
 *   shows and the open action reports what the warm snapshot holds — which may
 *   itself be nothing. A key already known missing names none, so the entry
 *   stays out rather than reporting a failure the click already reports.
 * - **Open in Zotero** selects one Item, so only a unique key says what to
 *   select.
 * - **Copy citation key** hands back the node's own label, whatever the key
 *   resolves to — which is what a mistyped key needs to be fixed.
 *
 * The menu is ZotLit's alone and holds no sections: Obsidian sorts sectioned
 * items ahead of unsectioned ones, so a section here would only reorder the
 * three entries.
 */
function citedWorkMenu(ctx: CitedWorkMenuContext): Menu {
  const menu = new Menu();
  if (ctx.resolution?.kind !== "missing") {
    menu.addItem((item) =>
      item
        .setTitle(m.graph_citations_menu_create_note())
        .setIcon("file-plus")
        .onClick((evt) => ctx.open(ctx.citekey, Keymap.isModEvent(evt))),
    );
  }
  if (ctx.resolution?.kind === "unique") {
    const { key, indexedKey } = ctx.resolution.item;
    // The Indexed Key the snapshot carries is `formatIndexedKey`'s own output,
    // so it parses back; only the group id it encodes is read here.
    const { groupID } = parseIndexedKey(indexedKey)!;
    menu.addItem((item) =>
      item
        .setTitle(m.references_open_in_zotero())
        .setIcon("external-link")
        .onClick(() => {
          window.open(itemSelectUri(key, groupID));
        }),
    );
  }
  menu.addItem((item) =>
    item
      .setTitle(m.graph_citations_menu_copy_citekey())
      .setIcon("copy")
      .onClick(() => void copyCitekey(ctx.citekey)),
  );
  return menu;
}

function copyCitekey(citekey: string): Promise<void> {
  const done = navigator.clipboard.writeText(citekey);
  void toast.promise(done, {
    success: m.graph_citations_citekey_copied(),
    error: m.graph_citations_citekey_copy_failed(),
  });
  return done;
}
