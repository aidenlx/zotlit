// A folded section of an entry page, opened by its heading.

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export function Fold({
  heading,
  className,
  children,
}: {
  heading: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details
      className={cn(
        "group/details min-w-0 border-t border-fd-border pt-3",
        className,
      )}
    >
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 font-mono text-xs font-medium tracking-[0.06em] text-fd-muted-foreground uppercase [&::-webkit-details-marker]:hidden">
        <ChevronDown
          aria-hidden
          className="size-3.5 shrink-0 -rotate-90 group-open/details:rotate-0 rtl:rotate-90 rtl:group-open/details:rotate-0"
        />
        {heading}
      </summary>
      <div className="mt-3 flex flex-col gap-3 font-sans">{children}</div>
    </details>
  );
}
