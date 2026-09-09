// Hosts can attach their native typing suggestions to the shared text control.
import { useEffect, useId, useRef } from "react";
import type { ComponentProps, RefObject } from "react";

import { useWorkbenchHost } from "./host";

export function MatchInput({
  inputRef: providedRef,
  suggestions = [],
  hint,
  onChange,
  onAccept,
  ...props
}: Omit<ComponentProps<"input">, "onChange" | "list" | "ref"> & {
  inputRef?: RefObject<HTMLInputElement | null>;
  suggestions?: readonly string[];
  hint?: (value: string) => string | null;
  onChange: (value: string) => void;
  onAccept?: (value: string) => void;
}) {
  const host = useWorkbenchHost();
  const localRef = useRef<HTMLInputElement>(null);
  const inputRef = providedRef ?? localRef;
  const id = useId();
  const latest = useRef({ suggestions, hint, onChange, onAccept });
  latest.current = { suggestions, hint, onChange, onAccept };
  useEffect(() => {
    const input = inputRef.current;
    if (!input || !host.inputSuggestions) return;
    const popup = host.inputSuggestions({
      input,
      getSuggestions(query) {
        const search = query.toLocaleLowerCase();
        return latest.current.suggestions
          .map((value) => ({
            id: value,
            label: value,
            hint: latest.current.hint?.(value) ?? undefined,
          }))
          .filter((option) =>
            `${option.label} ${option.hint ?? ""}`
              .toLocaleLowerCase()
              .includes(search),
          );
      },
      onSelect(value) {
        latest.current.onChange(value);
        latest.current.onAccept?.(value);
      },
    });
    return () => popup.close();
  }, [host, inputRef]);
  const fallback = !host.inputSuggestions && suggestions.length > 0;
  return (
    <>
      <input
        {...props}
        ref={inputRef}
        type="text"
        autoComplete="off"
        list={fallback ? id : undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {fallback && (
        <datalist id={id}>
          {suggestions.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
      )}
    </>
  );
}
