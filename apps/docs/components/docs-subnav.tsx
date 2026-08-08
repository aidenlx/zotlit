"use client";
import { Header } from "fumadocs-ui/layouts/docs/slots/header";
// Docs mobile header (#nd-subnav) carrying the site's double-hairline signature.
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

export function DocsSubnav(props: ComponentProps<"header">) {
  return (
    <Header
      {...props}
      className={cn(
        // Second rule of the double hairline — the header's own border-b is the first.
        "after:absolute after:inset-x-0 after:-bottom-1 after:border-b-[3px] after:border-fd-border after:content-['']",
        props.className,
      )}
    />
  );
}
