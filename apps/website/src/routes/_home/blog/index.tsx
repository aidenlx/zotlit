import { Link, createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { pageHead } from "@/lib/seo.ts";
import { appName, blogRoute, formatReleaseDate } from "@/lib/shared.ts";
import { getBlogPages } from "@/lib/source.ts";
import { breadcrumbListSchema } from "@/lib/structured-data.ts";

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
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-14">
      <h1 className="mb-2 text-4xl font-medium">Blog</h1>
      <p className="mb-10 max-w-[60ch] text-fd-muted-foreground">
        Notes from building ZotLit — engineering, design, and the occasional
        detour.
      </p>

      {posts.map((post) => (
        <section
          key={post.slug}
          className="border-t border-fd-border py-6 last:border-b"
        >
          <time className="font-mono text-xs tracking-widest text-fd-muted-foreground uppercase">
            {formatReleaseDate(post.date)} · by {post.author}
          </time>
          <h2 className="mt-1 text-xl font-medium">
            <Link to="/blog/$slug" params={{ slug: post.slug }}>
              {post.title}
            </Link>
          </h2>
          {post.description && (
            <p className="max-w-[60ch] text-fd-muted-foreground">
              {post.description}
            </p>
          )}
        </section>
      ))}
    </main>
  );
}
