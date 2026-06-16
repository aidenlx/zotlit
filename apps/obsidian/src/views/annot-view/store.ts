import { atom } from "jotai";

import { type AnnotViewAttachment, type AnnotViewItem } from "@zotlit/db";

export const attachmentsAtom = atom<AnnotViewAttachment[] | null>(null);
export const attachmentIDAtom = atom<number | null>(null);
export const annotationsAtom = atom<AnnotViewItem[] | null>(null);

/** Item key extracted from the active literature note's frontmatter. */
export const itemKeyAtom = atom<string | null>(null);

/** Group library ID for the current item; `null` for user library. */
export const groupIDAtom = atom<number | null>(null);

/** Selected attachment, falling back to the first when none is chosen. */
export const activeAttachmentAtom = atom((get) => {
  const all = get(attachmentsAtom);
  if (!all || all.length === 0) return null;
  const id = get(attachmentIDAtom);
  return all.find((a) => a.itemID === id) ?? all[0];
});
