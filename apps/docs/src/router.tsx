import { createRouter as createTanStackRouter } from "@tanstack/react-router";

import { rewriteMarkdownSuffix } from "./lib/markdown-routes";
import { deLocalizeUrl, localizeUrl } from "./paraglide/runtime.js";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    // Locale URLs keep the typed route tree. Resolve the locale before Markdown
    // suffixes, and localize outgoing links for the current reader.
    rewrite: {
      input: ({ url }) => rewriteMarkdownSuffix(deLocalizeUrl(url)),
      output: ({ url }) => localizeUrl(url),
    },
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
