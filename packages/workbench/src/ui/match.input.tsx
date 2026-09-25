// Hosts can attach their native typing suggestions to the shared text control.
import { useEffect, useId, useRef } from "react";
import type { ComponentProps, ReactNode, RefObject } from "react";

import { useWorkbenchHost } from "./host";

/**
 * Attaches the host's typing suggestions to `inputRef`'s input.
 * @returns For a host without typing suggestions, the `list` attribute for the
 * input and the `<datalist>` it names; otherwise no `list` and no element.
 */
export function useInputSuggestions(
  inputRef: RefObject<HTMLInputElement | null>,
  {
    suggestions = [],
    hint,
    onSelect,
  }: {
    suggestions?: readonly string[];
    hint?: (value: string) => string | null;
    onSelect: (value: string) => void;
  },
): { list: string | undefined; datalist: ReactNode } {
  const host = useWorkbenchHost();
  const id = useId();
  const latest = useRef({ suggestions, hint, onSelect });
  latest.current = { suggestions, hint, onSelect };
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
        latest.current.onSelect(value);
      },
    });
    return () => popup.close();
  }, [host, inputRef]);
  const fallback = !host.inputSuggestions && suggestions.length > 0;
  return {
    list: fallback ? id : undefined,
    datalist: fallback && (
      <datalist id={id}>
        {suggestions.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
    ),
  };
}

export function MatchInput({
  suggestions,
  hint,
  onChange,
  ...props
}: Omit<ComponentProps<"input">, "onChange" | "list" | "ref"> & {
  suggestions?: readonly string[];
  hint?: (value: string) => string | null;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { list, datalist } = useInputSuggestions(inputRef, {
    suggestions,
    hint,
    onSelect: onChange,
  });
  return (
    <>
      <input
        {...props}
        ref={inputRef}
        type="text"
        autoComplete="off"
        list={list}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {datalist}
    </>
  );
}
