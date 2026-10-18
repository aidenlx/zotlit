import { getIcon } from "obsidian";
import type { IconName } from "obsidian";
import { useLayoutEffect, useMemo, useRef } from "react";
import type { CSSProperties, ReactNode, SVGAttributes } from "react";

import { getLogger } from "@/lib/log";
import { cn } from "@/lib/utils";

const logger = getLogger("ui.icon");

export interface IconProps extends Omit<
  SVGAttributes<SVGSVGElement>,
  "children"
> {
  /** @see https://lucide.dev for the bundled icon catalog. */
  name: IconName;
  /**
   * One of Obsidian's icon sizes, which brings the stroke width Obsidian
   * pairs with it; or a CSS length, or a number treated as px, which keeps
   * the stroke of the context.
   */
  size?: IconSize | number | string;
  strokeWidth?: number | string;
}

/**
 * Obsidian's icon sizes, each `--icon-<size>` with its
 * `--icon-<size>-stroke-width`, so an icon's stroke follows its size as
 * Obsidian's own icons do.
 */
export type IconSize = "xs" | "s" | "m" | "l";

const ICON_SIZES: ReadonlySet<string> = new Set<IconSize>([
  "xs",
  "s",
  "m",
  "l",
]);

/**
 * `getIcon` returns a cloned SVG node; we graft its children and
 * attributes onto a React-managed `<svg>` so the icon stays reactive.
 */
export function Icon({
  name,
  size,
  strokeWidth,
  className,
  style,
  ...rest
}: IconProps) {
  const ref = useRef<SVGSVGElement>(null);
  const ownedAttrs = useRef<Set<string>>(new Set());

  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg) return;

    // Drop any attributes carried over from a previously-rendered icon
    // (custom icons may declare a different attribute set than Lucide).
    for (const attr of ownedAttrs.current) svg.removeAttribute(attr);
    ownedAttrs.current.clear();

    const proto = getIcon(name);
    if (!proto) {
      svg.replaceChildren();
      logger.warn("Unknown icon {name}", { name });
      return;
    }

    svg.replaceChildren(...proto.childNodes);

    // Copy prototype attributes but leave `class` React-owned.
    for (const attr of proto.attributes) {
      if (attr.name === "class") continue;
      svg.setAttribute(attr.name, attr.value);
      ownedAttrs.current.add(attr.name);
    }
  }, [name]);

  /**
   * The class Obsidian itself stamps on the icon — `svg-icon lucide-paperclip`
   * for a Lucide one. Take it verbatim rather than composing `svg-icon` with
   * the bare `name`: an unprefixed name lands in the class list as its own
   * selector, and several collide with Obsidian's global classes
   * (`.external-link` paints a background glyph and adds inline-end padding).
   * A fresh `getIcon` call, because the effect above moves its clone's
   * children out and must keep getting an untouched one.
   */
  const iconClass = useMemo(
    () => getIcon(name)?.getAttribute("class") ?? "svg-icon",
    [name],
  );

  const cssVars: CSSProperties & Record<`--${string}`, string | number> = {};
  if (typeof size === "string" && ICON_SIZES.has(size)) {
    cssVars["--icon-size"] = `var(--icon-${size})`;
    cssVars["--icon-stroke"] = `var(--icon-${size}-stroke-width)`;
  } else if (size !== undefined) {
    cssVars["--icon-size"] = typeof size === "number" ? `${size}px` : size;
  }
  if (strokeWidth !== undefined) {
    cssVars["--icon-stroke"] = strokeWidth;
  }

  const decorative =
    rest["aria-label"] === undefined && rest["aria-labelledby"] === undefined;

  return (
    <svg
      ref={ref}
      {...(decorative ? { "aria-hidden": true } : { role: "img" })}
      {...rest}
      className={cn(iconClass, className)}
      style={{ ...cssVars, ...style }}
    />
  );
}

/**
 * A box one line of its text tall, which centres what it holds on that line:
 * an icon, or an icon button, that leads a block of more than one line sits
 * on the block's first line, wherever the line box puts the text. Give it the
 * class that sets the first line's font size and line height.
 */
export function FirstLine({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "zt:flex zt:h-[1lh] zt:shrink-0 zt:items-center",
        className,
      )}
    >
      {children}
    </span>
  );
}
