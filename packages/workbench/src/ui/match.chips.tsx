// Wrapping list values retain free text and optional host suggestions.
import { useId, useRef, useState } from "react";

import { useWorkbenchHost } from "./host";
import { m } from "./paraglide/messages.js";
import { useIcon, useParts } from "./theme";
export interface ChipInputProps {
  values: readonly string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  suggestions?: readonly string[];
  hint?: (value: string) => string | null;
}

export function ChipInput({
  values,
  onChange,
  placeholder,
  suggestions,
  hint,
}: ChipInputProps) {
  const part = useParts("match");
  const host = useWorkbenchHost();
  const icon = useIcon();
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsId = useId();
  const commit = () => {
    const value = draft.trim();
    if (value === "") return;
    onChange([...values, value]);
    setDraft("");
  };

  return (
    <div
      {...part("chips")}
      data-chip-input=""
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          inputRef.current?.focus();
        }
      }}
    >
      {values.map((value, index) => (
        <div key={index} {...part("control")}>
          <span {...part("chip")}>
            <span {...part("chip-value")}>{value}</span>
            <button
              type="button"
              {...part("icon-button")}
              aria-label={m.workbench_match_chip_remove({ value })}
              {...host.tooltip(m.workbench_match_chip_remove({ value }))}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onChange(values.filter((_, at) => at !== index))}
            >
              {icon("remove")}
            </button>
          </span>
          {hint?.(value) && <span {...part("hint")}>{hint(value)}</span>}
        </div>
      ))}
      <input
        ref={inputRef}
        type="text"
        {...part("chip-input")}
        aria-label={m.workbench_match_value()}
        placeholder={values.length === 0 ? placeholder : ""}
        value={draft}
        list={suggestions?.length ? suggestionsId : undefined}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            commit();
          } else if (event.key === "Backspace" && draft === "") {
            onChange(values.slice(0, -1));
          }
        }}
      />
      {suggestions?.length ? (
        <datalist id={suggestionsId}>
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      ) : null}
    </div>
  );
}
