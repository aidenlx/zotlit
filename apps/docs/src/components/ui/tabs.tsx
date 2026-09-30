// shadcn Base UI Tabs. Base UI owns arrow keys, selection, and panel association.
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";

import { cn } from "@/lib/cn";

export const Tabs = TabsPrimitive.Root;

/** The square muted track that holds the tabs, or the buttons of a segmented toggle. */
export const segmentedTrack = "flex flex-wrap gap-1 bg-fd-muted p-1";

/** One 32 px segment of the track, in ink when it is the active tab or the pressed button. */
export const segment =
  "flex min-h-8 cursor-pointer items-center justify-center gap-2 px-3 py-1 text-sm font-medium text-fd-muted-foreground data-active:bg-fd-foreground data-active:text-fd-background aria-pressed:bg-fd-foreground aria-pressed:text-fd-background [&_svg]:size-4";

export function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(segmentedTrack, className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(segment, className)}
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
