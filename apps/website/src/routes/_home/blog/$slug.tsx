import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import collections from "collections/browser";

import { getMDXComponents } from "@/components/mdx.tsx";
import { pageHead } from "@/lib/seo.ts";
import { appName, blogRoute, formatReleaseDate } from "@/lib/shared.ts";
import { blog } from "@/lib/source.ts";
import {
  blogPostingSchema,
  breadcrumbListSchema,
} from "@/lib/structured-data.ts";

const getPost = createServerFn({ method: "GET" })
  .validator((slug: string) => slug)
  .handler(({ data: slug }) => {
    const page = blog.getPage([slug]);
    if (!page) throw notFound();
    return {
      path: page.path,
      url: page.url,
      slugs: page.slugs,
      title: page.data.title,
      description: page.data.description,
      author: page.data.author,
      date: page.data.date,
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
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-14">
      <p>
        <Link to="/blog" className="text-fd-muted-foreground">
          ← Blog
        </Link>
      </p>
      <article>
        <h1 className="mt-6 mb-2 text-4xl font-medium text-balance">
          {post.title}
        </h1>
        {post.description && (
          <p className="text-lg text-fd-muted-foreground">{post.description}</p>
        )}
        <p className="mt-2 mb-8 font-mono text-xs tracking-widest text-fd-muted-foreground uppercase">
          {formatReleaseDate(post.date)} · by {post.author}
        </p>
        <div className="prose">
          <Body />
        </div>
      </article>
    </main>
  );
}
