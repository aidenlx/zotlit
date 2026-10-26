// Profile state and note resolutions shared by Template Document views.
import { Effect, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type { TFile } from "obsidian";

import { filterTag } from "@/lib/effect-stream";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
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

/** A note's stamp can change independently of the installed Profiles. */
export const fileProfileAtom = Atom.family((file: TFile) =>
  viewRuntime.atom((get) => {
    get(profileStateAtom);
    return Stream.unwrap(
      Effect.gen(function* () {
        const profiles = yield* Profile;
        const metadata = yield* MetadataCache;
        const changes = Stream.filter(
          filterTag(metadata.changes, "changed"),
          (event) => event.file === file,
        );
        return Stream.concat(
          Stream.fromEffect(profiles.profileOf(file)),
          Stream.mapEffect(changes, () => profiles.profileOf(file)),
        );
      }),
    );
  }),
);

export const fileProfileValueAtom = Atom.family((file: TFile) =>
  Atom.map(fileProfileAtom(file), (result) =>
    AsyncResult.isSuccess(result) ? result.value : null,
  ),
);
