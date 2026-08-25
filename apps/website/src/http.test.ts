// The HTTP surface of the built Worker, served through workerd.
//
// This is the primary seam for the site: every assertion is something a
// browser, a crawler, or the Obsidian plugin can observe over HTTP. It needs
// `dist/`, so run it through turbo (`turbo run test --filter=@zotlit/website`),
// which builds first.

import { regex } from "arkregex";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_startWorker } from "wrangler";

import { ogImageUrl } from "./lib/shared.ts";
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

describe("seo endpoints", () => {
  it.for(["sitemap.xml", "robots.txt", "changelog/rss.xml"])(
    "prerenders %s into the client output",
    (file) => {
      expect(existsSync(resolve(clientOutput, file))).toBe(true);
    },
  );

  it("lists every page route in the sitemap", async () => {
    const response = await get("/sitemap.xml");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("xml");
    const sitemap = await response.text();
    for (const path of [
      "/",
      "/blog",
      "/changelog",
      "/community",
      "/docs",
      ...getBlogPages().map((page) => page.url),
      ...getChangelogPages().map((page) => page.url),
      ...source.getPages().map((page) => page.url),
    ]) {
      expect(sitemap).toContain(
        `<loc>https://zotlit.aidenlx.site${path === "/" ? "" : path}</loc>`,
      );
    }
  });

  it("disallows the search API and the other machine endpoints in robots", async () => {
    const response = await get("/robots.txt");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    const robots = await response.text();
    for (const path of [
      "/api/",
      "/og/",
      "/llms.txt",
      "/llms-full.txt",
      "/llms.mdx/",
      "/.well-known/agent-skills/",
    ]) {
      expect(robots).toContain(`Disallow: ${path}`);
    }
    expect(robots).toContain(
      "Sitemap: https://zotlit.aidenlx.site/sitemap.xml",
    );
  });

  it("serves the changelog feed with an item per release", async () => {
    const response = await get("/changelog/rss.xml");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/rss+xml",
    );
    const feed = await response.text();
    for (const page of getChangelogPages()) {
      expect(feed).toContain(
        `<link>https://zotlit.aidenlx.site${page.url}</link>`,
      );
    }
  });
});

describe("og images", () => {
  // Every card the pages advertise, by the type and slugs their heads use.
  const cards = [
    ogImageUrl("home"),
    ogImageUrl("community"),
    ogImageUrl("blog"),
    ogImageUrl("changelog"),
    ...source.getPages().map((page) => ogImageUrl("docs", page.slugs)),
    ...getBlogPages().map((page) => ogImageUrl("blog", page.slugs)),
    ...getChangelogPages().map((page) => ogImageUrl("changelog", page.slugs)),
  ];

  it.for(cards)("serves %s as WebP", async (path) => {
    const response = await get(path);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
  });
});

describe("agent skills", () => {
  it("pins every archive to the build's commit and its own digest", async () => {
    const response = await get("/.well-known/agent-skills/index.json");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const { skills } = (await response.json()) as {
      skills: { name: string; url: string; digest: string }[];
    };
    expect(skills.map((skill) => skill.name)).toEqual([
      "zotlit-template",
      "zotlit-pandoc",
      "zotlit-citations",
    ]);

    for (const skill of skills) {
      const archive = await get(new URL(skill.url).pathname);

      expect(archive.status).toBe(200);
      expect(archive.headers.get("content-type")).toContain("application/zip");
      const bytes = new Uint8Array(await archive.arrayBuffer());
      const hash = createHash("sha256").update(bytes).digest("hex");
      expect(skill.digest).toBe(`sha256:${hash}`);
    }
  });
});

describe("structured data", () => {
  const JSON_LD = regex(
    '<script type="application/ld\\+json">(?<schema>.*?)</script>',
    "g",
  );

  /** The JSON-LD blocks a page publishes, in document order. */
  async function jsonLd(path: string) {
    const response = await get(path);

    expect(response.status).toBe(200);
    const html = await response.text();
    const schemas: { "@type": string }[] = [];
    // `exec` carries arkregex's typed capture; `String.matchAll` widens it away.
    for (let match = JSON_LD.exec(html); match; match = JSON_LD.exec(html)) {
      schemas.push(JSON.parse(match.groups.schema) as { "@type": string });
    }
    return schemas;
  }

  it("describes the site on the home page", async () => {
    const types = (await jsonLd("/")).map((schema) => schema["@type"]);

    expect(types).toEqual(["WebSite", "Organization", "SoftwareApplication"]);
  });

  it("describes a blog post and its trail", async () => {
    const post = getBlogPages()[0]!;
    const types = (await jsonLd(post.url)).map((schema) => schema["@type"]);

    expect(types).toEqual(["BlogPosting", "BreadcrumbList"]);
  });

  it("describes a release and its trail", async () => {
    const release = getChangelogPages()[0]!;
    const types = (await jsonLd(release.url)).map((schema) => schema["@type"]);

    expect(types).toEqual(["Article", "BreadcrumbList"]);
  });

  it("describes the trail of a docs page", async () => {
    const types = (await jsonLd("/docs/how-to/insert-citations")).map(
      (schema) => schema["@type"],
    );

    expect(types).toEqual(["BreadcrumbList"]);
  });
});

describe("page head", () => {
  it("points a docs page at its canonical URL and its own card", async () => {
    const response = await get("/docs/how-to/insert-citations");
    const html = await response.text();

    expect(html).toContain(
      '<link rel="canonical" href="https://zotlit.aidenlx.site/docs/how-to/insert-citations"',
    );
    expect(html).toContain(
      'content="https://zotlit.aidenlx.site/og/docs/how-to/insert-citations/image.webp"',
    );
  });

  it("advertises the feed on the changelog", async () => {
    const response = await get("/changelog");
    const html = await response.text();

    expect(html).toContain(
      'href="https://zotlit.aidenlx.site/changelog/rss.xml"',
    );
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
