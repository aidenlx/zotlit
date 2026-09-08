// shadcn Base UI Input, using the site's control sizes and semantic colors.
// @see https://ui.shadcn.com/docs/components/base/input
import { Input as InputPrimitive } from "@base-ui/react/input";
import { cva } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

export const inputVariants = cva(
  "w-full min-w-0 rounded-md border border-fd-border bg-fd-card text-base placeholder:text-fd-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring disabled:cursor-default disabled:opacity-50 aria-invalid:border-fd-foreground",
  {
    variants: {
      size: {
        default: "min-h-10 px-3 py-2 sm:text-sm",
        xs: "min-h-8 px-2 py-1 sm:text-xs",
      },
    },
    defaultVariants: { size: "default" },
  },
);

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
      className={cn(inputVariants({ size }), className)}
      {...props}
    />
  );
}
