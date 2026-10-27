// Shared invalidation of view reads that depend on Literature Note Profiles.
import { Effect, Stream } from "effect";

import { held } from "@/lib/view-atoms";

import { Profile } from "./service";

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
