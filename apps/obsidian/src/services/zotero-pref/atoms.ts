// Resolved Zotero paths shared by view reads.
import { Effect, Stream } from "effect";

import { held } from "@/lib/view-atoms";

import { ZoteroPref } from "./service";

export const zoteroDataDirAtom = held(
  Stream.unwrap(
    Effect.map(ZoteroPref, (pref) =>
      Stream.map(pref.changes, (current) => current.dataDir),
    ),
  ),
  "",
);
