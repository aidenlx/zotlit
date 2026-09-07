// shadcn Base UI Input, using the site's control sizes and semantic colors.
// @see https://ui.shadcn.com/docs/components/base/input
import { Input as InputPrimitive } from "@base-ui/react/input";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

export function Input({
  className,
  type,
  size = "default",
  ...props
}: Omit<ComponentProps<"input">, "size"> & {
  /** `xs` is the Workbench's 32 px control row. */
  size?: "xs" | "default";
}) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      data-size={size}
      className={cn(
        "min-h-10 w-full min-w-0 rounded-md border border-fd-border bg-fd-card px-3 py-2 text-base placeholder:text-fd-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring disabled:cursor-default disabled:opacity-50 aria-invalid:border-fd-foreground data-[size=xs]:min-h-8 data-[size=xs]:px-2 data-[size=xs]:py-1 sm:text-sm sm:data-[size=xs]:text-xs",
        className,
      )}
      {...props}
    />
  );
}
