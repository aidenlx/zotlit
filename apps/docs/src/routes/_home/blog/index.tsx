import { Link, createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { SiteFooter } from "@/components/site-footer";
import { pageHead } from "@/lib/seo";
import { appName, blogRoute, formatReleaseDate } from "@/lib/shared";
import { getBlogPages } from "@/lib/source";
import { breadcrumbListSchema } from "@/lib/structured-data";

const listPosts = createServerFn({ method: "GET" }).handler(() =>
  getBlogPages().map((page) => ({
    slug: page.slugs[0] ?? "",
    title: page.data.title,
    description: page.data.description,
    author: page.data.author,
    date: page.data.date,
  })),
);

const crumbs = [
  { name: appName, url: "/" },
  { name: "Blog", url: blogRoute },
];

export const Route = createFileRoute("/_home/blog/")({
  component: BlogIndex,
  loader: () => listPosts(),
  head: () =>
    pageHead({
      title: "Blog",
      description: "Notes from building ZotLit.",
      path: blogRoute,
      card: { type: "blog", alt: "ZotLit Blog" },
      schemas: [breadcrumbListSchema(crumbs)],
    }),
});

function BlogIndex() {
  const posts = Route.useLoaderData();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 font-serif">
      <header className="pt-14 pb-2">
        <h1 className="mb-2.5 text-4xl font-medium">Blog</h1>
        <p className="mb-6 max-w-[60ch] text-[16.5px] text-fd-muted-foreground italic">
          Notes from building ZotLit — engineering, design, and the occasional
          detour.
        </p>
      </header>

      <div className="pb-14">
        {posts.map((post) => (
          <section
            key={post.slug}
            className="grid grid-cols-1 gap-2 border-b border-fd-border/60 py-6 last:border-b-0 md:grid-cols-[190px_1fr] md:gap-6.5"
          >
            <div className="text-left md:text-right">
              <time className="block font-mono text-xs font-medium tracking-widest text-fd-muted-foreground uppercase">
                {formatReleaseDate(post.date)}
              </time>
              <p className="text-[14.5px] text-fd-muted-foreground italic">
                by {post.author}
              </p>
            </div>
            <div>
              <h2 className="mb-1 text-xl font-medium">
                <Link
                  to="/blog/$slug"
                  params={{ slug: post.slug }}
                  className="hover:text-fd-primary"
                >
                  {post.title}
                </Link>
              </h2>
              {post.description && (
                <p className="text-fd-muted-foreground italic">
                  {post.description}
                </p>
              )}
              <p className="mt-2.5">
                <Link
                  to="/blog/$slug"
                  params={{ slug: post.slug }}
                  className="font-mono text-xs font-semibold tracking-[0.12em] text-fd-primary uppercase hover:underline"
                >
                  Read the post →
                </Link>
              </p>
            </div>
          </section>
        ))}
      </div>

      <SiteFooter />
    </main>
  );
}
