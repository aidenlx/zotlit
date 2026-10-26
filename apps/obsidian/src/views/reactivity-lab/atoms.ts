// PROTOTYPE (proto/view-reactivity) — throwaway. Static atoms over the lab's
// service Streams; in production each would sit beside its service, e.g.
// `services/settings/atoms.ts`.
import { Option } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import type { CitedBySnapshot } from "@/services/citation-index/service";

import { held, viewRuntime } from "./edge";
import {
  EMPTY_SNAPSHOT,
  activeNote,
  atTrigger,
  citedBy,
  openNote,
  readCitedByOnce,
  readPreview,
  toggleAtTrigger,
} from "./source";
import type { ActiveNote } from "./source";

// --- Service state -------------------------------------------------------

export const activeNoteAtom = held<ActiveNote | null>(activeNote, null);

/** Equal keys stop here, so a rename does not resubscribe below. */
const activeKeyAtom = Atom.map(activeNoteAtom, (note) => note?.key ?? null);

/** Cited By of one key. An equal key gives the same atom, so leaves share it. */
export const citedByKeyAtom = Atom.family(
  (key: string): Atom.Atom<CitedBySnapshot | null> =>
    Atom.map(viewRuntime.atom(citedBy(key)), (result) =>
      Option.getOrNull(AsyncResult.value(result)),
    ),
);

/**
 * The active note's Cited By, through the family: a following leaf and a leaf
 * pinned to the same key read one node. On a key change the old key's node
 * loses this reader and stops after the idle TTL.
 */
export const citedByActiveAtom: Atom.Atom<CitedBySnapshot | null> = Atom.make(
  (get) => {
    const key = get(activeKeyAtom);
    return key ? get(citedByKeyAtom(key)) : EMPTY_SNAPSHOT;
  },
);

/** One preview read per key: AsyncResult while it runs; stops when unread. */
export const previewAtom = Atom.family((key: string) =>
  viewRuntime.atom(readPreview(key)),
);

// The preview walk mounts these on the registry directly.
Object.assign(globalThis, { __zotlitLabAtoms: { previewAtom } });

/** What a leaf shows: the active note's Cited By, or its pinned key's. */
export const citedByForPin = (pin: string | null) =>
  pin === null ? citedByActiveAtom : citedByKeyAtom(pin);

export const atTriggerAtom = held<boolean | null>(atTrigger, null);

// --- Commands: pending and failure come back as an AsyncResult -----------

export const toggleAtTriggerCommand = viewRuntime.fn(() => toggleAtTrigger);
export const readCitedByOnceCommand = viewRuntime.fn((key: string) =>
  readCitedByOnce(key),
);
export const openNoteCommand = viewRuntime.fn((path: string) => openNote(path));
