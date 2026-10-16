// "Configure view": the name, the rows and the Layout of one view of a
// Query File, and the options of its Layout, as the view menu's page for that
// view shows them. Each change saves to the file at once; a typed name saves
// when its field loses focus.
import { useStore } from "zustand";

import {
  Chooser,
  useChooserPageSave,
  useChooserPageText,
} from "@/components/chooser";
import type { ChooserPageMenuItem } from "@/components/chooser";
import { Dropdown, DropdownItem } from "@/components/obsidian/dropdown";
import { Slider } from "@/components/obsidian/slider";
import { Toggle } from "@/components/obsidian/toggle";
import * as m from "@/lib/i18n/generated/messages";

import { CardsLayoutFields, cardsLayoutOptions } from "./cards-layout";
import { DATASETS } from "./datasets";
import { annotationsLayoutOptions, CARD_WIDTH, layoutsFor } from "./layouts";
import type { AnnotationsLayoutOptions } from "./layouts";
import { ListLayoutFields, listLayoutOptions } from "./list-layout";
import { QUERY_FILE_DATASETS } from "./query-file";
import type { QueryFileDataset } from "./query-file";
import type { QueryView } from "./view";
import { VIEW_NAME_RESERVED, viewNameIssue } from "./view-edits";
import type { ViewNameIssue } from "./view-edits";

function issueText(issue: ViewNameIssue): string {
  switch (issue) {
    case "empty":
      return m.query_view_name_empty();
    case "taken":
      return m.query_view_name_taken();
    case "invalid":
      return m.query_view_name_invalid({
        characters: VIEW_NAME_RESERVED.join(" "),
      });
    default:
      issue satisfies never;
      return "";
  }
}

/** The per-view actions, for the menu of "Configure view". */
export function viewActions({
  view,
  index,
  after,
}: {
  view: QueryView;
  index: number;
  after?: { duplicated?: (name: string) => void; deleted?: () => void };
}): ChooserPageMenuItem[] {
  const file = view.state.getState().file;
  if (!file || index < 0) return [];
  return [
    {
      title: m.query_view_default_view(),
      icon: "layers-2",
      checked: index === 0,
      hook: "default",
      onSelect: () => view.document.moveView(index, 0),
    },
    {
      title: m.query_view_duplicate_view(),
      icon: "files",
      hook: "duplicate",
      onSelect: () => {
        view.document.duplicateView(index);
        const name = view.viewName;
        if (name !== null) after?.duplicated?.(name);
      },
    },
    {
      title: m.query_view_delete_view(),
      icon: "trash-2",
      warning: true,
      disabled: file.views.length <= 1,
      hook: "delete",
      onSelect: () => {
        view.document.deleteView(index);
        after?.deleted?.();
      },
    },
  ];
}

/**
 * The fields of "Configure view" for one view, as the view menu's page shows
 * them. `name` names the view; a rename here reports the new name through
 * `onRenamed`, so the page follows the view.
 */
export function ConfigureViewFields({
  view,
  name,
  onRenamed,
}: {
  view: QueryView;
  name: string;
  onRenamed: (name: string) => void;
}) {
  const file = useStore(view.state, (s) => s.file);
  const index = file?.views.findIndex((shown) => shown.name === name) ?? -1;
  const shown = file?.views[index];
  const [draft, setDraft, typed] = useChooserPageText(name);
  const issue = file && index >= 0 ? viewNameIssue(file, index, draft) : null;
  const rename = () => {
    const now = view.state.getState().file;
    const at = now?.views.findIndex((candidate) => candidate.name === name);
    const next = typed.current.trim();
    if (!now || at === undefined || at < 0 || next === name) return;
    if (viewNameIssue(now, at, next) !== null) return;
    view.document.renameView(at, next);
    onRenamed(next);
  };
  useChooserPageSave(rename);
  if (!shown) return null;
  const set = (key: string, value: unknown) =>
    view.document.setViewOption(index, key, value);
  return (
    <>
      <Chooser.PageField
        label={m.query_view_view_name()}
        description={issue && issueText(issue)}
        invalid={issue !== null}
      >
        <input
          type="text"
          value={draft}
          spellCheck={false}
          aria-invalid={issue !== null}
          data-query-view-name=""
          onInput={(event) => setDraft(event.currentTarget.value)}
          onBlur={rename}
        />
      </Chooser.PageField>
      <Chooser.PageField
        label={m.query_view_dataset()}
        description={m.query_view_dataset_desc()}
      >
        <Dropdown
          value={shown.from ?? "annotations"}
          data-query-view-dataset=""
          onChange={(dataset) =>
            view.document.setViewDataset(index, dataset as QueryFileDataset)
          }
        >
          {QUERY_FILE_DATASETS.map((dataset) => (
            <DropdownItem key={dataset} value={dataset}>
              {DATASETS[dataset].name()}
            </DropdownItem>
          ))}
        </Dropdown>
      </Chooser.PageField>
      <Chooser.PageField label={m.query_view_layout()}>
        <Dropdown
          value={shown.type}
          data-query-view-layout=""
          onChange={(type) => view.document.setViewLayout(index, type)}
        >
          {layoutsFor(shown).map((layout) => (
            <DropdownItem key={layout.type} value={layout.type}>
              {layout.name()}
            </DropdownItem>
          ))}
        </Dropdown>
      </Chooser.PageField>
      {shown.type === "annotations" && (
        <AnnotationsLayoutFields
          options={annotationsLayoutOptions(shown)}
          set={set}
        />
      )}
      {shown.type === "list" && (
        <ListLayoutFields options={listLayoutOptions(shown)} set={set} />
      )}
      {shown.type === "cards" && (
        <CardsLayoutFields options={cardsLayoutOptions(shown)} set={set} />
      )}
    </>
  );
}

/** The Annotations layout's options in "Configure view". */
function AnnotationsLayoutFields({
  options,
  set,
}: {
  options: AnnotationsLayoutOptions;
  set: (key: keyof AnnotationsLayoutOptions, value: unknown) => void;
}) {
  return (
    <>
      <Chooser.PageField label={m.query_view_card_width()}>
        <Slider
          value={options.cardWidth}
          min={CARD_WIDTH.min}
          max={CARD_WIDTH.max}
          step={CARD_WIDTH.step}
          instant
          dynamicTooltip
          data-query-view-option="cardWidth"
          onChange={(value) => set("cardWidth", value)}
        />
      </Chooser.PageField>
      {(
        [
          ["showComment", m.query_view_show_comment()],
          ["showTags", m.query_view_show_tags()],
          ["showPage", m.query_view_show_page()],
        ] as const
      ).map(([key, label]) => (
        <Chooser.PageField key={key} label={label} inline>
          <span className="zt:flex" data-query-view-option={key}>
            <Toggle
              value={options[key]}
              aria-label={label}
              onChange={(value) => set(key, value)}
            />
          </span>
        </Chooser.PageField>
      ))}
    </>
  );
}
