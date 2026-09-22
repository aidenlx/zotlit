import type { InputHTMLAttributes, Ref } from "react";

import { cn, tooltipAttrs } from "@/lib/utils";

export interface SearchInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
> {
  value: string;
  onChange: (next: string) => void;
  clearLabel: string;
  /**
   * The input type, which decides who owns Escape while the field holds text.
   *
   * `"search"` keeps the browser's own Escape-to-clear, and with it the
   * browser's claim on the key: a surface around the field never sees Escape
   * while the query is non-empty. `"text"` leaves Escape to that surface, so a
   * field inside a popover lets the platform's light dismiss close it on the
   * first press. Both types take the same Obsidian input styling, and the
   * clear control beside the field is this component's own either way.
   */
  type?: "search" | "text";
  ref?: Ref<HTMLInputElement>;
}

export function SearchInput({
  value,
  onChange,
  className,
  placeholder = "Search…",
  clearLabel,
  type = "search",
  ref,
  ...rest
}: SearchInputProps) {
  return (
    <div className={cn("search-input-container", className)}>
      <input
        ref={ref}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        {...rest}
      />
      <div
        className="search-input-clear-button"
        role="button"
        {...tooltipAttrs(clearLabel)}
        onClick={() => onChange("")}
      />
    </div>
  );
}
