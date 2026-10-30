import { WorkbenchSelect } from "./select";
import { useMatchSelect, useParts } from "./theme";
import type { MatchSelectProps } from "./theme";

/**
 * A select of the Match editor, which reports the chosen value. A searchable
 * one is the host's own control where the theme supplies one; otherwise it is
 * a native select, with the chosen option's icon before it.
 */
export function MatchSelect({ searchable, ...props }: MatchSelectProps) {
  const Host = useMatchSelect();
  const part = useParts("match");
  if (Host && searchable) return <Host {...props} />;
  const { value, options, placeholder, onChange, ...rest } = props;
  const current = options.find((option) => option.value === value);
  return (
    <>
      {current?.icon !== undefined && (
        <span aria-hidden {...part("kind-icon")}>
          {current.icon}
        </span>
      )}
      <WorkbenchSelect
        {...rest}
        value={value}
        onInput={(event) => onChange(event.currentTarget.value)}
      >
        {current === undefined &&
          (value === "" ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : (
            <option value={value}>{value}</option>
          ))}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </WorkbenchSelect>
    </>
  );
}
