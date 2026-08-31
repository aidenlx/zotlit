// ZotLit brand lockup (mark + wordmark); see docs/brand.md for the full spec.
// The mark is inlined as <svg> rather than an <img>/CSS background, since
// Chrome's raster cache can pixelate the diagonal on hidpi. Its two fills read
// the `--zotlit-ink` / `--zotlit-accent` tokens, which already carry the light
// and dark values the two exported SVGs hold — one geometry serves both
// themes. `small` swaps in the 16px optical grid the nav renders at.

import { cn } from "@/lib/cn";

export function LogoMark({
  className,
  small,
}: {
  className?: string;
  small?: boolean;
}) {
  return small ? (
    <svg aria-hidden className={className} viewBox="0 0 16 16">
      <path
        d="M1.69 1 H12 V4 L5.97 12 H15 V15 H1.78 A0.78 0.78 0 0 1 1 14.22 V12.55 A1.65 1.65 0 0 1 1.33 11.56 L7.03 4 H1.21 A0.21 0.21 0 0 1 1 3.79 V1.69 A0.69 0.69 0 0 1 1.69 1 Z"
        fill="var(--zotlit-ink)"
      />
      <path d="M12 1 H15 V12 L13.5 10.5 L12 12 Z" fill="var(--zotlit-accent)" />
    </svg>
  ) : (
    <svg aria-hidden className={className} viewBox="0 0 24 24">
      <path
        d="M4.82 3.5 H17 V7 L9.81 16.5 H20.5 V20 H4.92 A0.92 0.92 0 0 1 4 19.08 V17.14 A1.9 1.9 0 0 1 4.38 15.99 L11.19 7 H4.25 A0.25 0.25 0 0 1 4 6.75 V4.32 A0.82 0.82 0 0 1 4.82 3.5 Z"
        fill="var(--zotlit-ink)"
      />
      <path
        d="M17 3.5 H20.5 V16.5 L18.75 14.75 L17 16.5 Z"
        fill="var(--zotlit-accent)"
      />
    </svg>
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
