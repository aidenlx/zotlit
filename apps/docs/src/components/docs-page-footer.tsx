import { usePathname } from "fumadocs-core/framework";
import type { FooterProps } from "fumadocs-ui/layouts/docs/page/slots/footer";

import { Comments } from "@/components/comments";
import { Footer } from "@/layouts/docs/page/slots/footer";

/**
 * The docs page tail: the owned prev/next cards, then the comment thread.
 * The thread is keyed on the page's path without its leading slash, the term
 * the site's existing giscus discussions were mapped by.
 */
export function DocsPageFooter(props: FooterProps) {
  const pathname = usePathname();

  return (
    <Footer {...props}>
      <Comments term={pathname.replace(/^\//, "")} className="mt-6" />
    </Footer>
  );
}
