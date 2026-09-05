import { Image } from "@unpic/react/base";
import type { ImageProps } from "fumadocs-core/framework";
import { transform as cloudflareTransform } from "unpic/providers/cloudflare";

const imageBreakpoints = [480, 768, 960, 1280, 1600, 1920];
const passthroughTransform = (src: string | URL) => src.toString();

export function DocsImage({
  src,
  width,
  height,
  priority,
  ...props
}: ImageProps) {
  if (typeof src !== "string") {
    throw new TypeError("Docs images must use a root-relative public URL.");
  }

  const pixelWidth = Number(width);
  const pixelHeight = Number(height);

  if (import.meta.env.DEV) {
    return (
      <Image
        {...props}
        src={src}
        width={pixelWidth}
        height={pixelHeight}
        priority={priority}
        layout="constrained"
        breakpoints={[pixelWidth]}
        transformer={passthroughTransform}
      />
    );
  }

  const optimizedWidth =
    imageBreakpoints.findLast((breakpoint) => breakpoint <= pixelWidth) ??
    pixelWidth;
  const optimizedHeight = Math.round(
    (pixelHeight * optimizedWidth) / pixelWidth,
  );

  return (
    <Image
      {...props}
      src={src}
      width={optimizedWidth}
      height={optimizedHeight}
      priority={priority}
      layout="constrained"
      breakpoints={imageBreakpoints.filter(
        (breakpoint) => breakpoint <= optimizedWidth,
      )}
      transformer={cloudflareTransform}
      background="auto"
      operations={{
        format: "auto",
        fit: "scale-down",
        onerror: "redirect",
      }}
    />
  );
}
