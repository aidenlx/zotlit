// PROTOTYPE (proto/view-reactivity) — throwaway. Static atoms over the lab's
// service Streams; in production each would sit beside its service, e.g.
// `services/settings/atoms.ts`.
import { Option, Stream } from "effect";
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
  toggleAtTrigger,
} from "./source";
import type { ActiveNote } from "./source";

// --- Service state -------------------------------------------------------

export const activeNoteAtom = held<ActiveNote | null>(activeNote, null);

/** Equal keys stop here, so a rename does not resubscribe below. */
const activeKeyAtom = Atom.map(activeNoteAtom, (note) => note?.key ?? null);

/** Reading the key rebuilds the Stream on a key change, interrupting the old one. */
export const citedByActiveAtom: Atom.Atom<CitedBySnapshot | null> = Atom.map(
  viewRuntime.atom((get) => {
    const key = get(activeKeyAtom);
    return key ? citedBy(key) : Stream.make(EMPTY_SNAPSHOT);
  }),
  (result) => Option.getOrNull(AsyncResult.value(result)),
);

export const atTriggerAtom = held<boolean | null>(atTrigger, null);

// --- Commands: pending and failure come back as an AsyncResult -----------

export const toggleAtTriggerCommand = viewRuntime.fn(() => toggleAtTrigger);
export const readCitedByOnceCommand = viewRuntime.fn((key: string) =>
  readCitedByOnce(key),
);
export const openNoteCommand = viewRuntime.fn((path: string) => openNote(path));
