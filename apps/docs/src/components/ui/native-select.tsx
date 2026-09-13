// shadcn Native Select, with the site's control sizes and semantic colors.
// @see https://ui.shadcn.com/docs/components/base/native-select
import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

export function NativeSelect({
  className,
  size = "default",
  ...props
}: Omit<ComponentProps<"select">, "size"> & {
  size?: "xs" | "sm" | "default";
}) {
  return (
    <div
      data-slot="native-select-wrapper"
      className={cn(
        "relative w-fit min-w-0 has-[select:disabled]:opacity-50",
        className,
      )}
    >
      <select
        data-slot="native-select"
        data-size={size}
        className="min-h-10 w-full min-w-0 appearance-none rounded-md border border-fd-border bg-fd-card py-2 ps-3 pe-9 text-base hover:bg-fd-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring disabled:cursor-default aria-invalid:border-fd-foreground data-[size=sm]:min-h-9 data-[size=sm]:py-1.5 data-[size=xs]:min-h-8 data-[size=xs]:py-1 data-[size=xs]:ps-2 data-[size=xs]:pe-7 sm:text-sm sm:data-[size=xs]:text-xs"
        {...props}
      />
      <ChevronDown
        aria-hidden
        data-slot="native-select-icon"
        data-size={size}
        className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-fd-muted-foreground data-[size=xs]:end-2 data-[size=xs]:size-3.5"
      />
    </div>
  );
}

export function NativeSelectOption({
  className,
  ...props
}: ComponentProps<"option">) {
  return (
    <option
      data-slot="native-select-option"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  );
}
