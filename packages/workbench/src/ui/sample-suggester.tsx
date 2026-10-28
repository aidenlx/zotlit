// Item and annotation choice controls; the host owns the searchable overlay.
import { useState } from "react";

import { useUniqueId } from "@zotlit/ui";

import { useTooltip, useWorkbenchHost } from "./host";
import { useFork } from "./run";
import { useIcon, useParts } from "./theme";

export interface SampleOption {
  readonly value: string;
  readonly label: string;
  readonly description: string;
}

export function SampleSuggester({
  id,
  title,
  label,
  selected,
  groups,
  onSelect,
}: {
  readonly id?: string;
  readonly title: string;
  readonly label: string;
  readonly selected: string;
  readonly groups: readonly {
    readonly heading: string;
    readonly options: readonly SampleOption[];
    readonly empty?: string;
  }[];
  readonly onSelect: (value: string) => void;
}) {
  const part = useParts("sampleSuggester");
  const icon = useIcon();
  const host = useWorkbenchHost();
  const fork = useFork(host.run);
  const labelTooltip = useTooltip(label);
  const triggerTooltip = useTooltip(title);
  const instanceId = useUniqueId();
  const [open, setOpen] = useState(false);
  return (
    <div {...part("suggester")}>
      <span {...part("label")} {...labelTooltip}>
        {label}
      </span>
      <button
        type="button"
        id={id ?? instanceId}
        {...part("trigger")}
        {...triggerTooltip}
        aria-label={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(event) => {
          setOpen(true);
          fork(
            host.suggester({
              anchor: event.currentTarget,
              title,
              selected,
              groups: groups.map((group) => ({
                label: group.heading,
                empty: group.empty,
                options: group.options.map((option) => ({
                  id: option.value,
                  label: option.label,
                  hint: option.description,
                })),
              })),
            }),
            {
              onSuccess: (choice) => {
                setOpen(false);
                if (choice !== null) onSelect(choice);
              },
              onFailure: () => setOpen(false),
            },
          );
        }}
      >
        {icon("choose-sample")}
      </button>
    </div>
  );
}
