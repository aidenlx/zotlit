import { atom } from "jotai";

import { type AnnotationType } from "@zotlit/db";

/**
 * View-model shapes the annotation tree actually reads — a deliberate subset of
 * the `@zotlit/db` query rows ({@link import("@zotlit/db").Annotation} etc.). The
 * eventual Stage 8 wiring maps DB rows → these; keeping the contract narrow lets
 * the mock skip Temporal/position fields the UI never touches.
 */
export interface AnnotItem {
  itemID: number;
  key: string;
  /** Raw Zotero type int; resolve names via `annotationTypeToName`. */
  type: AnnotationType;
  text: string | null;
  comment: string | null;
  /** Hex color, e.g. `"#2ea8e5"`; applied inline as content color. */
  color: string | null;
  pageLabel: string | null;
  /** Parent attachment key — drives the `zotero://open/` backlink. */
  parentKey: string;
}

export interface AtchItem {
  itemID: number;
  key: string;
  path: string | null;
  annotCount: number;
}

export interface DocItem {
  itemID: number;
  title: string;
}

export interface TagItem {
  tagID: number;
  name: string;
}

export type FollowMode = "zt-reader" | "ob-note" | null;

export const docAtom = atom<DocItem | null>(null);
export const allAttachmentsAtom = atom<AtchItem[] | null>(null);
export const attachmentIDAtom = atom<number | null>(null);
export const annotationsAtom = atom<AnnotItem[] | null>(null);
export const tagsAtom = atom<Record<number, TagItem[]>>({});
export const followAtom = atom<FollowMode>("zt-reader");

/** Selected attachment, falling back to the first when none is chosen. */
export const activeAttachmentAtom = atom((get) => {
  const all = get(allAttachmentsAtom);
  if (!all || all.length === 0) return null;
  const id = get(attachmentIDAtom);
  return all.find((a) => a.itemID === id) ?? all[0];
});
