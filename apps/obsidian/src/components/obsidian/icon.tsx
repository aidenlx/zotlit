import {
  type CSSProperties,
  type SVGAttributes,
  useLayoutEffect,
  useRef,
} from "react";
import { getIcon, type IconName } from "obsidian";
import { getLogger } from "@/lib/log";
import { cn } from "@/lib/utils";

const logger = getLogger("ui.icon");

export interface IconProps extends Omit<
  SVGAttributes<SVGSVGElement>,
  "children"
> {
  /** @see https://lucide.dev for the bundled icon catalog. */
  name: IconName;
  /** CSS length, or a number treated as px. */
  size?: number | string;
  strokeWidth?: number | string;
}

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

  const cssVars: CSSProperties & Record<`--${string}`, string | number> = {};
  if (size !== undefined) {
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
      className={cn("svg-icon", name, className)}
      style={{ ...cssVars, ...style }}
    />
  );
}
