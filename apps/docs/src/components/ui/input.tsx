// shadcn Base UI Input, using the site's control sizes and semantic colors.
// @see https://ui.shadcn.com/docs/components/base/input
import { Input as InputPrimitive } from "@base-ui/react/input";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

export function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "min-h-10 w-full min-w-0 rounded-md border border-fd-border bg-fd-card px-3 py-2 text-base placeholder:text-fd-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring disabled:cursor-default disabled:opacity-50 aria-invalid:border-fd-foreground sm:text-sm",
        className,
      )}
      {...props}
    />
  );
}
