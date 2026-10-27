// Shared invalidation of view reads that depend on Literature Note Profiles.
import { Effect, Stream } from "effect";

import { held } from "@/lib/view-atoms";

import { Profile } from "./service";
import type { LiteratureNoteProfile } from "./service";

export const profileRevisionAtom = held(
  Stream.unwrap(
    Effect.map(Profile, (profiles) =>
      profiles.changes.pipe(
        Stream.drop(1),
        Stream.scan(
          () => 0,
          (revision) => revision + 1,
        ),
      ),
    ),
  ),
  0,
);

export const profilesAtom = held(
  Stream.unwrap(
    Effect.map(Profile, (service) =>
      Stream.map(service.changes, (state) => state.profiles),
    ),
  ),
  [] as readonly LiteratureNoteProfile[],
);
