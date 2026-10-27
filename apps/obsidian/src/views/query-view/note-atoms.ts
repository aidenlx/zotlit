// The Profile-managed keys of one Literature Note, shared by every table cell.
import { Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";

import { Vault } from "@/lib/obsidian-vault";
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

/** Keyed by path: a family hashes an object key by structure, and a TFile links back to itself. */
export const replacedKeysAtom = Atom.family((path: string) =>
  viewRuntime.atom((get) => {
    get(noteRevisionAtom(path));
    get(noteIndexStructureRevisionAtom);
    get(profileRevisionAtom);
    get(templateRevisionAtom);
    return Effect.gen(function* () {
      const file = yield* (yield* Vault).getFileByPath(path);
      if (!file) return new Set<string>() as ReadonlySet<string>;
      return yield* (yield* NoteFeature).replacedKeys(file);
    });
  }),
);
