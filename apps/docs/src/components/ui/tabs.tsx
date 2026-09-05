// shadcn Base UI Tabs. Base UI owns arrow keys, selection, and panel association.
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";

import { cn } from "@/lib/cn";

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "flex flex-wrap gap-1 rounded-md bg-fd-muted p-1",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-sm px-3 py-1.5 text-sm font-medium text-fd-muted-foreground data-active:bg-fd-card data-active:text-fd-foreground data-active:shadow-sm [&_svg]:size-4",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("min-h-0 min-w-0 flex-1", className)}
      {...props}
    />
  );
}
