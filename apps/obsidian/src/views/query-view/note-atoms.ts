// The Profile-managed keys of one Literature Note, shared by every table cell.
import { Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";
import type { TFile } from "obsidian";

import { viewRuntime } from "@/lib/view-atoms";
import { NoteFeature } from "@/services/note-feature/service";
import {
  noteIndexSnapshotAtom,
  noteIndexStructureRevisionAtom,
} from "@/services/note-index/atoms";
import { profileRevisionAtom } from "@/services/profile/atoms";
import { templateRevisionAtom } from "@/services/template/atoms";

const noteRevisionAtom = Atom.family((path: string) =>
  Atom.map(noteIndexSnapshotAtom, (snapshot) => snapshot.paths[path] ?? 0),
);

export const replacedKeysAtom = Atom.family((file: TFile) =>
  viewRuntime.atom((get) => {
    get(noteRevisionAtom(file.path));
    get(noteIndexStructureRevisionAtom);
    get(profileRevisionAtom);
    get(templateRevisionAtom);
    return Effect.flatMap(NoteFeature, (feature) => feature.replacedKeys(file));
  }),
);
