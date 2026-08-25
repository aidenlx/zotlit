import Giscus from "@giscus/react";
import { useTheme } from "fumadocs-ui/provider/base";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn.ts";
import { repoSlug } from "@/lib/shared.ts";

/**
 * Giscus mount, framed only by its own "N reactions / N comments / input"
 * layout — the site adds no heading of its own so nothing duplicates Giscus's
 * live comment-count header.
 *
 * @param term the discussion this page maps to, the page's path without its
 * leading slash, which keeps existing threads attached to their page.
 */
export function Comments({
  term,
  className,
}: {
  term: string;
  className?: string;
}) {
  const { resolvedTheme } = useTheme();
  const [origin, setOrigin] = useState<string>();

  // Giscus builds the theme <link> inside its cross-origin iframe, so the URL
  // must be absolute and internet-reachable. Deriving it from the live origin
  // resolves it on whatever host serves the page — the custom domain, a
  // staging deploy, or localhost. Client-only: `window` is unavailable during
  // SSR, and Giscus only mounts its iframe in the browser anyway.
  useEffect(() => setOrigin(window.location.origin), []);

  if (!origin) return null;

  return (
    <section className={cn("font-sans", className)}>
      <Giscus
        repo={repoSlug}
        // The opaque ids giscus resolved for that repository and category.
        repoId="R_kgDOGy2_uA"
        category="Docs Comments"
        categoryId="DIC_kwDOGy2_uM4DBbqz"
        mapping="specific"
        term={term}
        strict="1"
        reactionsEnabled="1"
        emitMetadata="0"
        inputPosition="top"
        theme={`${origin}/giscus/${resolvedTheme === "dark" ? "dark" : "light"}.css`}
        lang="en"
        loading="lazy"
        host="https://giscus.app"
      />
    </section>
  );
}
