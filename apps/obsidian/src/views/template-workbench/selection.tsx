// Shared selection UI: Item and annotation lists, search, and labels.
import "./selection.css";
import type { ItemView } from "obsidian";

import { isPageNumber } from "@zotlit/db";
import { useUniqueId } from "@zotlit/ui";
import { SAMPLE_ANNOTATIONS } from "@zotlit/workbench/render";
import type { AnnotationExample } from "@zotlit/workbench/render";
import { annotationOption } from "@zotlit/workbench/ui";
import type { WorkbenchItemChoice } from "@zotlit/workbench/ui";

import { Icon } from "@/components/obsidian/icon";
import { selectionControl } from "@/components/obsidian/selection-control";
import { DOCS_SITE_URL } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";
import * as workbenchM from "@/lib/i18n/generated/workbench-messages";

import { useRecentItems } from "./item-choice";
import {
  getSampleItem,
  getSampleItemType,
  SAMPLE_ITEM_CHOICES,
} from "./selection-data";
import {
  selectionGroup,
  selectionGroupHeading,
  selectionHint,
  selectionList,
  selectionOptionContent,
  selectionOptionLabel,
  selectionSearch,
  selectionSearchContent,
} from "./theme";

type AnnotationChoice = Pick<AnnotationExample, "id" | "root">;

const selectionOption = selectionControl({ kind: "option" });

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
        typeof root.pageLabel !== "string" || !root.pageLabel
          ? null
          : isPageNumber(root.pageLabel)
            ? m.workbench_annotation_page({ page: root.pageLabel })
            : root.pageLabel,
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
  view: "fields";
}): string {
  const name = selectionName(input);
  return name
    ? m.workbench_selection_title({ name, view: m.workbench_view_fields() })
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
  const headingId = useUniqueId();
  return (
    <div role="group" aria-labelledby={headingId} className={selectionGroup}>
      <p id={headingId} className={selectionGroupHeading}>
        {label}
      </p>
      <div className={selectionList}>{children}</div>
    </div>
  );
}

/** The one control that leaves the examples behind for the user's own library. */
function SelectionSearch({
  label,
  onSearch,
}: {
  label: string;
  onSearch: () => void;
}) {
  return (
    <button className={selectionSearch} onClick={onSearch}>
      <span className={selectionSearchContent}>
        <Icon name="search" />
        <span className="zt:min-w-0 zt:truncate">{label}</span>
      </span>
    </button>
  );
}

/** A choice in a boxed list; its content owns the box the row hands over. */
function SelectionOption({
  onSelect,
  children,
}: {
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button className={selectionOption} onClick={onSelect}>
      <span className={selectionOptionContent}>{children}</span>
    </button>
  );
}

export function ItemSelectionList({
  onSelect,
  onSearch,
}: {
  onSelect: (item: WorkbenchItemChoice) => void;
  onSearch: () => void;
}) {
  const recent = useRecentItems();
  return (
    <div className="zt-workbench-options zt:flex zt:min-w-0 zt:flex-col zt:gap-4 zt:p-3">
      <div className="zt:flex zt:min-w-0 zt:flex-col zt:gap-2">
        <p className={selectionHint}>
          {m.workbench_choose_preview_data()}{" "}
          <a
            className="external-link"
            href={`${DOCS_SITE_URL}/docs/how-to/explore-template-data`}
            target="_blank"
            rel="noreferrer"
          >
            {m.template_data_explorer_docs()}
          </a>
        </p>
        <SelectionSearch
          label={m.workbench_search_zotero()}
          onSearch={onSearch}
        />
      </div>
      <SelectionGroup label={m.workbench_sample_examples()}>
        {SAMPLE_ITEM_CHOICES.map((item) => (
          <SelectionOption key={item.id} onSelect={() => onSelect(item)}>
            <span className={selectionOptionLabel}>
              {sampleTypeLabel(item.id)}
            </span>
            {item.title && <span className={selectionHint}>{item.title}</span>}
          </SelectionOption>
        ))}
      </SelectionGroup>
      {recent.length > 0 && (
        <SelectionGroup label={m.workbench_recently_updated()}>
          {recent.map((item) => (
            <SelectionOption key={item.id} onSelect={() => onSelect(item)}>
              <span className={selectionOptionLabel}>{item.title}</span>
            </SelectionOption>
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
    <div className="zt-workbench-options zt:flex zt:min-w-0 zt:flex-col zt:gap-4 zt:p-3">
      <div className="zt:flex zt:min-w-0 zt:flex-col zt:gap-2">
        <p className={selectionHint}>
          {m.workbench_fields_choose_annotation()}
        </p>
        <SelectionSearch
          label={m.workbench_choose_annotation()}
          onSearch={onSearch}
        />
      </div>
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
              <SelectionOption
                key={example.id}
                onSelect={() => onSelect(example.id)}
              >
                <span className={selectionOptionLabel}>
                  {annotationOption(workbenchM, example).label}
                </span>
              </SelectionOption>
            ))}
          </SelectionGroup>
        ))}
    </div>
  );
}
