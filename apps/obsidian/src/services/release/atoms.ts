// The running release version, shared by view leaves through the plugin registry.
import { Effect } from "effect";

import { viewRuntime } from "@/lib/view-atoms";

import { Release } from "./service";

export const releaseVersionAtom = viewRuntime.atom(
  Release.use((release) => Effect.succeed(release.version)),
);
