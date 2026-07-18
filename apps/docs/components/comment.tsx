"use client";

import Giscus from "@giscus/react";
import { useTheme } from "next-themes";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";

/**
 * Giscus mount, framed only by its own "N reactions / N comments / input"
 * layout — the site adds no heading of its own so nothing duplicates Giscus's
 * live comment-count header.
 */
export default function Comments({ className }: { className?: string }) {
  const pathname = usePathname();
  const { resolvedTheme } = useTheme();
  const [origin, setOrigin] = useState<string>();

  // Giscus builds the theme <link> inside its cross-origin iframe, so the URL
  // must be absolute and internet-reachable. Derive it from the live origin so
  // it resolves on whatever host is serving the page (custom domain, preview
  // deploys), rather than a hardcoded base. Client-only: window is unavailable
  // during SSR, and Giscus only mounts its iframe on the client anyway.
  useEffect(() => setOrigin(window.location.origin), []);

  const themeCssUrl = `${origin}/giscus/${resolvedTheme === "dark" ? "dark" : "light"}.css`;

  return (
    <section className={cn("font-sans", className)}>
      {origin && (
        <Giscus
          repo="aidenlx/zotlit"
          repoId="R_kgDOGy2_uA"
          category="Docs/v2 Comments"
          categoryId="DIC_kwDOGy2_uM4DBbqz"
          mapping="specific"
          // compat with mapping="pathname"
          term={pathname.replace(/^\//, "")}
          strict="1"
          reactionsEnabled="1"
          emitMetadata="0"
          inputPosition="top"
          theme={themeCssUrl}
          lang="en"
          loading="lazy"
          host="https://giscus.app"
        />
      )}
    </section>
  );
}
