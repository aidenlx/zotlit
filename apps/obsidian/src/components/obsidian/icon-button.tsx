import type { IconName } from "obsidian";
import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import type { VariantProps } from "tailwind-variants";

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
}

/**
 * Wrapped in `forwardRef` because Preact lifts `ref` off a function
 * component's props, so a `ref` prop would hold the component, not the element.
 * @see {@link tooltipAttrs} for opting into Obsidian's hover tooltip.
 */
export const IconButton = forwardRef<HTMLDivElement, IconButtonProps>(
  function IconButton(
    { icon, active, warning, disabled, className, onClick, onKeyDown, ...rest },
    ref,
  ) {
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
  },
);
