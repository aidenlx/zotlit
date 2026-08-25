import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import collections from "collections/browser";

import { getMDXComponents } from "@/components/mdx.tsx";
import { formatReleaseDate } from "@/lib/shared.ts";
import { blog } from "@/lib/source.ts";

const getPost = createServerFn({ method: "GET" })
  .validator((slug: string) => slug)
  .handler(({ data: slug }) => {
    const page = blog.getPage([slug]);
    if (!page) throw notFound();
    return {
      path: page.path,
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
