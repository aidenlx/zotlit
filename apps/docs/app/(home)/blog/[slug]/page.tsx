import { type Metadata } from "next";
import { notFound } from "next/navigation";

import { BackCrumb } from "@/components/back-crumb";
import Comments from "@/components/comment";
import { JsonLd } from "@/components/json-ld";
import { getMDXComponents } from "@/components/mdx";
import { FooterCards } from "@/layouts/docs/page/slots/footer";
import { cn } from "@/lib/cn";
import { ztProse } from "@/lib/prose";
import { pageMetadata } from "@/lib/seo";
import { appName, formatReleaseDate } from "@/lib/shared";
import { blog, getBlogPages } from "@/lib/source";
import { blogPostingSchema, breadcrumbListSchema } from "@/lib/structured-data";

export const dynamicParams = false;

export default async function BlogPostPage(props: PageProps<"/blog/[slug]">) {
  const params = await props.params;
  const page = blog.getPage([params.slug]);
  if (!page) notFound();

  const { title, description, author, date, body: MDX } = page.data;

  // getBlogPages() is newest-first; previous = older post, next = newer.
  const pages = getBlogPages();
  const index = pages.findIndex((p) => p.url === page.url);
  const older = pages[index + 1];
  const newer = index > 0 ? pages[index - 1] : undefined;

  const crumbs = [
    { name: appName, url: "/" },
    { name: "Blog", url: "/blog" },
    { name: title, url: page.url },
  ];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 font-serif">
      <JsonLd
        schema={blogPostingSchema({
          title,
          description,
          author,
          date,
          url: page.url,
        })}
      />
      <JsonLd schema={breadcrumbListSchema(crumbs)} />
      <article className="pb-14">
        <BackCrumb href="/blog" label="Blog" />
        <header className="pt-4.5 pb-2">
          <h1 className="mb-2.5 text-4xl leading-[1.16] font-medium text-balance">
            {title}
          </h1>
          {description && (
            <p className="mb-2.5 text-lg text-fd-muted-foreground italic">
              {description}
            </p>
          )}
          <p className="mb-1.5 font-mono text-xs font-medium tracking-widest text-fd-muted-foreground uppercase">
            {formatReleaseDate(date)} · by {author}
          </p>
        </header>
        <div className="border-t border-fd-border pt-6">
          <div className={cn("prose max-w-none", ztProse)}>
            <MDX components={getMDXComponents()} />
          </div>
        </div>

        <footer className="font-sans">
          {(older ?? newer) && (
            <FooterCards
              className="mt-10"
              previous={older && { name: older.data.title, url: older.url }}
              next={newer && { name: newer.data.title, url: newer.url }}
            />
          )}
          <Comments className="mt-10" />
        </footer>
      </article>
    </main>
  );
}

export async function generateStaticParams() {
  return blog.generateParams().map((param) => ({
    slug: param.slug[0],
  }));
}

export async function generateMetadata(
  props: PageProps<"/blog/[slug]">,
): Promise<Metadata> {
  const params = await props.params;
  const page = blog.getPage([params.slug]);
  if (!page) notFound();

  return pageMetadata({
    title: page.data.title,
    description: page.data.description,
    path: page.url,
    card: {
      type: "blog",
      ids: page.slugs,
      alt: `${page.data.title} — ZotLit blog`,
    },
    article: {
      publishedTime: page.data.date.toISOString(),
      authors: [page.data.author],
    },
  });
}
