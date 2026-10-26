// Shared companion reader state for views.
import { Effect, Stream } from "effect";

import { held } from "@/lib/view-atoms";

import { LocalServer } from "./service";
import type { ReaderTarget } from "./service";

export const liveUpdatesAtom = held(
  Stream.unwrap(Effect.map(LocalServer, (server) => server.availableChanges)),
  false,
);
export const readerClosedAtom = held(
  Stream.unwrap(
    Effect.map(LocalServer, (server) => server.readerClosedChanges),
  ),
  false,
);
export const readerTargetAtom = held<ReaderTarget | null>(
  Stream.unwrap(
    Effect.map(LocalServer, (server) => server.readerTargetChanges),
  ),
  null,
);
