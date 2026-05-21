import { type InputHTMLAttributes, type Ref } from "react";

import { cn } from "@/lib/utils";

export interface SearchInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
> {
  value: string;
  onChange: (next: string) => void;
  ref?: Ref<HTMLInputElement>;
}

export function SearchInput({
  value,
  onChange,
  className,
  placeholder = "Search…",
  ref,
  ...rest
}: SearchInputProps) {
  return (
    <div className={cn("search-input-container", className)}>
      <input
        ref={ref}
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        {...rest}
      />
      <div
        className="search-input-clear-button"
        role="button"
        aria-label="Clear search"
        onClick={() => onChange("")}
      />
    </div>
  );
}
