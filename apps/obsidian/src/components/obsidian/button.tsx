import { type ButtonHTMLAttributes, type Ref } from "react";
import type { IconName } from "obsidian";
import { tv, type VariantProps } from "tailwind-variants";
import { Icon } from "./icon";

const button = tv({
  base: "",
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
