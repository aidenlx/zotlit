// Each web Explorer restores its own input data and owns its display choices and navigation.
import { useLayoutEffect, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import { initialTreeState, setAnchor } from "@zotlit/workbench/explorer";
import type { TreeState } from "@zotlit/workbench/explorer";
import type { AnnotationExample } from "@zotlit/workbench/render";
import { DataExplorer } from "@zotlit/workbench/ui";
import type {
  DataExplorerProps,
  ExplorerVariant,
  TemplateRoot,
} from "@zotlit/workbench/ui";

import { m } from "@/paraglide/messages.js";

import { FIELD_TRIGGER, rootData } from "./fields";
import type { SampleItem } from "./fields";

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
  | "variant"
  | "onVariantChange"
  | "navigation"
  | "onNavigationChange"
> &
  FieldListInput;
interface FieldListState extends FieldListInput {
  itemKey: string | null;
  data: Record<string, unknown> | null;
  status: "no-item" | "loading" | "ready" | "empty";
  variant: ExplorerVariant;
  navigation: TreeState;
}
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
function restore(
  input: FieldListInput,
): Pick<FieldListState, "data" | "status"> {
  if (!input.sample) return { data: null, status: "no-item" };
  if (!input.ready) return { data: null, status: "loading" };
  const data = rootData(input.sample, input.root, input.annotation);
  if (data && input.root === "annotation")
    data.citation = input.citation ?? null;
  return { data, status: data && Object.keys(data).length ? "ready" : "empty" };
}
export function FieldList({
  sample,
  annotation,
  citation,
  ready,
  ...props
}: FieldListProps) {
  const anchor =
    props.root === "note"
      ? null
      : props.root === "filename"
        ? "filename"
        : `annotation:${annotation?.id ?? ""}`;
  const [store] = useState(() =>
    createStore<FieldListState>()(() => ({
      sample,
      annotation,
      citation,
      ready,
      root: props.root,
      itemKey: itemKey(sample),
      ...restore({ sample, annotation, citation, ready, root: props.root }),
      variant: "simple",
      navigation: initialTreeState(anchor),
    })),
  );
  const { variant, navigation, data, status } = useStore(store);
  useLayoutEffect(() => {
    const current = store.getState();
    if (
      current.sample === sample &&
      current.annotation === annotation &&
      current.citation === citation &&
      current.ready === ready &&
      current.root === props.root
    )
      return;
    const key = itemKey(sample);
    store.setState({
      sample,
      annotation,
      citation,
      ready,
      root: props.root,
      itemKey: key,
      ...restore({ sample, annotation, citation, ready, root: props.root }),
      navigation:
        current.itemKey !== key
          ? initialTreeState(anchor)
          : current.navigation.anchorKey !== anchor
            ? setAnchor(current.navigation, anchor)
            : current.navigation,
    });
  }, [store, sample, annotation, citation, ready, props.root, anchor]);
  return (
    <DataExplorer
      {...props}
      data={data}
      empty={
        status === "no-item"
          ? m.workbench_example_select_item()
          : status === "loading"
            ? m.workbench_loading_item()
            : undefined
      }
      variant={variant}
      onVariantChange={(variant) => store.setState({ variant })}
      navigation={navigation}
      onNavigationChange={(navigation) => store.setState({ navigation })}
      trigger={FIELD_TRIGGER}
      copy={(text) => navigator.clipboard.writeText(text)}
    />
  );
}
