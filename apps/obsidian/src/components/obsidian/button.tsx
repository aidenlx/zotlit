import type { IconName } from "obsidian";
import type { ButtonHTMLAttributes, Ref } from "react";
import type { VariantProps } from "tailwind-variants";

import { tv } from "@/lib/tw";

import { Icon } from "./icon";

const button = tv({
  base: "zt:gap-1.5",
  variants: {
    variant: {
      default: "",
      cta: "mod-cta",
      warning: "mod-warning",
      destructive: "mod-destructive",
    },
    loading: { true: "mod-loading" },
  },
  defaultVariants: { variant: "default" },
});

type ButtonVariants = VariantProps<typeof button>;

export interface ButtonProps
  extends
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">,
    ButtonVariants {
  icon?: IconName;
  ref?: Ref<HTMLButtonElement>;
}

/** @see {@link tooltipAttrs} for opting into Obsidian's hover tooltip. */
export function Button({
  variant,
  loading,
  icon,
  className,
  children,
  ref,
  ...rest
}: ButtonProps) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={button({ variant, loading, className })}
      aria-busy={loading || undefined}
    >
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}
