import Link from "next/link";

import { SiteFooter } from "@/components/site-footer";
import { formatReleaseDate } from "@/lib/shared";
import { getBlogPages } from "@/lib/source";

export const metadata = {
  title: "Blog",
  description: "Notes from building ZotLit.",
};

export default function BlogListPage() {
  const pages = getBlogPages();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6">
      <header className="pt-14 pb-2">
        <h1 className="mb-2.5 text-4xl font-medium">Blog</h1>
        <p className="mb-6 max-w-[60ch] text-[16.5px] text-fd-muted-foreground italic">
          Notes from building ZotLit — engineering, design, and the occasional
          detour.
        </p>
      </header>

      <div className="pb-14">
        {pages.map((page) => {
          const { title, description, author, date } = page.data;
          return (
            <section
              key={page.url}
              className="grid grid-cols-1 gap-2 border-b border-fd-border/60 py-6 last:border-b-0 md:grid-cols-[190px_1fr] md:gap-6.5"
            >
              <div className="text-left md:text-right">
                <time className="block text-[15px] tracking-[0.1em] text-fd-muted-foreground [font-variant-caps:all-small-caps]">
                  {formatReleaseDate(date)}
                </time>
                <p className="text-[14.5px] text-fd-muted-foreground italic">
                  by {author}
                </p>
              </div>
              <div>
                <h2 className="mb-1 text-xl font-medium">
                  <Link
                    href={page.url as `/blog/${string}`}
                    className="hover:text-fd-primary"
                  >
                    {title}
                  </Link>
                </h2>
                {description && (
                  <p className="text-fd-muted-foreground italic">
                    {description}
                  </p>
                )}
                <p className="mt-2.5">
                  <Link
                    href={page.url as `/blog/${string}`}
                    className="text-[15px] tracking-[0.1em] text-fd-primary [font-variant-caps:all-small-caps] hover:underline"
                  >
                    Read the post →
                  </Link>
                </p>
              </div>
            </section>
          );
        })}
      </div>

      <SiteFooter />
    </main>
  );
}
