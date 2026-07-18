// ZotLit brand lockup (mark + wordmark); see docs/brand.md for the full spec.
// Marks import as React components via @svgr/webpack and render as inline
// <svg> rather than <img>/CSS background, since Chrome's raster cache can
// pixelate the diagonal on hidpi.
import { cn } from "@/lib/cn";
import Mark16Dark from "@/public/logo/zotlit-mark-16-dark.svg?svgr";
import Mark16Light from "@/public/logo/zotlit-mark-16.svg?svgr";
import MarkDark from "@/public/logo/zotlit-mark-dark.svg?svgr";
import MarkLight from "@/public/logo/zotlit-mark.svg?svgr";

export function LogoMark({
  className,
  small,
}: {
  className?: string;
  small?: boolean;
}) {
  const [Light, Dark] = small
    ? [Mark16Light, Mark16Dark]
    : [MarkLight, MarkDark];
  return (
    <>
      <Light aria-hidden className={cn("dark:hidden", className)} />
      <Dark aria-hidden className={cn("hidden dark:block", className)} />
    </>
  );
}

export function Logo({
  className,
  small,
}: {
  className?: string;
  small?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[0.25em] font-brand leading-none font-semibold tracking-[-0.01em]",
        className,
      )}
    >
      <LogoMark small={small} className={small ? "size-4" : "size-[0.875em]"} />
      <span>
        <span className="text-(--zotlit-ink)">Zot</span>
        <span className="text-(--zotlit-accent)">Lit</span>
      </span>
    </span>
  );
}
