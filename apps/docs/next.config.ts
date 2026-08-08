import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

import { buildV1Redirects } from "./lib/v1-redirects";

const withMDX = createMDX();

const config: NextConfig = {
  serverExternalPackages: ["@takumi-rs/core"],
  reactStrictMode: true,
  // Statically-typed routes; app/sitemap.ts keys its route table off the
  // generated `@next/routes` AppRoutes union so a new page can't escape it.
  typedRoutes: true,
  turbopack: {
    rules: {
      "*": {
        condition: { all: [{ path: "*.svg" }, { query: /[?&]svgr(?=&|$)/ }] },
        loaders: ["@svgr/webpack"],
        as: "*.js",
      },
    },
  },
  // Legacy v1 permalinks (formerly served at this domain) → closest v2 page,
  // plus a query hint that components/redirect-notice turns into a callout.
  // See lib/v1-redirects.ts.
  async redirects() {
    return buildV1Redirects();
  },
  // giscus loads the custom comment themes (public/giscus/*.css) into its
  // cross-origin iframe via <link crossorigin="anonymous">, so they must send
  // an Access-Control-Allow-Origin header or the browser blocks the stylesheet.
  async headers() {
    return [
      {
        source: "/giscus/:path*.css",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "https://giscus.app" },
        ],
      },
    ];
  },
};

export default withMDX(config);
