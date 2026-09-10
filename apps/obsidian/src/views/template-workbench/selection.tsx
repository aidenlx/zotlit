// Native selection shares examples, search, and labels across independent views.
import "./selection.css";
import type { ItemView, WorkspaceLeaf } from "obsidian";
import { useEffect, useId, useState } from "react";

import { isChildItemFields } from "@zotlit/db";
import type { CitationVariant } from "@zotlit/db";
import { SAMPLE_ANNOTATIONS } from "@zotlit/workbench/render";
import type {
  AnnotationExample,
  CitationExampleId,
  PartialChoice,
} from "@zotlit/workbench/render";
import { annotationOption } from "@zotlit/workbench/ui";
import type { WorkbenchHost, WorkbenchItemChoice } from "@zotlit/workbench/ui";

import { Icon } from "@/components/obsidian/icon";
import * as m from "@/lib/i18n/generated/messages";
import { itemSummary } from "@/lib/item-summary";
import { pickItem } from "@/services/item-lookup/search-modal";
import type { ItemSearchDeps } from "@/services/item-lookup/search-modal";

import {
  getSampleItem,
  getSampleItemType,
  SAMPLE_ITEM_CHOICES,
} from "./selection-data";
import {
  selectionControl,
  selectionGroup,
  selectionGroupHeading,
  selectionHint,
} from "./theme";

type AnnotationChoice = Pick<AnnotationExample, "id" | "root">;

export type WorkbenchSelection =
  | { kind: "item"; item: WorkbenchItemChoice }
  | { kind: "annotation"; annotationId: string }
  /** The Citation set and Variant a Citation Template preview renders under. */
  | {
      kind: "citation";
      variant: CitationVariant;
      example: CitationExampleId | null;
    }
  /** The caller and the Profile a Shared Partial preview renders under. */
  | ({ kind: "partial" } & PartialChoice);
export type WorkbenchSelectionEvent = WorkbenchSelection & {
  leaf: WorkspaceLeaf;
  editor: WorkspaceLeaf | null;
};

const selectionTrigger = selectionControl({ kind: "trigger" });
const selectionOption = selectionControl({ kind: "option" });

/** Native association scopes user choices; receivers never echo a selection. */
export function subscribeWorkbenchSelection(
  view: ItemView,
  options: {
    editor: () => WorkspaceLeaf | null;
    apply: (selection: WorkbenchSelection) => void;
  },
): () => void {
  const ref = view.app.workspace.on("zotlit:workbench-selection", (event) => {
    if (event.leaf === view.leaf || view.leaf.pinned) return;
    const follows = view.leaf.group
      ? view.leaf.group === event.leaf.group
      : event.editor !== null &&
        (view.leaf === event.editor || options.editor() === event.editor);
    if (follows) options.apply(event);
  });
  return () => view.app.workspace.offref(ref);
}

export function publishWorkbenchSelection(
  view: ItemView,
  selection: WorkbenchSelection,
  editor: WorkspaceLeaf | null,
): void {
  view.app.workspace.trigger("zotlit:workbench-selection", {
    ...selection,
    leaf: view.leaf,
    editor,
  });
}

export function sampleTypeLabel(id: string): string {
  switch (getSampleItemType(id)) {
    case "journalArticle":
      return m.workbench_sample_type_journal_article();
    case "conferencePaper":
      return m.workbench_sample_type_conference_paper();
    case "book":
      return m.workbench_sample_type_book();
    case "thesis":
      return m.workbench_sample_type_thesis();
    default:
      return m.workbench_example_item();
  }
}

export async function recentItemChoices(
  lookup: ItemSearchDeps["lookup"],
): Promise<readonly WorkbenchItemChoice[]> {
  try {
    const hits = await lookup.search("", { limit: 3 });
    return hits.flatMap(({ item }) =>
      isChildItemFields(item.fields)
        ? []
        : [
            {
              id: item.indexedKey,
              title: itemSummary(item, item.fields).formatted,
            },
          ],
    );
  } catch {
    return [];
  }
}

