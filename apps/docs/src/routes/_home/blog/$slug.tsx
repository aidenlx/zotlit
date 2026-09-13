import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import collections from "collections/browser";

import { BackCrumb } from "@/components/back-crumb";
import { Comments } from "@/components/comments";
import { getMDXComponents } from "@/components/mdx";
import { FooterCards } from "@/layouts/docs/page/slots/footer";
import { cn } from "@/lib/cn";
import { ztProse } from "@/lib/prose";
import { pageHead } from "@/lib/seo";
import { appName, blogRoute, formatReleaseDate } from "@/lib/shared";
import { blog, getBlogPages } from "@/lib/source";
import { blogPostingSchema, breadcrumbListSchema } from "@/lib/structured-data";

const getPost = createServerFn({ method: "GET" })
  .validator((slug: string) => slug)
  .handler(({ data: slug }) => {
    const page = blog.getPage([slug]);
    if (!page) throw notFound();
    // getBlogPages() runs newest-first, so the neighbour after this post in
    // the list is the older one and the neighbour before it is the newer one.
    const pages = getBlogPages();
    const index = pages.findIndex((entry) => entry.url === page.url);
    const neighbour = (entry: (typeof pages)[number] | undefined) =>
      entry && { name: entry.data.title, url: entry.url };

    return {
      path: page.path,
      url: page.url,
      slugs: page.slugs,
      title: page.data.title,
      description: page.data.description,
      author: page.data.author,
      date: page.data.date,
      older: neighbour(pages[index + 1]),
      newer: neighbour(index > 0 ? pages[index - 1] : undefined),
    };
  });

const postBody = collections.blogs.createClientLoader<object>({
  id: "blogs",
  component: ({ default: MDX }) => <MDX components={getMDXComponents()} />,
});

export const Route = createFileRoute("/_home/blog/$slug")({
  component: BlogPost,
  loader: async ({ params }) => {
    const post = await getPost({ data: params.slug });
    await postBody.preload(post.path);
    return post;
  },
  head: ({ loaderData: post }) =>
    post === undefined
      ? {}
      : pageHead({
          title: post.title,
          description: post.description,
          path: post.url,
          card: {
            type: "blog",
            slugs: post.slugs,
            alt: `${post.title} — ZotLit blog`,
          },
          article: { publishedTime: post.date, authors: [post.author] },
          schemas: [
            blogPostingSchema({
              title: post.title,
              description: post.description,
              author: post.author,
              date: post.date,
              url: post.url,
            }),
            breadcrumbListSchema([
              { name: appName, url: "/" },
              { name: "Blog", url: blogRoute },
              { name: post.title, url: post.url },
            ]),
          ],
        }),
});

function BlogPost() {
  const post = Route.useLoaderData();
  const Body = postBody.getComponent(post.path);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 font-serif">
      <article className="pb-14">
        <BackCrumb to="/blog" label="Blog" />
        <header className="pt-4.5 pb-2">
          <h1 className="mb-2.5 text-4xl leading-[1.16] font-medium text-balance">
            {post.title}
          </h1>
          {post.description && (
            <p className="mb-2.5 text-lg text-fd-muted-foreground italic">
              {post.description}
            </p>
          )}
          <p className="mb-1.5 font-mono text-xs font-medium tracking-widest text-fd-muted-foreground uppercase">
            {formatReleaseDate(post.date)} · by {post.author}
          </p>
        </header>
        <div className="border-t border-fd-border pt-6">
          <div className={cn("prose max-w-none", ztProse)}>
            <Body />
          </div>
        </div>

        <footer className="font-sans">
          {(post.older ?? post.newer) && (
            <FooterCards
              className="mt-10"
              previous={post.older}
              next={post.newer}
            />
          )}
          {/* `mapping="specific"` keyed on the path, so a thread stays with its post. */}
          <Comments term={post.url.replace("/", "")} className="mt-10" />
        </footer>
      </article>
    </main>
  );
}
