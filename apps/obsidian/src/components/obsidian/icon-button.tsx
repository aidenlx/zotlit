import type { IconName } from "obsidian";
import type { HTMLAttributes, ReactNode, Ref } from "react";
import type { VariantProps } from "tailwind-variants";

import { tv } from "@/lib/tw";

import { Icon } from "./icon";

const iconButton = tv({
  base: "clickable-icon",
  variants: {
    active: { true: "is-active" },
    warning: { true: "mod-warning" },
    blocked: { true: "is-disabled" },
  },
});

type IconButtonVariants = VariantProps<typeof iconButton>;

export interface IconButtonProps
  extends
    Omit<HTMLAttributes<HTMLDivElement>, "role" | "tabIndex" | "children">,
    IconButtonVariants {
  icon: IconName;
  disabled?: boolean;
  /**
   * A toggle's state, announced as `aria-pressed` and drawn as `is-active`;
   * `undefined` for a button that is not a toggle.
   */
  pressed?: boolean;
  /**
   * A control that cannot run right now keeps its seat and its place in the
   * tab order, carries its reason in its tooltip, and takes no press.
   */
  blocked?: boolean;
  /** What the button shows after its icon, such as a count. */
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

/** @see {@link tooltipAttrs} for opting into Obsidian's hover tooltip. */
export function IconButton({
  icon,
  active,
  warning,
  disabled,
  pressed,
  blocked,
  className,
  onClick,
  onKeyDown,
  children,
  ref,
  ...rest
}: IconButtonProps) {
  const inert = disabled || blocked;
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={inert || undefined}
      aria-pressed={pressed}
      {...rest}
      className={iconButton({
        active: active ?? pressed,
        warning,
        blocked,
        className,
      })}
      onClick={(e) => {
        if (inert) return;
        onClick?.(e);
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented || inert) return;
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.click();
        }
      }}
    >
      <Icon name={icon} />
      {children}
    </div>
  );
}
