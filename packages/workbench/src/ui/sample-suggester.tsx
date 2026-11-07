import { useAtomSet, useAtomValue } from "@effect/atom-react";
// Item and annotation choice controls; the host owns the searchable overlay.

import { useUniqueId } from "@zotlit/ui";

import { useWorkbenchModel } from "./editor";
import { useTooltip, useWorkbenchHost } from "./host";
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
  /**
   * The chosen sample's name beside the trigger. Without it the trigger
   * stands alone, for a row that names the sample itself.
   */
  readonly label?: string;
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
  const command = useWorkbenchModel().choose(useUniqueId());
  const open = useAtomValue(command).waiting;
  const choose = useAtomSet(command);
  const labelTooltip = useTooltip(label ?? "");
  const triggerTooltip = useTooltip(title);
  const instanceId = useUniqueId();
  const trigger = (
    <button
      type="button"
      id={id ?? instanceId}
      {...part("trigger")}
      {...triggerTooltip}
      aria-label={title}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={(event) => {
        choose({
          choose: host.suggester({
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
          chosen: onSelect,
        });
      }}
    >
      {icon("choose-sample")}
    </button>
  );
  if (label === undefined) return trigger;
  return (
    <div {...part("suggester")}>
      <span {...part("label")} {...labelTooltip}>
        {label}
      </span>
      {trigger}
    </div>
  );
}
