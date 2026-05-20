import { type InputHTMLAttributes, type Ref } from "react";
import { cn } from "@/lib/utils";

export interface ColorProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
> {
  /** Hex color string, e.g. `"#22aaff"`. */
  value: string;
  onChange: (next: string) => void;
  ref?: Ref<HTMLInputElement>;
}

/** @see {@link tooltipAttrs} for opting into Obsidian's hover tooltip. */
export function Color({
  value,
  onChange,
  className,
  ref,
  ...rest
}: ColorProps) {
  return (
    <input
      ref={ref}
      type="color"
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      {...rest}
      className={cn(className)}
    />
  );
}
