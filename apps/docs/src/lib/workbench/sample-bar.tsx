// The page's item row above the panels: which Item (or annotation) every
// panel reads, where it came from, its chooser, and the one request that
// loads or refreshes a connected Item. The name and its badge read first, and
// the controls trail them, as the Obsidian view's row has them.

import type { LocalBridgeConnection } from "@zotlit/workbench/bridge";
import type { AnnotationExample } from "@zotlit/workbench/render";
import { SAMPLE_ITEMS } from "@zotlit/workbench/render";
import {
  AnnotationSampleBar,
  annotationOption,
  ItemRow,
  SampleSuggester,
} from "@zotlit/workbench/ui";

import { Button } from "@/components/ui/button";
import { m } from "@/paraglide/messages.js";

import type { SampleItem } from "./fields";
import { itemChoice } from "./page-model";

type AnnotationChoice = Pick<AnnotationExample, "id" | "root">;

export function SampleBar({
  sample,
  retained,
  connection,
  unmatchedItemType,
  busy,
  onShow,
  onLoad,
  annotation,
}: {
  readonly sample: SampleItem;
  /** The vault Item the page holds, offered beside the bundled samples. */
  readonly retained: SampleItem | null;
  readonly connection: LocalBridgeConnection;
  /**
   * The sample item type this Profile asks for where no bundled Item carries
   * it, so the reader knows which item type has no sample.
   */
  readonly unmatchedItemType?: string;
  /** True while the connection is fetching the selected Item. */
  readonly busy: boolean;
  readonly onShow: (sample: SampleItem) => void;
  readonly onLoad: () => void;
  /**
   * While the view renders an annotation, the row names it and offers its
   * chooser instead of the Item's.
   */
  readonly annotation?: {
    readonly current: readonly AnnotationChoice[];
    readonly example: AnnotationChoice | null;
    readonly onSelect: (id: string) => void;
  };
}) {
  const connected = connection.state === "connected";
  const fromVault = sample.provenance.kind === "connected";
  const current =
    fromVault &&
    connected &&
    sample.provenance.installationId === connection.installation.id &&
    sample.item.indexedKey === connection.selectedItem?.key;
  const name = sample.item.title ?? sample.item.key;
  const items = retained ? [...SAMPLE_ITEMS, retained] : SAMPLE_ITEMS;
  const options = items.map((item) => ({
    sample: item,
    value: itemChoice(item).id,
    label: item.item.title ?? item.item.key,
    description: [
      item.provenance.kind === "connected"
        ? connected &&
          item.provenance.installationId === connection.installation.id &&
          item.item.indexedKey === connection.selectedItem?.key
          ? m.workbench_connected_badge()
          : m.workbench_retained_badge()
        : undefined,
      item.roots.note.authorsShort,
      item.roots.note.containerTitle,
    ]
      .filter((value) => typeof value === "string" && value.length > 0)
      .join(m.workbench_selection_separator()),
  }));
  const label = annotation ? (
    annotation.example && (
      <span
        className="text-fd-foreground"
        title={annotationOption(m, annotation.example).label}
      >
        {annotationOption(m, annotation.example).label}
      </span>
    )
  ) : (
    <>
      <span className="text-fd-foreground" title={name}>
        {name}
      </span>{" "}
      <span>
        {fromVault
          ? current
            ? m.workbench_connected_badge()
            : m.workbench_retained_badge()
          : m.workbench_sample_badge()}
      </span>
      {unmatchedItemType !== undefined && (
        <>
          {" "}
          <span>
            {m.docs_workbench_sample_type_missing({
              itemType: unmatchedItemType,
            })}
          </span>
        </>
      )}
    </>
  );
  return (
    <ItemRow label={label}>
      {annotation && (
        <AnnotationSampleBar
          compact
          current={annotation.current}
          example={annotation.example}
          onSelect={annotation.onSelect}
        />
      )}
      {/* The Item's controls stay mounted while an annotation shows, so a
          pending load keeps its place. */}
      <div className={annotation ? "hidden" : "contents"}>
        <SampleSuggester
          id="workbench-sample"
          title={m.workbench_choose_item()}
          selected={itemChoice(sample).id}
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
        {/* A launch that chose no Item grants nothing to load, so the page
            stays on its Sample Item and offers no request. */}
        {connected && connection.selectedItem !== null && (
          <Button variant="outline" size="xs" disabled={busy} onClick={onLoad}>
            {busy
              ? m.workbench_loading_item()
              : current
                ? m.workbench_refresh_item()
                : m.workbench_load_item()}
          </Button>
        )}
      </div>
    </ItemRow>
  );
}
