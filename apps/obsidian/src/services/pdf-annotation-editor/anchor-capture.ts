// The Annotation Anchor an open carried, read at the one place it is still
// readable: the leaf. `setViewState` hands the ephemeral state to the leaf, the
// leaf hands it to the view, and Obsidian's PDF view keeps nothing once the
// call returns — so a link click, a programmatic open, a deferred leaf
// replaying its stored state and history all cross this one symbol.
//
// @see apps/obsidian/docs/adr/0046-landing-on-a-mark-is-an-ephemeral-state-contract-read-at-the-leaf.md

import { around } from "monkey-around";
import { WorkspaceLeaf } from "obsidian";

import { ANNOTATION_ANCHOR_KEY, parseAnnotationSubpath } from "@zotlit/db";
import type { ParsedAnnotationSubpath } from "@zotlit/db";

import { disposable } from "@/lib/disposables";
import { getLogger } from "@/lib/log";

import { PDF_VIEW_TYPE } from "./seam";

const logger = getLogger("pdf-annotation-editor");

/**
 * The Anchor each leaf was last opened with, until the view that wanted it
 * drains it. Per leaf rather than per view, because the patch writes it before
 * the binding that reads it exists; the two are never alive at once.
 *
 * A leaf that swaps files needs no sweep here: an Indexed Key names one
 * Annotation of one Attachment, so a binding for the file now on screen answers
 * a leftover Anchor `annotation-unknown` and drops it.
 */
const pending = new WeakMap<WorkspaceLeaf, ParsedAnnotationSubpath>();

/** The Anchor waiting on this leaf, left where it is. */
export function peekPendingAnchor(
  leaf: WorkspaceLeaf,
): ParsedAnnotationSubpath | null {
  return pending.get(leaf) ?? null;
}

/**
 * Forget this leaf's Anchor: it has been honoured, or it names an Annotation
 * this view will never place.
 */
export function dropPendingAnchor(leaf: WorkspaceLeaf): void {
  pending.delete(leaf);
}

export interface AnnotationAnchorCaptureDeps {
  /**
   * An Anchor is waiting on this leaf. Runs after Obsidian's own subpath has
   * been applied, so a view that is already open re-aims from where the page
   * jump left it.
   */
  onAnchor: (leaf: WorkspaceLeaf) => void;
}

/**
 * Patch `WorkspaceLeaf.prototype.setEphemeralState`, the one documented symbol
 * every ephemeral-state delivery path crosses. A later open of the same leaf
 * that names no Annotation clears the Anchor waiting on it, so a plain
 * `#page=N` link stands the previous target down.
 *
 */
export function registerAnnotationAnchorCapture(
  deps: AnnotationAnchorCaptureDeps,
): Disposable {
  const host = WorkspaceLeaf.prototype as unknown as {
    setEphemeralState: (state: unknown) => void;
  };
  return disposable(
    around(host, {
      setEphemeralState: (native) =>
        function (this: WorkspaceLeaf, state: unknown): void {
          const subpath = navigationSubpathOf(state);
          const anchor = subpath === null ? null : anchorOf(this, subpath);
          if (subpath !== null && anchor === null) pending.delete(this);
          if (anchor !== null) pending.set(this, anchor);
          native.call(this, state);
          if (anchor === null) return;
          logger.debug("An open carried an Annotation Anchor", {
            annotationKey: anchor.annotation,
            page: anchor.page,
          });
          deps.onAnchor(this);
        },
    }),
  );
}

/**
 * The subpath one ephemeral state navigates to, and `null` for a state that is
 * no navigation at all.
 *
 * Obsidian sets an ephemeral state for a focus, a scroll and a rename as well
 * as for an open — `focusLeaf` sends `{ focus: true }` every time a leaf takes
 * focus. Only a state carrying a subpath says where the leaf is aimed, so only
 * that one decides the Anchor; a click into the reader leaves it where the open
 * put it.
 */
function navigationSubpathOf(state: unknown): string | null {
  const subpath =
    typeof state === "object" && state !== null
      ? (state as { subpath?: unknown }).subpath
      : undefined;
  return typeof subpath === "string" ? subpath : null;
}

/** The Anchor one subpath carries, for a leaf showing a PDF. */
function anchorOf(
  leaf: WorkspaceLeaf,
  subpath: string,
): ParsedAnnotationSubpath | null {
  if (
    !subpath.includes(ANNOTATION_ANCHOR_KEY) ||
    leaf.getViewState().type !== PDF_VIEW_TYPE
  ) {
    return null;
  }
  const anchor = parseAnnotationSubpath(subpath);
  return anchor.annotation === null ? null : anchor;
}