export async function searchWorkbenchItem(
  deps: ItemSearchDeps,
): Promise<WorkbenchItemChoice | null> {
  const hit = await pickItem(deps, m.template_data_explorer_pick_placeholder());
  return hit && !isChildItemFields(hit.item.fields)
    ? {
        id: hit.item.indexedKey,
        title: itemSummary(hit.item, hit.item.fields).formatted,
      }
    : null;
}

export async function chooseWorkbenchItem(
  host: WorkbenchHost,
  deps: ItemSearchDeps,
  selected?: WorkbenchItemChoice,
): Promise<WorkbenchItemChoice | null> {
  const recent = await recentItemChoices(deps.lookup);
  const choices = [...SAMPLE_ITEM_CHOICES, ...recent];
  const retained =
    selected && !choices.some(({ id }) => id === selected.id) ? [selected] : [];
  const id = await host.suggester({
    title: m.workbench_choose_item(),
    selected: selected?.id,
    groups: [
      {
        label: "",
        options: [
          {
            id: "search-zotero",
            label: m.workbench_search_zotero(),
            icon: "choose-sample",
          },
        ],
      },
      ...retained.map((item) => ({
        label: m.workbench_selected_label(),
        options: [{ id: item.id, label: item.title ?? item.id }],
      })),
      {
        label: m.workbench_sample_examples(),
        options: SAMPLE_ITEM_CHOICES.map((item) => ({
          id: item.id,
          label: sampleTypeLabel(item.id),
          hint: item.title ?? undefined,
        })),
      },
      {
        label: m.workbench_recently_updated(),
        options: recent.map((item) => ({
          id: item.id,
          label: item.title ?? item.id,
        })),
      },
    ],
  });
  return id === "search-zotero"
    ? searchWorkbenchItem(deps)
    : ([...retained, ...choices].find((item) => item.id === id) ?? null);
}

export async function chooseWorkbenchAnnotation(
  host: WorkbenchHost,
  current: readonly AnnotationChoice[],
  selected: string | null,
): Promise<string | null> {
  const options = (examples: readonly AnnotationChoice[]) =>
    examples.map((example) => {
      const option = annotationOption(m, example);
      return {
        id: option.value,
        label: option.label,
        hint: option.description,
      };
    });
  return host.suggester({
    title: m.workbench_choose_annotation(),
    selected: selected ?? undefined,
    groups: [
      {
        label: m.workbench_annotation_from_item(),
        options: options(current),
        empty: m.workbench_annotation_empty(),
      },
      {
        label: m.workbench_sample_examples(),
        options: options(SAMPLE_ANNOTATIONS),
      },
    ],
  });
}

/** The selected data's own name, which a pane shows wherever its header cannot. */
export function selectionName(input: {
  item: WorkbenchItemChoice | null;
  annotation?: AnnotationChoice | null;
  annotationMode: boolean;
}): string | null {
  let name: string | null = null;
  const annotation = input.annotation;
  if (input.annotationMode && annotation) {
    const root = annotation.root;
    const type = m.workbench_annotation_type({
      type: typeof root.type === "string" ? root.type : "unknown",
    });
    if (SAMPLE_ANNOTATIONS.some(({ id }) => id === annotation.id))
      name = m.workbench_example_title({ name: type });
    else {
      const text =
        typeof root.text === "string" && root.text
          ? root.text
          : typeof root.comment === "string"
            ? root.comment
            : "";
      name = [
        type,
        typeof root.pageLabel === "string" && root.pageLabel
          ? m.workbench_annotation_page({ page: root.pageLabel })
          : null,
        text.length > 48 ? `${text.slice(0, 48)}…` : text,
      ]
        .filter(Boolean)
        .join(m.workbench_selection_separator());
    }
  } else if (!input.annotationMode && input.item) {
    const sample = getSampleItem(input.item.id);
    name = sample
      ? m.workbench_example_title({
          name: sample.item.title ?? sampleTypeLabel(input.item.id),
        })
      : input.item.title;
  }
  return name;
}

