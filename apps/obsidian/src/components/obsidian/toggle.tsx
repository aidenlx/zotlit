import { type HTMLAttributes, type Ref } from "react";
import { tv, type VariantProps } from "tailwind-variants";

const toggle = tv({
  base: "checkbox-container",
  variants: {
    on: { true: "is-enabled" },
    disabled: { true: "is-disabled" },
    size: {
      default: "",
      small: "mod-small",
    },
  },
  defaultVariants: { size: "default" },
});

type ToggleVariants = VariantProps<typeof toggle>;

export interface ToggleProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "role" | "tabIndex" | "onClick" | "onChange"
> {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Omit in modals — the larger track is applied automatically. */
  size?: ToggleVariants["size"];
  ref?: Ref<HTMLDivElement>;
}

/** @see {@link tooltipAttrs} for opting into Obsidian's hover tooltip. */
export function Toggle({
  value,
  onChange,
  disabled,
  size,
  className,
  ref,
  ...rest
}: ToggleProps) {
  return (
    <div
      ref={ref}
      role="switch"
      aria-checked={value}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      {...rest}
      className={toggle({ on: value, disabled, size, className })}
      onClick={(e) => {
        if (disabled) return;
        e.preventDefault();
        onChange(!value);
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onChange(!value);
        }
      }}
    >
      <input
        type="checkbox"
        checked={value}
        disabled={disabled}
        tabIndex={-1}
        onChange={() => {}}
      />
    </div>
  );
}
