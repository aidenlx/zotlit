import { type IconName } from "obsidian";
import { type HTMLAttributes, type Ref } from "react";
import { type VariantProps } from "tailwind-variants";

import { tv } from "@/lib/tw";

import { Icon } from "./icon";

const iconButton = tv({
  base: "clickable-icon",
  variants: {
    active: { true: "is-active" },
    warning: { true: "mod-warning" },
  },
});

type IconButtonVariants = VariantProps<typeof iconButton>;

export interface IconButtonProps
  extends
    Omit<HTMLAttributes<HTMLDivElement>, "role" | "tabIndex" | "children">,
    IconButtonVariants {
  icon: IconName;
  disabled?: boolean;
  ref?: Ref<HTMLDivElement>;
}

/** @see {@link tooltipAttrs} for opting into Obsidian's hover tooltip. */
export function IconButton({
  icon,
  active,
  warning,
  disabled,
  className,
  onClick,
  onKeyDown,
  ref,
  ...rest
}: IconButtonProps) {
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      {...rest}
      className={iconButton({ active, warning, className })}
      onClick={(e) => {
        if (disabled) return;
        onClick?.(e);
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented || disabled) return;
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.click();
        }
      }}
    >
      <Icon name={icon} />
    </div>
  );
}
