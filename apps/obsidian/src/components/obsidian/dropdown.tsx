import {
  type OptgroupHTMLAttributes,
  type OptionHTMLAttributes,
  type Ref,
  type SelectHTMLAttributes,
} from "react";

import { cn } from "@/lib/utils";

export interface DropdownProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "value" | "onChange"
> {
  value: string;
  onChange: (next: string) => void;
  ref?: Ref<HTMLSelectElement>;
}

/**
 * @see {@link tooltipAttrs} for opting into Obsidian's hover tooltip.
 *
 * @example
 * ```tsx
 * <Dropdown value={mode} onChange={setMode}>
 *   <DropdownItem value="light">Light</DropdownItem>
 *   <DropdownItem value="dark">Dark</DropdownItem>
 *   <DropdownGroup label="Auto">
 *     <DropdownItem value="system">Match system</DropdownItem>
 *   </DropdownGroup>
 * </Dropdown>
 * ```
 */
export function Dropdown({
  value,
  onChange,
  className,
  children,
  ref,
  ...rest
}: DropdownProps) {
  return (
    <select
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      {...rest}
      className={cn("dropdown", className)}
    >
      {children}
    </select>
  );
}

export interface DropdownItemProps extends OptionHTMLAttributes<HTMLOptionElement> {
  value: string;
  ref?: Ref<HTMLOptionElement>;
}

export function DropdownItem({
  value,
  children,
  ref,
  ...rest
}: DropdownItemProps) {
  return (
    <option ref={ref} value={value} {...rest}>
      {children}
    </option>
  );
}

export interface DropdownGroupProps extends OptgroupHTMLAttributes<HTMLOptGroupElement> {
  label: string;
  ref?: Ref<HTMLOptGroupElement>;
}

export function DropdownGroup({
  label,
  children,
  ref,
  ...rest
}: DropdownGroupProps) {
  return (
    <optgroup ref={ref} label={label} {...rest}>
      {children}
    </optgroup>
  );
}
