// SEO sitemap: every indexable HTML route, enumerated exhaustively off the
// typed AppRoutes union so a new page route can't silently escape it.
import { type AppRoutes } from "@next/routes";
import { type MetadataRoute } from "next";

import { baseURL } from "@/lib/shared";
import { blog, changelog, source } from "@/lib/source";

// AppRoutes is page routes only — machine endpoints (llms*, og, rss, api) are
// AppRouteHandlerRoutes and v1 permalinks are RedirectRoutes, so neither can
// appear here and no exclusion list is needed.
type StaticRoutes = Exclude<AppRoutes, `${string}[${string}]`>;
type DynamicRoutes = Exclude<AppRoutes, StaticRoutes>;
type Entry = Omit<MetadataRoute.Sitemap[number], "url"> & { pathname?: string };

export const revalidate = false;

export default function sitemap(): MetadataRoute.Sitemap {
  // A missing key is a compile error: adding a page route forces a sitemap entry.
  const routes: Record<StaticRoutes, [Entry]> & Record<DynamicRoutes, Entry[]> =
    {
      "/": [{ pathname: "" }],
      "/blog": [{}],
      "/changelog": [{}],
      "/blog/[slug]": blog.getPages().map(
        (page): Entry => ({
          pathname: page.url,
          lastModified: page.data.date,
        }),
      ),
      "/changelog/[version]": changelog.getPages().map(
        (page): Entry => ({
          pathname: page.url,
          lastModified: page.data.date,
        }),
      ),
      "/docs/[[...slug]]": source.getPages().map(
        (page): Entry => ({
          pathname: page.url,
        }),
      ),
    };

  return Object.entries(routes).flatMap(([route, entries]) =>
    (entries as Entry[]).map(({ pathname, ...rest }) => ({
      url: `${baseURL}${pathname ?? route}`,
      ...rest,
    })),
  );
}
