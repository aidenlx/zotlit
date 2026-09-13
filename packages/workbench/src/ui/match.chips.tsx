import { useRef, useState } from "react";

import { useWorkbenchHost } from "./host";
import { MatchInput } from "./match.input";
// Wrapping list values retain free text and optional host suggestions.
import { useWorkbenchMessages } from "./messages";
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
  const m = useWorkbenchMessages();
  const part = useParts("match");
  const host = useWorkbenchHost();
  const icon = useIcon();
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
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
        <div key={index} {...part("chip-item")}>
          <div {...part("chip-line")}>
            <span {...part("chip")}>
              <span {...part("chip-value")}>{value}</span>
              <button
                type="button"
                {...part("chip-remove")}
                aria-label={m.workbench_match_chip_remove({ value })}
                {...host.tooltip(m.workbench_match_chip_remove({ value }))}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onChange(values.filter((_, at) => at !== index))}
              >
                {icon("close")}
              </button>
            </span>
          </div>
          {hint?.(value) && <span {...part("hint")}>{hint(value)}</span>}
        </div>
      ))}
      <MatchInput
        inputRef={inputRef}
        {...part("chip-input")}
        aria-label={m.workbench_match_value()}
        placeholder={values.length === 0 ? placeholder : ""}
        value={draft}
        suggestions={suggestions?.filter((value) => !values.includes(value))}
        hint={hint}
        onChange={setDraft}
        onAccept={(value) => {
          onChange([...values, value]);
          setDraft("");
        }}
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
    </div>
  );
}
