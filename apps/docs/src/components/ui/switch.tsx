// shadcn Base UI Switch, with a 40 px pointer target and the site's colors.
// @see https://ui.shadcn.com/docs/components/base/switch
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "@/lib/cn";

export function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-fd-muted-foreground/60 after:absolute after:inset-x-0 after:-inset-y-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring data-checked:border-fd-primary data-checked:bg-fd-primary data-disabled:cursor-default data-disabled:opacity-50 data-unchecked:bg-fd-muted",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-5 rounded-full bg-fd-background shadow-sm data-checked:translate-x-5 data-unchecked:translate-x-0.5 rtl:data-checked:-translate-x-5 rtl:data-unchecked:-translate-x-0.5"
      />
    </SwitchPrimitive.Root>
  );
}
