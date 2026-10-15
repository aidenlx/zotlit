// The Cards layout: one card for each row of any Query Dataset, as the Cards
// layout of Bases draws a note. The first visible property is the card's
// title; each other one shows under its name. Its option is `cardSize`, the
// narrowest a card is drawn, as in Bases 1.14.4.
import { Setting } from "obsidian";
import type { CSSProperties } from "react";
import { useStore } from "zustand";

import * as m from "@/lib/i18n/generated/messages";
import { cn } from "@/lib/utils";

import type { QueryLayout } from "./layouts";
import type { QueryFileView } from "./query-file";
import {
  CellContent,
  RecordGroupHeading,
  useRecordGroups,
} from "./record-rows";
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

/**
 * One line of a card: the line height of a Bases card, and a dash where the
 * row has no value, so a blank property still holds its place.
 */
const CARD_LINE =
  "zt:truncate zt:leading-(--bases-cards-line-height) zt:empty:before:text-faint zt:empty:before:content-['—']";

/** The rows of the shown view, one card each, under their group headings. */
export function CardsLayout({ view }: { view: QueryView }) {
  const { properties, groups } = useRecordGroups(view);
  const options = cardsLayoutOptions(useStore(view.state, (s) => s.view));
  return (
    <div
      className="zt:min-h-0 zt:flex-1 zt:overflow-auto zt:px-3 zt:pt-3 zt:pb-11 zt:in-[.zt-query-note]:pb-3"
      data-query-layout="cards"
    >
      {groups.map((group, groupIndex) => (
        <section
          key={`${groupIndex}\n${group.key ?? ""}`}
          className={cn(
            group.key !== null &&
              "zt:border-b-(length:--border-width) zt:border-(--background-modifier-border) zt:pb-4",
          )}
        >
          <RecordGroupHeading group={group} />
          {!group.collapsed && (
            <div
              role="list"
              className="zt:grid zt:grid-cols-[repeat(auto-fill,minmax(min(100%,var(--zt-card-size)),1fr))] zt:items-start zt:gap-3 zt:py-1"
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
                    className="zt:flex zt:min-w-0 zt:flex-col zt:gap-2 zt:rounded-(--bases-cards-radius) zt:bg-(--bases-cards-background) zt:px-2 zt:pt-2 zt:pb-0.5 zt:shadow-(--bases-cards-shadow)"
                    data-query-row={row.indexedKey}
                  >
                    {/* A view that shows no property leaves the card
                        empty, as a Bases card is. */}
                    {properties.length > 0 && (
                      <div
                        className={cn(
                          "zt:text-base zt:font-[calc(var(--font-weight)+var(--bold-modifier))]",
                          CARD_LINE,
                        )}
                      >
                        <CellContent
                          value={row.values[properties[0]!.path]}
                          text={title}
                        />
                      </div>
                    )}
                    {rest.map((text, at) => (
                      <div
                        key={properties[at + 1]!.path}
                        className="zt:min-w-0"
                      >
                        <div className="zt:truncate zt:text-xs zt:text-muted-foreground">
                          {properties[at + 1]!.label}
                        </div>
                        {/* A value takes a Bases value's size, relative to
                            the host's text, so it stays below the title in
                            a note too. */}
                        <div
                          className={cn(
                            "zt:text-(length:--bases-table-font-size)",
                            CARD_LINE,
                          )}
                        >
                          <CellContent
                            value={row.values[properties[at + 1]!.path]}
                            text={text}
                          />
                        </div>
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
