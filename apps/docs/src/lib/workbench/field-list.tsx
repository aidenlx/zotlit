// Each web Explorer restores the chosen paper's data and owns its display choices and navigation.
import { useMemo, useState } from "react";

import { initialTreeState, setAnchor } from "@zotlit/workbench/explorer";
import type { AnnotationExample } from "@zotlit/workbench/render";
import { DataExplorer, FieldPicker } from "@zotlit/workbench/ui";
import type {
  DataExplorerProps,
  FieldPickerProps,
  TemplateRoot,
} from "@zotlit/workbench/ui";

import { m } from "@/paraglide/messages.js";

import { FIELD_TRIGGER, rootData } from "./fields";
import type { SampleItem } from "./fields";
import { usePageBridge } from "./runtime";
import { copyThrough } from "./transfer";

interface FieldListInput {
  sample: SampleItem | null;
  root: TemplateRoot;
  annotation?: AnnotationExample;
  citation?: string | null;
  ready: boolean;
}
export type FieldListProps = Omit<
  DataExplorerProps,
  | "data"
  | "empty"
  | "copy"
  | "collapsedSections"
  | "onCollapsedSectionsChange"
  | "navigation"
  | "onNavigationChange"
> &
  FieldListInput;
function itemKey(sample: SampleItem | null): string | null {
  return sample
    ? JSON.stringify([
        sample.provenance.kind === "connected"
          ? sample.provenance.installationId
          : "sample",
        sample.item.indexedKey,
      ])
    : null;
}
function restore(input: FieldListInput): {
  data: Record<string, unknown> | null;
  status: "no-item" | "loading" | "ready" | "empty";
} {
  if (!input.sample) return { data: null, status: "no-item" };
  if (!input.ready) return { data: null, status: "loading" };
  const data = rootData(input.sample, input.root, input.annotation);
  if (data && input.root === "annotation")
    data.citation = input.citation ?? null;
  return { data, status: data && Object.keys(data).length ? "ready" : "empty" };
}
/** What the field list and the picker say while the paper has no fields to list. */
function emptyText(
  status: ReturnType<typeof restore>["status"],
  root: TemplateRoot,
): string | undefined {
  if (status === "no-item")
    return root === "annotation"
      ? m.workbench_fields_choose_annotation()
      : m.workbench_fields_choose_item();
  return status === "loading" ? m.workbench_loading_item() : undefined;
}

/**
 * The same fields as the picker the Fields action opens where the column
 * does not fit.
 */
export function FieldListPicker({
  sample,
  annotation,
  citation,
  ready,
  root,
  ...props
}: FieldListInput & Pick<FieldPickerProps, "disabled" | "onInsertNode">) {
  const { data, status } = useMemo(
    () => restore({ sample, annotation, citation, ready, root }),
    [sample, annotation, citation, ready, root],
  );
  return (
    <FieldPicker
      {...props}
      root={root}
      data={data}
      empty={emptyText(status, root)}
    />
  );
}

export function FieldList({
  sample,
  annotation,
  citation,
  ready,
  ...props
}: FieldListProps) {
  const bridge = usePageBridge();
  const anchor =
    props.root === "note"
      ? null
      : props.root === "filename"
        ? "filename"
        : `annotation:${annotation?.id ?? ""}`;
  const { data, status } = useMemo(
    () => restore({ sample, annotation, citation, ready, root: props.root }),
    [sample, annotation, citation, ready, props.root],
  );
  const [collapsedSections, setCollapsedSections] = useState<
    ReadonlySet<string>
  >(() => new Set());
  // The explorer's place belongs to one paper and one root: another paper
  // starts it over, another root moves its anchor.
  const key = itemKey(sample);
  const [place, setPlace] = useState(() => ({
    key,
    navigation: initialTreeState(anchor),
  }));
  let navigation = place.navigation;
  if (place.key !== key) navigation = initialTreeState(anchor);
  else if (navigation.anchorKey !== anchor)
    navigation = setAnchor(navigation, anchor);
  if (navigation !== place.navigation) setPlace({ key, navigation });
  return (
    <DataExplorer
      {...props}
      data={data}
      empty={emptyText(status, props.root)}
      collapsedSections={collapsedSections}
      onCollapsedSectionsChange={setCollapsedSections}
      navigation={navigation}
      onNavigationChange={(next) => setPlace({ key, navigation: next })}
      trigger={FIELD_TRIGGER}
      copy={copyThrough(bridge)}
    />
  );
}
