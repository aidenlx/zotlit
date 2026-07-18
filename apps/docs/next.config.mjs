import { createMDX } from "fumadocs-mdx/next";

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
