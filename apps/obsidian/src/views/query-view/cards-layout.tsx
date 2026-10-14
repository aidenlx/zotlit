// The Cards layout: one card for each row of any Query Dataset, as the Cards
// layout of Bases draws a note. The first visible property is the card's
// title; each other one shows under its name. Its option is `cardSize`, the
// narrowest a card is drawn, as in Bases 1.14.4.
import { Setting } from "obsidian";
import type { CSSProperties } from "react";
import { useStore } from "zustand";

import * as m from "@/lib/i18n/generated/messages";

import type { QueryLayout } from "./layouts";
import type { QueryFileView } from "./query-file";
import { RecordGroupHeading, useRecordGroups } from "./record-rows";
import { propertyLabel } from "./table-layout";
import type { QueryView } from "./view";

export const CARDS_LAYOUT: QueryLayout = {
  type: "cards",
  datasets: ["annotations", "attachments", "items"],
  name: () => m.query_view_layout_cards(),
  icon: "layout-grid",
};

/** The card size of Bases: the narrowest a card is drawn, in pixels. */
export const CARD_SIZE = { min: 50, max: 800, step: 10, default: 200 };

export interface CardsLayoutOptions {
  readonly cardSize: number;
}

/** The Cards layout's options a view holds; a key it lacks or cannot hold takes its default. */
export function cardsLayoutOptions(
  view: QueryFileView | null,
): CardsLayoutOptions {
  const size = view?.source.cardSize;
  return {
    cardSize:
      typeof size === "number" && Number.isFinite(size) && size > 0
        ? Math.min(CARD_SIZE.max, Math.max(CARD_SIZE.min, size))
        : CARD_SIZE.default,
  };
}

/** The Cards layout's options in "Configure view". */
export function addCardsOptions(
  el: HTMLElement,
  options: CardsLayoutOptions,
  set: (key: keyof CardsLayoutOptions, value: unknown) => void,
): void {
  new Setting(el).setName(m.query_view_card_size()).addSlider((slider) => {
    slider.sliderEl.dataset.queryViewOption = "cardSize";
    slider
      .setLimits(CARD_SIZE.min, CARD_SIZE.max, CARD_SIZE.step)
      .setValue(options.cardSize)
      .setDynamicTooltip()
      .setInstant(true)
      .onChange((value) => set("cardSize", value));
  });
}

/** The rows of the shown view, one card each, under their group headings. */
export function CardsLayout({ view }: { view: QueryView }) {
  const { properties, groups } = useRecordGroups(view);
  const options = cardsLayoutOptions(useStore(view.state, (s) => s.view));
  const file = useStore(view.state, (s) => s.file);
  return (
    <div
      className="zt:min-h-0 zt:flex-1 zt:overflow-auto zt:px-3 zt:pt-1 zt:pb-11"
      data-query-layout="cards"
    >
      {groups.map((group, groupIndex) => (
        <section key={`${groupIndex}\n${group.key ?? ""}`}>
          <RecordGroupHeading group={group} />
          {!group.collapsed && (
            <div
              role="list"
              className="zt:grid zt:grid-cols-[repeat(auto-fill,minmax(min(100%,var(--zt-card-size)),1fr))] zt:items-start zt:gap-2 zt:py-1"
              style={
                {
                  "--zt-card-size": `${options.cardSize}px`,
                } as CSSProperties
              }
              data-card-size={options.cardSize}
            >
              {group.rows.map(({ row, cells }, index) => {
                const [title = "", ...rest] = cells;
                return (
                  <div
                    key={`${row.indexedKey}\n${index}`}
                    role="listitem"
                    className="zt:flex zt:min-w-0 zt:flex-col zt:gap-1 zt:rounded-(--radius-m) zt:bg-(--background-primary) zt:p-2 zt:text-sm zt:shadow-[0_0_0_1px_var(--background-modifier-border)]"
                    data-query-row={row.indexedKey}
                  >
                    <div className="zt:truncate zt:font-semibold">{title}</div>
                    {rest.map((text, at) => (
                      <div key={properties[at + 1]} className="zt:min-w-0">
                        <div className="zt:truncate zt:text-xs zt:text-(--text-faint)">
                          {propertyLabel(file, properties[at + 1]!)}
                        </div>
                        <div className="zt:truncate">{text}</div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
