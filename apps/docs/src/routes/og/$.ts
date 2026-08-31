// The OG cards the build never rendered.
//
// Every card a page advertises is emitted into the client output by the
// `machineAssets` plugin, so the asset layer answers it and this route never
// runs. What reaches here is a miss — and a miss on a changelog card is the
// Pre-release Docs case: the version exists, just on the other line.
//
// Server-only, like `/api/search`: the sole `createFileRoute` property is
// `server`, which keeps the route out of the client bundle and the prerender
// pass.

import { createFileRoute } from "@tanstack/react-router";

import { betaFallbackResponse } from "@/lib/beta-fallback";
import { ogImageUrl } from "@/lib/shared";

/** The tail segment every card URL ends with. @see ogImageUrl */
const cardFile = "image.webp";

export const Route = createFileRoute("/og/$")({
  server: {
    handlers: {
      GET: ({ params }) => {
        const segments = (params._splat ?? "").split("/").filter(Boolean);
        const slugs = segments.slice(1, -1);
        const isChangelogEntry =
          segments[0] === "changelog" &&
          segments.at(-1) === cardFile &&
          slugs.length > 0;

        return isChangelogEntry
          ? betaFallbackResponse(ogImageUrl("changelog", slugs))
          : new Response("Not found", { status: 404 });
      },
    },
  },
});
