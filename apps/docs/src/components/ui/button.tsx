// shadcn Base UI Button, using the site's tokens and native focus indicator.
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md border border-transparent text-sm font-medium disabled:cursor-default disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-fd-primary text-fd-primary-foreground",
        outline:
          "border-fd-border bg-fd-card hover:bg-fd-muted aria-expanded:bg-fd-muted",
        ghost: "hover:bg-fd-muted aria-expanded:bg-fd-muted",
      },
      size: {
        default: "min-h-10 px-3 py-2",
        sm: "min-h-9 px-2.5 py-1.5",
        icon: "size-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
