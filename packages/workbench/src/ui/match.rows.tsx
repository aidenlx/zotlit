import type { ComponentProps } from "react";

import { WorkbenchSelect } from "./select";

/** A select of the Match editor, which reports the chosen value. */
export function MatchSelect({
  onChange,
  ...props
}: Omit<ComponentProps<typeof WorkbenchSelect>, "onChange"> & {
  onChange: (value: string) => void;
}) {
  return (
    <WorkbenchSelect
      {...props}
      onInput={(event) => onChange(event.currentTarget.value)}
    />
  );
}
