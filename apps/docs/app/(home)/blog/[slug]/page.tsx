import { ArrowLeft } from "lucide-react";
import { type Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import Comments from "@/components/comment";
import { getMDXComponents } from "@/components/mdx";
import { FooterCards } from "@/layouts/docs/page/slots/footer";
import { formatReleaseDate, ogImageUrl } from "@/lib/shared";
import { blog, getBlogPages } from "@/lib/source";

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

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6">
      <article className="pb-14">
        <p className="mt-11.5 text-[14.5px]">
          <Link
            href="/blog"
            className="inline-flex items-center gap-1 text-fd-muted-foreground hover:text-fd-primary"
          >
            <ArrowLeft className="size-3.5" /> Blog
          </Link>
        </p>
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
          <div className="zt-prose prose max-w-none">
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

  return {
    title: page.data.title,
    description: page.data.description,
    alternates: { canonical: page.url },
    openGraph: { images: ogImageUrl("blog", ...page.slugs) },
  };
}
