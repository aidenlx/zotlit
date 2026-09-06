// A wrapping value input for list condition rows, with optional suggestions.
import { useId, useRef, useState } from "react";

import { IconButton } from "@/components/obsidian/icon-button";
import * as m from "@/lib/i18n/generated/messages";
import { cn, tooltipAttrs } from "@/lib/utils";

export interface ChipInputProps {
  values: readonly string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  suggestions?: readonly string[];
}

export function ChipInput({
  values,
  onChange,
  placeholder,
  suggestions,
}: ChipInputProps) {
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
      className="zt:col-span-4 zt:row-start-2 zt:flex zt:min-h-(--input-height) zt:w-full zt:min-w-0 zt:flex-1 zt:basis-64 zt:flex-wrap zt:items-center zt:gap-1 zt:border-s-0 zt:border-t zt:border-border zt:px-1.5 zt:py-1 zt:@xl:col-span-1 zt:@xl:col-start-3 zt:@xl:row-start-1 zt:@xl:w-auto zt:@xl:border-s zt:@xl:border-t-0"
      data-chip-input=""
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          inputRef.current?.focus();
        }
      }}
    >
      {values.map((value, index) => (
        <span
          key={index}
          className={cn(
            "zt:flex zt:max-w-full zt:items-center zt:gap-0.5 zt:rounded-sm zt:bg-muted zt:py-0.5 zt:ps-1.5 zt:text-sm zt:leading-tight",
            index === values.length - 1 &&
              "zt:max-w-[calc(100%_-_2ch_-_0.25rem)]",
          )}
        >
          <span className="zt:min-w-0 zt:[overflow-wrap:anywhere]">
            {value}
          </span>
          <IconButton
            icon="x"
            className="zt:size-5 zt:shrink-0 zt:p-0"
            {...tooltipAttrs(m.settings_profile_rule_chip_remove({ value }))}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChange(values.filter((_, at) => at !== index))}
          />
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        className="zt:[field-sizing:content] zt:w-auto zt:max-w-full zt:min-w-[2ch] zt:flex-none zt:[--background-modifier-form-field:transparent] zt:[--input-border-width:0px] zt:[--input-height:auto] zt:[--input-padding:0px] zt:[--input-radius:0px] zt:[--input-shadow:none]"
        aria-label={m.settings_profile_rule_value()}
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
