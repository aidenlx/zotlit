import { createMDX } from "fumadocs-mdx/next";

import { buildV1Redirects } from "./lib/v1-redirects.mjs";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  serverExternalPackages: ["@takumi-rs/core"],
  reactStrictMode: true,
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
  // 308 with a `?from=v1&src=` hint back to the exact v1 page. See lib/v1-redirects.mjs.
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
