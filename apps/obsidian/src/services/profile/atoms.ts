// Profile state and note resolutions shared by Template Document views.
import { Effect, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import { filterTag } from "@/lib/effect-stream";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { Vault } from "@/lib/obsidian-vault";
import { viewRuntime, held } from "@/lib/view-atoms";

import { Profile } from "./service";
import type { ProfileState, LiteratureNoteProfile } from "./service";

export const profileStateAtom = held(
  Stream.unwrap(Effect.map(Profile, (service) => service.changes)),
  null as ProfileState | null,
);
const NO_PROFILES: readonly LiteratureNoteProfile[] = [];
export const profilesAtom = Atom.map(
  profileStateAtom,
  (state) => state?.profiles ?? NO_PROFILES,
);
export const defaultProfilePathAtom = Atom.map(
  profileStateAtom,
  (state) => state?.defaultDocumentPath ?? "",
);

/**
 * A note's stamp can change independently of the installed Profiles. Keyed by
 * path: a family hashes an object key by structure, and a TFile links back to
 * itself.
 */
export const fileProfileAtom = Atom.family((path: string) =>
  viewRuntime.atom((get) => {
    get(profileStateAtom);
    return Stream.unwrap(
      Effect.gen(function* () {
        const profiles = yield* Profile;
        const metadata = yield* MetadataCache;
        const vault = yield* Vault;
        const read = Stream.unwrap(
          Effect.map(vault.getFileByPath(path), (file) =>
            file ? Stream.fromEffect(profiles.profileOf(file)) : Stream.empty,
          ),
        );
        const changes = Stream.filter(
          filterTag(metadata.changes, "changed"),
          (event) => event.file.path === path,
        );
        return Stream.concat(
          read,
          Stream.flatMap(changes, () => read),
        );
      }),
    );
  }),
);

export const fileProfileValueAtom = Atom.family((path: string) =>
  Atom.map(fileProfileAtom(path), (result) =>
    AsyncResult.isSuccess(result) ? result.value : null,
  ),
);
