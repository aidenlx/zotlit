// The paper the page is shown against, beside the result: which Item it is, where
// it came from, and the one request that loads or refreshes a connected one.

import { useEffect, useState } from "react";

import type { LocalBridgeConnection } from "@zotlit/workbench/bridge";
import { SAMPLE_ITEMS } from "@zotlit/workbench/render";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { m } from "@/paraglide/messages.js";

import type { SampleItem } from "./fields";

export function SampleBar({
  sample,
  connection,
  unmatchedItemType,
  busy,
  onShow,
  onLoad,
}: {
  readonly sample: SampleItem;
  readonly connection: LocalBridgeConnection;
  /**
   * The sample item type this Profile asks for where no bundled Item carries
   * it, so the reader is told which paper they are not being shown.
   */
  readonly unmatchedItemType?: string;
  /** True while the connection is fetching the selected Item. */
  readonly busy: boolean;
  readonly onShow: (sample: SampleItem) => void;
  readonly onLoad: () => void;
}) {
  const connected = connection.state === "connected";
  const fromVault = sample.provenance.kind === "connected";
  // Keep the loaded paper available when comparing it with bundled samples.
  const [loadedItem, setLoadedItem] = useState(fromVault ? sample : null);
  useEffect(() => {
    if (sample.provenance.kind === "connected") setLoadedItem(sample);
  }, [sample]);
  const current =
    fromVault &&
    connected &&
    sample.provenance.installationId === connection.installation.id &&
    sample.item.key === connection.selectedItem.key;
  const name = sample.item.title ?? sample.item.key;
  const papers = loadedItem ? [...SAMPLE_ITEMS, loadedItem] : SAMPLE_ITEMS;
  const options = papers.map((item) => ({
    sample: item,
    value:
      item.provenance.kind === "connected"
        ? `connected:${item.item.key}`
        : item.item.key,
    label: item.item.title ?? item.item.key,
    description: [
      item.provenance.kind === "connected"
        ? connected &&
          item.provenance.installationId === connection.installation.id &&
          item.item.key === connection.selectedItem.key
          ? m.workbench_connected_badge()
          : m.workbench_retained_badge()
        : undefined,
      item.roots.note.authorsShort,
      item.roots.note.containerTitle,
    ]
      .filter((value) => typeof value === "string" && value.length > 0)
      .join(" · "),
  }));
  return (
    <div className="mb-2 flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <label
          htmlFor="workbench-sample"
          className="shrink-0 text-xs text-fd-muted-foreground"
        >
          {m.workbench_showing_label()}
        </label>
        <Select
          name="sample"
          items={options}
          value={fromVault ? `connected:${sample.item.key}` : sample.item.key}
          onValueChange={(value) => {
            const selected = options.find(
              (option) => option.value === value,
            )?.sample;
            if (selected) onShow(selected);
          }}
        >
          <SelectTrigger
            id="workbench-sample"
            title={name}
            className="min-h-8 flex-1 gap-2 px-2 py-1 text-xs sm:text-xs [&_svg]:size-3.5"
          >
            <SelectValue className="truncate" />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {options.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                label={option.label}
              >
                <span className="block font-medium break-words">
                  {option.label}
                </span>
                {option.description && (
                  <span className="mt-1 block text-xs break-words text-fd-muted-foreground">
                    {option.description}
                  </span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <span className="text-xs text-fd-muted-foreground">
        {fromVault
          ? current
            ? m.workbench_connected_badge()
            : m.workbench_retained_badge()
          : m.workbench_sample_badge()}
      </span>
      {unmatchedItemType !== undefined && (
        <span className="text-xs text-fd-muted-foreground">
          {m.workbench_sample_type_missing({ itemType: unmatchedItemType })}
        </span>
      )}
      {connected && (
        <Button
          variant="outline"
          size="sm"
          className="min-h-8 px-2 py-1 text-xs"
          disabled={busy}
          onClick={onLoad}
        >
          {busy
            ? m.workbench_loading_item()
            : fromVault && sample.item.key === connection.selectedItem.key
              ? m.workbench_refresh_item()
              : m.workbench_load_item()}
        </Button>
      )}
    </div>
  );
}
