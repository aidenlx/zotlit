// The paper the page is shown against, in the header: which Item it is, where
// it came from, and the one request that loads or refreshes a connected one.

import type { LocalBridgeConnection } from "@zotlit/workbench/bridge";
import { SAMPLE_ITEMS } from "@zotlit/workbench/render";

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
  // A vault's Item is the connection's to name, so it is shown rather than
  // picked; once the connection is gone the same snapshot is retained work,
  // and a Sample Item is offered beside it again.
  const fromVault = sample.provenance.kind === "connected";
  const current =
    fromVault &&
    connected &&
    sample.provenance.installationId === connection.installation.id &&
    sample.item.key === connection.selectedItem.key;
  const name = sample.item.title ?? sample.item.key;
  return (
    <>
      <label
        htmlFor="workbench-sample"
        className="font-mono text-[0.68rem] font-semibold tracking-widest text-fd-muted-foreground uppercase"
      >
        {m.workbench_showing_label()}
      </label>
      {fromVault && connected ? (
        <span
          id="workbench-sample"
          className="max-w-[22rem] min-w-0 truncate border border-fd-border bg-fd-card px-2 py-1.5 text-sm"
        >
          {name}
        </span>
      ) : (
        <select
          id="workbench-sample"
          className="max-w-[22rem] min-w-0 truncate border border-fd-border bg-fd-card px-2 py-1.5 text-sm"
          value={fromVault ? `connected:${sample.item.key}` : sample.item.key}
          onChange={(event) => {
            const selected = SAMPLE_ITEMS.find(
              (item) => item.item.key === event.target.value,
            );
            if (selected) onShow(selected);
          }}
        >
          {fromVault && (
            <option value={`connected:${sample.item.key}`}>{name}</option>
          )}
          {SAMPLE_ITEMS.map((item) => (
            <option key={item.item.key} value={item.item.key}>
              {item.item.title ?? item.item.key}
            </option>
          ))}
        </select>
      )}
      <span className="border border-fd-border px-1.5 py-0.5 font-mono text-[0.6rem] font-semibold tracking-widest text-fd-muted-foreground uppercase">
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
        <button
          type="button"
          disabled={busy}
          onClick={onLoad}
          className="cursor-pointer border border-fd-border px-3 py-1.5 text-sm font-medium disabled:cursor-wait disabled:text-fd-muted-foreground"
        >
          {busy
            ? m.workbench_loading_item()
            : fromVault && sample.item.key === connection.selectedItem.key
              ? m.workbench_refresh_item()
              : m.workbench_load_item()}
        </button>
      )}
    </>
  );
}
