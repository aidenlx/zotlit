// The sitemap's URL table, keyed off the generated route tree.
//
// `FileRouteTypes["to"]` is every route this app serves. Subtracting the
// machine endpoints below leaves the page routes, and the table is a
// `Record` over exactly those: adding a page route leaves a key missing and
// fails the typecheck until the route is placed here, so a new page cannot
// silently escape the sitemap. A new machine endpoint fails the `satisfies`
// below instead, which is the same decision made explicitly.

import type { FileRouteTypes } from "@/routeTree.gen";

import type { SiteLocale } from "./i18n";
import { getPageLocaleState } from "./locale-state";
import { baseURL } from "./shared";
import { blog, changelog, source } from "./source";

/** Routes that answer machines rather than readers, so no crawler indexes them. */
const machineRoutes = [
  "/api/search",
  "/api/repo-stats",
  "/api/release-snapshot",
  "/llms.txt",
  "/llms-full.txt",
  "/llms.mdx/$",
  "/og/$",
  "/robots.txt",
  "/sitemap.xml",
  "/changelog/rss.xml",
] as const satisfies readonly FileRouteTypes["to"][];

type PageRoute = Exclude<FileRouteTypes["to"], (typeof machineRoutes)[number]>;

interface Entry {
  /** The URL path this entry publishes. @default the route's own path */
  pathname?: string;
  /** Each edition's publication or last-commit day in ISO form, for the pages that carry one. */
  lastModified?: Partial<Record<SiteLocale, string>>;
}

export const xmlHeaders = {
  "content-type": "application/xml; charset=utf-8",
};

function renderUrl(loc: string, lastModified?: string): string {
  const lastmod = lastModified ? `<lastmod>${lastModified}</lastmod>` : "";
  return `<url><loc>${loc.replaceAll("&", "&amp;")}</loc>${lastmod}</url>`;
}

/**
 * The collections are `async`, so a page's git date rides with its compiled
 * body rather than the frontmatter head; the body is already compiled for the
 * Markdown editions, so this costs the sitemap no extra MDX work.
 */
async function lastCommitDay(page: {
  data: { load(): Promise<{ lastModified?: Date }> };
}): Promise<string | undefined> {
  const { lastModified } = await page.data.load();
  return lastModified?.toISOString().slice(0, 10);
}

/** The page's Chinese edition, when a Chinese file exists rather than an English fallback. */
function nativeChinese<P extends { path: string; slugs: string[] }>(
  collection: { getPage(slugs: string[], locale: SiteLocale): P | undefined },
  page: P,
): P | undefined {
  const chinese = collection.getPage(page.slugs, "zh-CN");
  return chinese && chinese.path !== page.path ? chinese : undefined;
}

async function docsEntries(): Promise<Entry[]> {
  const pages = source.getPages("en").filter((page) => page.slugs.length > 0);
  return Promise.all(
    pages.map(async (page) => {
      const chinese = nativeChinese(source, page);
      return {
        pathname: page.url,
        lastModified: {
          en: await lastCommitDay(page),
          "zh-CN": chinese && (await lastCommitDay(chinese)),
        },
      };
    }),
  );
}

/** A post's last commit day, or its publication day when git knows no later one. */
async function blogEntries(): Promise<Entry[]> {
  return Promise.all(
    blog.getPages("en").map(async (page) => {
      const chinese = nativeChinese(blog, page);
      return {
        pathname: page.url,
        lastModified: {
          en: (await lastCommitDay(page)) ?? page.data.date,
          "zh-CN":
            chinese && ((await lastCommitDay(chinese)) ?? chinese.data.date),
        },
      };
    }),
  );
}

export async function renderSitemap(): Promise<string> {
  // A missing key is a compile error: adding a page route forces a sitemap entry.
  const routes: Record<PageRoute, Entry[]> = {
    "/": [{ pathname: "" }],
    "/blog": [{}],
    "/changelog": [{}],
    "/community": [{}],
    "/docs": [{}],
    "/workbench": [],
    "/blog/$slug": await blogEntries(),
    "/changelog/$version": changelog.getPages("en").map((page) => ({
      pathname: page.url,
      lastModified: { en: page.data.date, "zh-CN": page.data.date },
    })),
    // The `/docs` index is a page of the collection too, and lists itself with
    // an empty slug set, so the route above carries no entry of its own.
    "/docs/$": await docsEntries(),
  };

  const urls = Object.entries(routes).flatMap(([route, entries]) =>
    entries.flatMap(({ pathname, lastModified }) => {
      const path = pathname || route;
      const state = getPageLocaleState(path, "en");
      return state.alternates.flatMap(({ locale, path: href }) =>
        locale === "x-default"
          ? []
          : [
              renderUrl(
                `${baseURL}${href === "/" ? "" : href}`,
                lastModified?.[locale],
              ),
            ],
      );
    }),
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;
}
