// The install pages' release facts, served as JSON for `useBakedThenFresh`.
//
// A route file whose only `createFileRoute` property is `server` is pruned from
// the client route tree, so this endpoint is server-rendered on every request
// and never becomes a prerendered asset.

import { createFileRoute } from "@tanstack/react-router";

import { getReleaseSnapshot, releaseFactHandlers } from "@/lib/release-data.ts";

export const Route = createFileRoute("/api/release-snapshot")({
  server: { handlers: releaseFactHandlers(getReleaseSnapshot) },
});
