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
        /** The Workbench's 32 px control row. */
        xs: "min-h-8 gap-1.5 px-2 py-1 text-xs [&_svg]:size-3.5",
        /** A 28 px segment inside a 32 px segmented control. */
        "2xs": "min-h-7 gap-1.5 px-2 py-0.5 text-xs [&_svg]:size-3.5",
        icon: "size-10",
        /** Icon-only, on the 32 px control row. */
        "icon-sm": "size-8 [&_svg]:size-3.5",
        /** Icon-only, inside a list row or card. */
        "icon-xs": "size-7 [&_svg]:size-3.5",
        /** Icon-only, inline in a chip or a compact list row. */
        "icon-2xs": "size-6 rounded-sm [&_svg]:size-3.5",
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
