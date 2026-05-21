import { type InputHTMLAttributes, type Ref, useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/** 2-decimal format for fractional/`"any"` steps, integer string otherwise. */
function getValuePretty(value: number, step: number | "any"): string {
  return step === "any" || step < 1 ? value.toFixed(2) : value.toString();
}

export interface SliderProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "min" | "max" | "step"
> {
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  /**
   * Native range step; `"any"` disables snapping.
   * @default 1
   */
  step?: number | "any";
  /**
   * Fire `onChange` continuously while dragging instead of on release.
   * @default false
   */
  instant?: boolean;
  /**
   * Show the current value as a tooltip on hover/drag. When enabled,
   * `aria-label` is owned by this component and any consumer-supplied
   * value is overridden.
   */
  dynamicTooltip?: boolean;
  /** @default {@link getValuePretty} */
  formatValue?: (value: number) => string;
  "data-tooltip-position"?: string;
  ref?: Ref<HTMLInputElement>;
}

/**
 * @see {@link tooltipAttrs} for static tooltips. Use `dynamicTooltip` for
 *      the live-value hover tooltip.
 */
export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  instant = false,
  dynamicTooltip,
  formatValue,
  className,
  ref,
  "data-tooltip-position": tooltipPosition,
  ...rest
}: SliderProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (!instant && draft !== value) onChange(draft);
  };

  const ariaLabel = dynamicTooltip
    ? (formatValue ?? ((v: number) => getValuePretty(v, step)))(draft)
    : rest["aria-label"];

  return (
    <input
      ref={ref}
      type="range"
      data-ignore-swipe="true"
      min={min}
      max={max}
      step={step}
      value={draft}
      data-tooltip-position={
        tooltipPosition ?? (dynamicTooltip ? "top" : undefined)
      }
      {...rest}
      aria-label={ariaLabel}
      className={cn("slider", className)}
      onChange={(e) => {
        const next = e.currentTarget.valueAsNumber;
        setDraft(next);
        if (instant) onChange(next);
      }}
      onMouseUp={commit}
      onTouchEnd={commit}
      onKeyUp={commit}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
