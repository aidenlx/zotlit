import { useRef } from "react";

import { TagsInput, useTagsInput } from "@zotlit/ui";

import { useWorkbenchHost } from "./host";
import { useInputSuggestions } from "./match.input";
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

/** A Match value commits on a comma as well as on Enter. */
const COMMIT_KEYS = ["Enter", ","];

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

  return (
    <TagsInput.Root
      {...part("chips")}
      data-chip-input=""
      value={values}
      onValueChange={onChange}
      commitKeys={COMMIT_KEYS}
    >
      {values.map((value, index) => (
        <TagsInput.Item
          key={index}
          value={value}
          index={index}
          {...part("chip-item")}
        >
          <div {...part("chip-line")}>
            <span {...part("chip")}>
              <TagsInput.ItemText {...part("chip-value")} />
              <TagsInput.ItemRemove
                {...part("chip-remove")}
                aria-label={m.workbench_match_chip_remove({ value })}
                {...host.tooltip(m.workbench_match_chip_remove({ value }))}
              >
                {icon("close")}
              </TagsInput.ItemRemove>
            </span>
          </div>
          {hint?.(value) && <span {...part("hint")}>{hint(value)}</span>}
        </TagsInput.Item>
      ))}
      <ChipField
        placeholder={placeholder}
        suggestions={suggestions}
        hint={hint}
      />
    </TagsInput.Root>
  );
}

/** The text field, offering the suggestions not yet among the values. */
function ChipField({
  placeholder,
  suggestions,
  hint,
}: Pick<ChipInputProps, "placeholder" | "suggestions" | "hint">) {
  const m = useWorkbenchMessages();
  const part = useParts("match");
  const { value: values, add } = useTagsInput();
  const inputRef = useRef<HTMLInputElement>(null);
  const { list, datalist } = useInputSuggestions(inputRef, {
    suggestions: suggestions?.filter((value) => !values.includes(value)),
    hint,
    onSelect: add,
  });
  return (
    <>
      <TagsInput.Input
        inputRef={inputRef}
        {...part("chip-input")}
        aria-label={m.workbench_match_value()}
        placeholder={values.length === 0 ? placeholder : ""}
        autoComplete="off"
        list={list}
      />
      {datalist}
    </>
  );
}
