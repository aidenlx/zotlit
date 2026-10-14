// "Configure view": the name, the rows and the Layout of one view of a
// Query File, and the options of its Layout. Each change saves to the file at
// once; a typed name saves after a short wait.
import { Menu, Modal, Setting } from "obsidian";
import type { App, TextComponent } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";

import { addCardsOptions, cardsLayoutOptions } from "./cards-layout";
import { DATASETS } from "./datasets";
import { annotationsLayoutOptions, CARD_WIDTH, layoutsFor } from "./layouts";
import type { AnnotationsLayoutOptions } from "./layouts";
import { addListOptions, listLayoutOptions } from "./list-layout";
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

/** The per-view actions, for the row's right-click and "Configure view". */
export function addViewActions(
  menu: Menu,
  {
    view,
    index,
    after,
  }: {
    view: QueryView;
    index: number;
    after?: { duplicated?: (name: string) => void; deleted?: () => void };
  },
): void {
  const file = view.state.getState().file;
  if (!file) return;
  menu
    .addItem((item) =>
      item
        .setTitle(m.query_view_default_view())
        .setIcon("layers-2")
        .setChecked(index === 0)
        .onClick(() => view.document.moveView(index, 0)),
    )
    .addItem((item) =>
      item
        .setTitle(m.query_view_duplicate_view())
        .setIcon("files")
        .onClick(() => {
          view.document.duplicateView(index);
          const name = view.viewName;
          if (name !== null) after?.duplicated?.(name);
        }),
    )
    .addSeparator()
    .addItem((item) =>
      item
        .setTitle(m.query_view_delete_view())
        .setIcon("trash-2")
        .setWarning(true)
        .setDisabled(file.views.length <= 1)
        .onClick(() => {
          view.document.deleteView(index);
          after?.deleted?.();
        }),
    );
}

/** The view "Configure view" opens on, and whether its name is selected to type over. */
export interface ConfigureViewTarget {
  name: string;
  focusName?: boolean;
}

export class ConfigureViewModal extends Modal {
  readonly #view: QueryView;
  /** The name of the view this configures, which a rename moves. */
  #name: string;
  readonly #focusName: boolean;

  constructor(
    app: App,
    view: QueryView,
    { name, focusName = false }: ConfigureViewTarget,
  ) {
    super(app);
    this.#view = view;
    this.#name = name;
    this.#focusName = focusName;
  }

  /** The view's place in the file now; `-1` once it is gone. */
  #index(): number {
    const file = this.#view.state.getState().file;
    return file?.views.findIndex((view) => view.name === this.#name) ?? -1;
  }

  override onOpen(): void {
    this.modalEl.addClass("zt-configure-view");
    this.setTitle(m.query_view_configure_view());
    this.#display(this.#focusName);
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  #display(focusName = false): void {
    const { contentEl } = this;
    contentEl.empty();
    const index = this.#index();
    const file = this.#view.state.getState().file;
    const view = file?.views[index];
    if (!file || !view) {
      this.close();
      return;
    }

    let name: TextComponent | null = null;
    const nameRow = new Setting(contentEl)
      .setName(m.query_view_view_name())
      .addText((text) => {
        name = text;
        text.setValue(view.name);
        text.inputEl.dataset.queryViewName = "";
        const check = () => {
          const now = this.#view.state.getState().file ?? file;
          const issue = viewNameIssue(now, this.#index(), text.getValue());
          nameRow.setDesc(issue ? issueText(issue) : "");
          nameRow.descEl.toggleClass("mod-warning", issue !== null);
          return issue;
        };
        text.onChange(() => check());
        const commit = () => {
          const next = text.getValue().trim();
          if (next === this.#name || check() !== null) return;
          this.#view.document.renameView(this.#index(), next);
          this.#name = next;
        };
        text.inputEl.addEventListener("blur", commit);
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.isComposing || event.key !== "Enter") return;
          event.preventDefault();
          commit();
        });
      })
      .addExtraButton((button) =>
        button
          .setIcon("more-vertical")
          .setTooltip(m.query_view_more_options())
          .onClick(() => {
            const menu = new Menu();
            addViewActions(menu, {
              view: this.#view,
              index: this.#index(),
              after: {
                duplicated: (copy) => {
                  this.#name = copy;
                  this.#display();
                },
                deleted: () => this.close(),
              },
            });
            menu.showAtPosition(
              {
                x: button.extraSettingsEl.getBoundingClientRect().left,
                y: button.extraSettingsEl.getBoundingClientRect().bottom,
              },
              button.extraSettingsEl.doc,
            );
          }),
      );

    new Setting(contentEl)
      .setName(m.query_view_dataset())
      .setDesc(m.query_view_dataset_desc())
      .addDropdown((dropdown) => {
        for (const dataset of QUERY_FILE_DATASETS)
          dropdown.addOption(dataset, DATASETS[dataset].name());
        dropdown.selectEl.dataset.queryViewDataset = "";
        dropdown.setValue(view.from ?? "annotations").onChange((value) => {
          this.#view.document.setViewDataset(
            this.#index(),
            value as QueryFileDataset,
          );
          this.#display();
        });
      });

    const layouts = layoutsFor(view);
    new Setting(contentEl)
      .setName(m.query_view_layout())
      .addDropdown((dropdown) => {
        for (const layout of layouts)
          dropdown.addOption(layout.type, layout.name());
        dropdown.selectEl.dataset.queryViewLayout = "";
        dropdown.setValue(view.type).onChange((type) => {
          this.#view.document.setViewLayout(this.#index(), type);
          this.#display();
        });
      });

    const set = (key: string, value: unknown) =>
      this.#view.document.setViewOption(this.#index(), key, value);
    if (view.type === "annotations") this.#annotationsOptions(contentEl);
    else if (view.type === "list")
      addListOptions(contentEl, listLayoutOptions(view), {
        set,
        redraw: () => this.#display(),
      });
    else if (view.type === "cards")
      addCardsOptions(contentEl, cardsLayoutOptions(view), set);
    if (focusName) (name as TextComponent | null)?.inputEl.select();
  }

  #annotationsOptions(el: HTMLElement): void {
    const set = (key: keyof AnnotationsLayoutOptions, value: unknown) =>
      this.#view.document.setViewOption(this.#index(), key, value);
    const options = annotationsLayoutOptions(
      this.#view.state.getState().file?.views[this.#index()] ?? null,
    );
    new Setting(el).setName(m.query_view_card_width()).addSlider((slider) => {
      slider.sliderEl.dataset.queryViewOption = "cardWidth";
      slider
        .setLimits(CARD_WIDTH.min, CARD_WIDTH.max, CARD_WIDTH.step)
        .setValue(options.cardWidth)
        .setDynamicTooltip()
        .setInstant(true)
        .onChange((value) => set("cardWidth", value));
    });
    for (const [key, label] of [
      ["showComment", m.query_view_show_comment()],
      ["showTags", m.query_view_show_tags()],
      ["showPage", m.query_view_show_page()],
    ] as const) {
      new Setting(el).setName(label).addToggle((toggle) => {
        toggle.toggleEl.dataset.queryViewOption = key;
        toggle.setValue(options[key]).onChange((value) => set(key, value));
      });
    }
  }
}

/** Open "Configure view" on one view of the Query View's file. */
export function openConfigureView(
  app: App,
  view: QueryView,
  target: ConfigureViewTarget,
): ConfigureViewModal {
  const modal = new ConfigureViewModal(app, view, target);
  modal.open();
  return modal;
}
