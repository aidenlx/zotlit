import type { Route } from "next";
import Link from "next/link";

/**
 * The "← Label" back crumb leading a changelog/blog detail head: the
 * mono-uppercase label voice with a text arrow (not a lucide icon).
 *
 * @see DESIGN.md → Changelog / Blog
 */
export function BackCrumb({ href, label }: { href: Route; label: string }) {
  return (
    <p className="mt-11.5">
      <Link
        href={href}
        className="inline-flex items-center gap-1.5 font-mono text-xs font-medium tracking-widest text-fd-muted-foreground uppercase hover:text-fd-primary"
      >
        <span aria-hidden>←</span> {label}
      </Link>
    </p>
  );
}
