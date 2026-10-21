// The Annotation Anchor an open carried, read at the one place it is still
// readable: the leaf. `setViewState` hands the ephemeral state to the leaf, the
// leaf hands it to the view, and Obsidian's PDF view keeps nothing once the
// call returns — so a link click, a programmatic open, a deferred leaf
// replaying its stored state and history all cross `setEphemeralState`. Every
// one of them that opens a view passes its ephemeral state to `setViewState`
// first, where the Anchor is held before the view is bound.
//
// @see apps/obsidian/docs/adr/0046-landing-on-a-mark-is-an-ephemeral-state-contract-read-at-the-leaf.md

import { around } from "monkey-around";
import { WorkspaceLeaf } from "obsidian";

import {
  ANNOTATION_ANCHOR_KEY,
  ATTACHMENT_ANCHOR_KEY,
  parseAnnotationSubpath,
} from "@zotlit/db";
import type { ParsedAnnotationSubpath } from "@zotlit/db";

import { disposable } from "@/lib/disposables";
import { getLogger } from "@/lib/log";

import { PDF_VIEW_TYPE } from "./seam";

const logger = getLogger("pdf-annotation-editor");

/**
 * The Anchor each leaf was last opened with, until the view that wanted it
 * drains it. Per leaf rather than per view, because the patch writes it as
 * `setViewState` starts, before the view it opens loads its file and is bound.
 *
 * The Anchor carries the Attachment the open named, when it named one, beside
 * the Annotation: two Attachments can keep one file, and the binding names
 * its Attachment from it.
 *
 * A leaf that swaps files needs no sweep here: an Indexed Key names one
 * Annotation of one Attachment, so a binding for the file now on screen answers
 * a leftover Anchor `annotation-unknown` and drops it, and the resolver takes a
 * leftover Attachment only for the file that Attachment keeps.
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
 * `setViewState` is patched too, to hold the Anchor before the view loads:
 * Obsidian turns the leaf active, and fires `file-open`, before it hands the
 * leaf its ephemeral state, so a cold PDF view is bound first. Held early, the
 * Attachment the open named is the one that view binds, rather than the one
 * its path chooses.
 */
export function registerAnnotationAnchorCapture(
  deps: AnnotationAnchorCaptureDeps,
): Disposable {
  const host = WorkspaceLeaf.prototype as unknown as {
    setViewState: (viewState: unknown, eState?: unknown) => Promise<void>;
    setEphemeralState: (state: unknown) => void;
  };
  return disposable(
    around(host, {
      setViewState: (native) =>
        function (
          this: WorkspaceLeaf,
          viewState: unknown,
          eState?: unknown,
        ): Promise<void> {
          hold(this, viewTypeOf(viewState), eState);
          return native.call(this, viewState, eState);
        },
      setEphemeralState: (native) =>
        function (this: WorkspaceLeaf, state: unknown): void {
          const anchor = hold(this, this.getViewState().type, state);
          native.call(this, state);
          if (anchor === null) return;
          logger.debug("An open carried an Annotation Anchor", {
            annotationKey: anchor.annotation,
            attachmentKey: anchor.attachment,
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

/**
 * Hold the Anchor one ephemeral state carries for `leaf`, which shows a view
 * of `viewType`, and answer it. A navigation that carries none clears the one
 * waiting; a state that is no navigation leaves it.
 */
function hold(
  leaf: WorkspaceLeaf,
  viewType: unknown,
  state: unknown,
): ParsedAnnotationSubpath | null {
  const subpath = navigationSubpathOf(state);
  if (subpath === null) return null;
  const anchor = anchorOf(viewType, subpath);
  if (anchor === null) pending.delete(leaf);
  else pending.set(leaf, anchor);
  return anchor;
}

/** The view type a `setViewState` call opens. */
function viewTypeOf(viewState: unknown): unknown {
  return typeof viewState === "object" && viewState !== null
    ? (viewState as { type?: unknown }).type
    : undefined;
}

/**
 * The Anchor one subpath carries, for a view showing a PDF: an Annotation to
 * land on, the Attachment the open named, or both.
 */
function anchorOf(
  viewType: unknown,
  subpath: string,
): ParsedAnnotationSubpath | null {
  if (
    !(
      subpath.includes(ANNOTATION_ANCHOR_KEY) ||
      subpath.includes(ATTACHMENT_ANCHOR_KEY)
    ) ||
    viewType !== PDF_VIEW_TYPE
  ) {
    return null;
  }
  const anchor = parseAnnotationSubpath(subpath);
  return anchor.annotation === null && anchor.attachment === null
    ? null
    : anchor;
}
