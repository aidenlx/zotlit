import { assertNever } from "@std/assert/unstable-never";
// One OG endpoint for every sitemap page type. The `[type, ...ids, "image.webp"]`
// slug selects the card: home/community/blog/changelog indexes when `ids` is
// empty, else a looked-up docs/blog/changelog entry. Card + fonts live in ../_render.
import { notFound } from "next/navigation";

import { ogImage } from "@/app/og/_render";
import { notFoundOrBetaRedirect } from "@/lib/beta-redirect";
import { baseURL, formatReleaseDate, type OgType, ogTypes } from "@/lib/shared";
import { blog, changelog, source } from "@/lib/source";

export const revalidate = false;

// `assertNever` in the switch below keeps it exhaustive against `ogTypes`
// (defined in lib/shared.ts), so removing or renaming a card without
// updating this list is a compile error.
const isOgType = (type: string): type is OgType =>
  (ogTypes as readonly string[]).includes(type);

export async function GET(
  _req: Request,
  { params }: RouteContext<"/og/[...slug]">,
) {
  const { slug } = await params;
  const type = slug[0];
  const ids = slug.slice(1, -1);

  if (!isOgType(type)) notFound();

  switch (type) {
    case "home":
      return ogImage({
        hero: true,
        kind: "Zotero × Obsidian",
        title: "ZotLit",
        description:
          "Literature notes, citations, and annotations: bridged between Zotero and Obsidian.",
        meta: baseURL,
      });
    case "community":
      return ogImage({
        kind: "Community",
        title: "Join the conversation.",
        description: "Get help, share ideas, and shape where ZotLit goes next.",
        meta: `${baseURL}/community`,
      });
    case "docs": {
      const page = source.getPage(ids);
      if (!page) notFound();
      return ogImage({
        kind: "Documentation",
        title: page.data.title,
        description: page.data.description,
        meta: baseURL,
      });
    }
    case "blog": {
      if (ids.length === 0)
        return ogImage({
          kind: "Blog",
          title: "The ZotLit blog",
          description:
            "Release notes, deep dives, and notes from building ZotLit.",
          meta: `${baseURL}/blog`,
        });
      const page = blog.getPage(ids);
      if (!page) notFound();
      return ogImage({
        kind: "Blog",
        title: page.data.title,
        description: page.data.description,
        meta: `${page.data.author} · ${formatReleaseDate(page.data.date)}`,
      });
    }
    case "changelog": {
      if (ids.length === 0)
        return ogImage({
          kind: "Changelog",
          title: "Changelog",
          description: "Every ZotLit release, newest first.",
          meta: `${baseURL}/changelog`,
        });
      const page = changelog.getPage(ids);
      if (!page)
        notFoundOrBetaRedirect(`/og/changelog/${ids.join("/")}/image.webp`);
      return ogImage({
        kind: "Changelog",
        title: page.data.title ?? `v${page.data.version}`,
        description: page.data.description,
        meta: `v${page.data.version} · ${formatReleaseDate(page.data.date)}`,
      });
    }
    default:
      assertNever(type);
  }
}

export function generateStaticParams() {
  const seg = (type: OgType, slugs: string[] = []) => ({
    slug: [type, ...slugs, "image.webp"],
  });
  return [
    seg("home"),
    seg("community"),
    seg("blog"),
    seg("changelog"),
    ...source.getPages().map((page) => seg("docs", page.slugs)),
    ...blog.getPages().map((page) => seg("blog", page.slugs)),
    ...changelog.getPages().map((page) => seg("changelog", page.slugs)),
  ];
}
