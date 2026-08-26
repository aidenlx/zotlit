// The landing and community pages' live counters, served as JSON for
// `useBakedThenFresh`.
//
// A route file whose only `createFileRoute` property is `server` is pruned from
// the client route tree, so this endpoint is server-rendered on every request
// and never becomes a prerendered asset.

import { createFileRoute } from "@tanstack/react-router";

import { getRepoStats, releaseFactHandlers } from "@/lib/release-data";

export const Route = createFileRoute("/api/repo-stats")({
  server: { handlers: releaseFactHandlers(getRepoStats) },
});
