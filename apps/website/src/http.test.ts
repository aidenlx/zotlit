// The HTTP surface of the built Worker, served through workerd.
//
// This is the primary seam for the site: every assertion is something a
// browser, a crawler, or the Obsidian plugin can observe over HTTP. It needs
// `dist/`, so run it through turbo (`turbo run test --filter=@zotlit/website`),
// which builds first.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_startWorker } from "wrangler";

import { getBlogPages, getChangelogPages, source } from "./lib/source.ts";
import { buildV1Redirects } from "./lib/v1-redirects.ts";

const config = resolve(import.meta.dirname, "../dist/server/wrangler.json");
/** What the Cloudflare asset layer serves, before the Worker ever runs. */
const clientOutput = resolve(import.meta.dirname, "../dist/client");

let worker: Awaited<ReturnType<typeof unstable_startWorker>>;

/** `redirect: "manual"` so a redirect answers instead of being followed. */
function get(path: string) {
  return worker.fetch(`http://localhost${path}`, { redirect: "manual" });
}

beforeAll(async () => {
  if (!existsSync(config)) {
    throw new Error(`No build to serve at ${config}; run \`vite build\` first`);
  }
  worker = await unstable_startWorker({ config });
}, 120_000);

afterAll(async () => {
  await worker?.dispose();
});

describe("page routes", () => {
  const pages = [
    "/",
    "/community",
    "/blog",
    ...getBlogPages().map((page) => page.url),
    "/changelog",
    ...getChangelogPages().map((page) => page.url),
    ...source.getPages().map((page) => page.url),
  ];

  it.for(pages)("renders %s", async (path) => {
    const response = await get(path);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("answers an unknown path with 404", async () => {
    const response = await get("/no-such-page");

    expect(response.status).toBe(404);
  });
});

describe("legacy redirects", () => {
  it.for(buildV1Redirects())(
    "sends $source to $destination",
    async ({ source: from, destination, status }) => {
      // The catch-all is a pattern, not a path; exercise it below instead.
      if (from.includes("*")) return;
      const response = await get(from);

      expect(response.status).toBe(status);
      expect(response.headers.get("location")).toBe(destination);
    },
  );

  it("strips /zh-CN from a route with no entry of its own", async () => {
    const response = await get("/zh-CN/community");

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/community?lang=zh-CN");
  });
});

describe("markdown editions", () => {
  // Every page that publishes an edition, by the URL of the page itself. The
  // list comes from the loaders, so a page the prerender scan misses fails here.
  const pages = [
    ...source.getPages().map((page) => page.url),
    "/changelog",
    ...getChangelogPages().map((page) => page.url),
    "/blog",
    ...getBlogPages().map((page) => page.url),
  ];

  /** Both URLs one page's edition answers at. */
  const editions = pages.flatMap((page) => [
    `${page}.md`,
    `/llms.mdx${page}/content.md`,
  ]);

  async function body(path: string, type: string) {
    const response = await get(path);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(type);
    return response.text();
  }

  /** A `.md` edition; the asset layer types it from the file extension. */
  const markdown = (path: string) => body(path, "text/markdown");
  /** An llms index; `.txt` carries plain text, as on the Next.js site. */
  const index = (path: string) => body(path, "text/plain");

  it.for(editions)("serves %s as Markdown", async (path) => {
    expect(await markdown(path)).not.toBe("");
  });

  it.for([...editions, "/llms.txt", "/llms-full.txt"])(
    "prerenders %s into the client output",
    (path) => {
      // A file in the client output is served by the asset layer, so none of
      // these routes costs a Worker invocation.
      expect(existsSync(resolve(clientOutput, path.slice(1)))).toBe(true);
    },
  );

  it("renders a ContractTable page as a GFM table", async () => {
    const edition = await markdown("/docs/reference/templates/data.md");

    expect(edition).toContain("| Property | Type | Description |");
    expect(edition).not.toContain("<ContractTable");
  });

  it("indexes the docs in llms.txt", async () => {
    const listing = await index("/llms.txt");

    for (const page of source.getPages()) {
      expect(listing).toContain(`(${page.url})`);
    }
  });

  it("concatenates every docs page into llms-full.txt", async () => {
    const full = await index("/llms-full.txt");

    for (const page of source.getPages()) {
      expect(full).toContain(`# ${page.data.title} (${page.url})`);
    }
  });

  it("answers an unknown edition with 404", async () => {
    const response = await get("/docs/no-such-page.md");

    expect(response.status).toBe(404);
  });
});

describe("search", () => {
  /** The endpoint answers with fumadocs' sorted-result list. */
  async function search(query: string) {
    const response = await get(
      `/api/search?query=${encodeURIComponent(query)}`,
    );

    expect(response.status).toBe(200);
    return (await response.json()) as { url: string }[];
  }

  it("finds docs pages for a term the docs use", async () => {
    const results = await search("annotation");

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) expect(result.url).toMatch(/^\/docs\//);
  });

  it("leaves the changelog out of the index", async () => {
    // "AGPL" appears in the changelog and nowhere in the docs content.
    const results = await search("AGPL");

    expect(results).toEqual([]);
  });
});

describe("asset headers", () => {
  it("serves the giscus theme with its CORS header", async () => {
    const response = await get("/giscus/light.css");

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://giscus.app",
    );
  });
});