export function selectionViewTitle(input: {
  item: WorkbenchItemChoice | null;
  annotation?: AnnotationChoice | null;
  annotationMode: boolean;
  view: "preview" | "fields";
}): string {
  const name = selectionName(input);
  return name
    ? m.workbench_selection_title({
        name,
        view:
          input.view === "preview"
            ? m.workbench_view_preview()
            : m.workbench_view_fields(),
      })
    : input.view === "preview"
      ? m.profile_preview_name()
      : m.template_data_explorer_view_name();
}

export function updateSelectionTitle(view: ItemView): void {
  const text = view.getDisplayText();
  if (view.titleEl.textContent === text) return;
  view.titleEl.textContent = text;
  view.leaf.updateHeader();
}

/** A named set of choices; the heading labels the group for assistive technology. */
function SelectionGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const headingId = useId();
  return (
    <div role="group" aria-labelledby={headingId} className={selectionGroup}>
      <p id={headingId} className={selectionGroupHeading}>
        {label}
      </p>
      {children}
    </div>
  );
}

export function ItemSelectionList({
  lookup,
  onSelect,
  onSearch,
}: {
  lookup: ItemSearchDeps["lookup"];
  onSelect: (item: WorkbenchItemChoice) => void;
  onSearch: () => void;
}) {
  const [recent, setRecent] = useState<readonly WorkbenchItemChoice[]>([]);
  useEffect(() => {
    let active = true;
    void recentItemChoices(lookup).then((items) => {
      if (active) setRecent(items);
    });
    return () => {
      active = false;
    };
  }, [lookup]);
  return (
    <div className="zt-workbench-options zt:flex zt:min-w-0 zt:flex-col zt:gap-3 zt:p-3">
      <p className={selectionHint}>{m.workbench_choose_preview_data()}</p>
      <button className={selectionTrigger} onClick={onSearch}>
        <Icon name="search" />
        <span>{m.workbench_search_zotero()}</span>
      </button>
      <SelectionGroup label={m.workbench_sample_examples()}>
        {SAMPLE_ITEM_CHOICES.map((item) => (
          <button
            key={item.id}
            className={selectionOption}
            onClick={() => onSelect(item)}
          >
            <span>{sampleTypeLabel(item.id)}</span>
            {item.title && <span className={selectionHint}>{item.title}</span>}
          </button>
        ))}
      </SelectionGroup>
      {recent.length > 0 && (
        <SelectionGroup label={m.workbench_recently_updated()}>
          {recent.map((item) => (
            <button
              key={item.id}
              className={selectionOption}
              onClick={() => onSelect(item)}
            >
              {item.title}
            </button>
          ))}
        </SelectionGroup>
      )}
    </div>
  );
}

export function AnnotationSelectionList({
  current,
  onSelect,
  onSearch,
}: {
  current: readonly AnnotationChoice[];
  onSelect: (id: string) => void;
  onSearch: () => void;
}) {
  return (
    <div className="zt-workbench-options zt:flex zt:min-w-0 zt:flex-col zt:gap-3 zt:p-3">
      <p className={selectionHint}>{m.workbench_fields_choose_annotation()}</p>
      <button className={selectionTrigger} onClick={onSearch}>
        <Icon name="search" />
        <span>{m.workbench_choose_annotation()}</span>
      </button>
      {[
        {
          label: m.workbench_annotation_from_item(),
          values: current.slice(0, 3),
        },
        { label: m.workbench_sample_examples(), values: SAMPLE_ANNOTATIONS },
      ]
        .filter(({ values }) => values.length > 0)
        .map(({ label, values }) => (
          <SelectionGroup key={label} label={label}>
            {values.map((example) => (
              <button
                key={example.id}
                className={selectionOption}
                onClick={() => onSelect(example.id)}
              >
                {annotationOption(m, example).label}
              </button>
            ))}
          </SelectionGroup>
        ))}
    </div>
  );
}
