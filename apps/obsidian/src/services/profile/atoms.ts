// The Profile choices shared by Template Document previews.
import { Effect, Stream } from "effect";

import { held } from "@/lib/view-atoms";

import { Profile } from "./service";
import type { LiteratureNoteProfile } from "./service";

export const profilesAtom = held(
  Stream.unwrap(
    Effect.map(Profile, (service) =>
      Stream.map(service.changes, (state) => state.profiles),
    ),
  ),
  [] as readonly LiteratureNoteProfile[],
);
