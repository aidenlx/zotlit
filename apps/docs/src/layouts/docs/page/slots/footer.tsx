// Owned docs-page footer slot: prev/next cards in the editorial grammar — a
// muted direction label over the title, no chevrons or description line.
// Vendored from @fumadocs/base-ui `layouts/docs/page/slots/footer`; the blog
// post tail renders the same cards via <FooterCards>. Re-diff on bumps.

import { usePathname } from "fumadocs-core/framework";
import Link from "fumadocs-core/link";
import type * as PageTree from "fumadocs-core/page-tree";
import { useFooterItems } from "fumadocs-ui/utils/use-footer-items";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useMemo } from "react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

type Item = Pick<PageTree.Item, "name" | "url">;

export interface FooterProps extends ComponentProps<"div"> {
  /**
   * Items including information for the next and previous page
   */
  items?: {
    previous?: Item;
    next?: Item;
  };
}

/** Tree-driven footer for `/docs` (needs the docs layout's tree context). */
export function Footer({ items, ...props }: FooterProps) {
  const footerList = useFooterItems();
  const pathname = usePathname();
  const { previous, next } = useMemo(() => {
    if (items) return items;

    const idx = footerList.findIndex((item) => isActive(item.url, pathname));

    if (idx === -1) return {};
    return {
      previous: footerList[idx - 1],
      next: footerList[idx + 1],
    };
  }, [footerList, items, pathname]);

  return <FooterCards previous={previous} next={next} {...props} />;
}

/** Presentational prev/next grid, usable outside the docs layout (blog). */
export function FooterCards({
  previous,
  next,
  children,
  className,
  ...props
}: ComponentProps<"div"> & { previous?: Item; next?: Item }) {
  return (
    <>
      <div
        className={cn(
          "@container grid gap-4",
          previous && next ? "grid-cols-2" : "grid-cols-1",
          className,
        )}
        {...props}
      >
        {previous && <FooterCard item={previous} direction="previous" />}
        {next && <FooterCard item={next} direction="next" />}
      </div>
      {children}
    </>
  );
}

function FooterCard({
  item,
  direction,
}: {
  item: Item;
  direction: "previous" | "next";
}) {
  const next = direction === "next";

  return (
    <Link
      href={item.url}
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border p-4 text-sm transition-colors hover:bg-fd-accent/80 hover:text-fd-accent-foreground @max-lg:col-span-full",
        next && "text-end",
      )}
    >
      <p
        className={cn(
          "flex items-center gap-1 text-xs text-fd-muted-foreground",
          next && "justify-end",
        )}
      >
        {next ? (
          <>
            Next <ArrowRight className="size-3" />
          </>
        ) : (
          <>
            <ArrowLeft className="size-3" /> Previous
          </>
        )}
      </p>
      <p className="font-medium">{item.name}</p>
    </Link>
  );
}

function isActive(href: string, pathname: string): boolean {
  return normalize(href) === normalize(pathname);
}

function normalize(urlOrPath: string) {
  if (urlOrPath.length > 1 && urlOrPath.endsWith("/"))
    return urlOrPath.slice(0, -1);
  return urlOrPath;
}
