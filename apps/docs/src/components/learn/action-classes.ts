// The lesson's meta size and secondary action, which the recording player's end actions share without loading the lesson's MDX parts.

import { cn } from "@/lib/cn";

/** 15px: secondary text, meta lines, buttons and links beside the step text. */
export const metaClass = "text-[0.9375rem] leading-[1.45]";

/** The secondary action: the raised surface with the shadow ring. */
export const secondaryButtonClass = cn(
  metaClass,
  "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] border border-transparent bg-fd-background px-5 py-2.5 font-semibold text-fd-foreground shadow-ring transition-[box-shadow,scale] duration-150 hover:shadow-ring-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring motion-safe:active:scale-[0.96]",
);
