// The paper the page is shown against, beside the result: which Item it is, where
// it came from, and the one request that loads or refreshes a connected one.

import { useEffect, useState } from "react";

import type { LocalBridgeConnection } from "@zotlit/workbench/bridge";
import { SAMPLE_ITEMS } from "@zotlit/workbench/render";

import { Button } from "@/components/ui/button";
import { m } from "@/paraglide/messages.js";

import type { SampleItem } from "./fields";
import { SampleSuggester } from "./sample-suggester";

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
      <SampleSuggester
        id="workbench-sample"
        title={m.workbench_choose_paper()}
        label={name}
        selected={fromVault ? `connected:${sample.item.key}` : sample.item.key}
        groups={[
          {
            heading: m.workbench_sample_examples(),
            options: options.filter(
              ({ sample }) => sample.provenance.kind === "sample",
            ),
          },
          {
            heading: m.workbench_sample_loaded(),
            empty: connected
              ? m.workbench_sample_not_loaded()
              : m.workbench_sample_disconnected(),
            options: options.filter(
              ({ sample }) => sample.provenance.kind === "connected",
            ),
          },
        ]}
        onSelect={(value) => {
          const selected = options.find((option) => option.value === value);
          if (selected) onShow(selected.sample);
        }}
      />
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
