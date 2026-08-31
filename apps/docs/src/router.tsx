import { createRouter as createTanStackRouter } from "@tanstack/react-router";

import { rewriteMarkdownSuffix } from "./lib/markdown-routes";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    // A `.md` suffix edition resolves to the same handler as its `/llms.mdx`
    // content route. Input only: nothing links to a suffix edition, so the
    // outbound direction stays the identity.
    rewrite: { input: ({ url }) => rewriteMarkdownSuffix(url) },
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
