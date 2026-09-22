// Top filter bar: swatches, first tag chip, tag-vocabulary trigger, count/clear
// cluster; the trigger opens the tag vocabulary in a Chooser anchored under it.
import { useMemo } from "react";

import { Chooser } from "@/components/chooser";
import { Icon } from "@/components/obsidian/icon";
import { annotationColorLabel } from "@/lib/annotation-colors";
import * as m from "@/lib/i18n/generated/messages";
import { activatable, cn, tooltipAttrs } from "@/lib/utils";

import {
  deriveSwatchColors,
  deriveTagChips,
  filterAnnotations,
  isFilterActive,
  pickFirstTagChip,
} from "./filter";
import type { TagChip } from "./filter";
import {
  useAnnotFilter,
  useAnnotStore,
  useClearFilters,
  useSetSelectedTags,
  useToggleSelectedColor,
  useToggleSelectedTag,
} from "./store";
import { tagChipVariants } from "./tag-chip";

export function FilterBar() {
  const annotations = useAnnotStore((s) => s.annotations);
  const selectedColors = useAnnotStore((s) => s.selectedColors);
  const clearFilters = useClearFilters();
  const toggleColor = useToggleSelectedColor();
  const toggleTag = useToggleSelectedTag();
  const setTags = useSetSelectedTags();

  const filter = useAnnotFilter();

  const swatchColors = useMemo(
    () => (annotations ? deriveSwatchColors(annotations) : []),
    [annotations],
  );
  const tagChips = useMemo(
    () => (annotations ? deriveTagChips(annotations, filter) : []),
    [annotations, filter],
  );
  const shown = useMemo(
    () => (annotations ? filterAnnotations(annotations, filter).length : 0),
    [annotations, filter],
  );
  const total = annotations?.length ?? 0;
  const active = isFilterActive(filter);

  const firstChip = pickFirstTagChip(tagChips);
  const vocabSize = tagChips.length;

  if (!annotations || annotations.length === 0) return null;

  return (
    <div className="zt:flex zt:min-h-7 zt:shrink-0 zt:items-start zt:gap-2 zt:border-b zt:border-border zt:px-3 zt:py-1">
      {/* Wrappable zone: swatches, divider, first chip, trigger wrap among
            themselves when space runs out. The count/Clear cluster below sits
            outside this zone so it never joins the wrap. */}
      <div className="zt:flex zt:min-w-0 zt:flex-1 zt:flex-wrap zt:items-center zt:gap-2">
        <SwatchRow
          colors={swatchColors}
          selectedColors={selectedColors}
          onToggle={toggleColor}
          small
        />
        {/* Hidden below the width band where the tag zone wraps onto its own
              line — a fixed-height rule there would dangle at the line break
              instead of separating two columns on one line. */}
        <span className="zt:hidden zt:h-4 zt:w-px zt:shrink-0 zt:self-center zt:bg-border zt:@sm:block" />
        <div className="zt:flex zt:min-w-0 zt:flex-auto zt:items-center zt:gap-1">
          {firstChip && (
            <TagPill chip={firstChip} onToggle={toggleTag} truncate />
          )}
          {vocabSize >= 2 && (
            <TagChooser
              chips={tagChips}
              selectedTags={filter.tags}
              onChange={setTags}
            />
          )}
        </div>
      </div>
      <div className="zt:flex zt:h-7 zt:shrink-0 zt:items-center zt:gap-2">
        <span className="zt:text-xs zt:whitespace-nowrap zt:text-muted-foreground">
          {m.annot_view_filter_count({ shown, total })}
        </span>
        {active && <ClearLink onClear={clearFilters} />}
      </div>
    </div>
  );
}

interface SwatchRowProps {
  colors: readonly string[];
  selectedColors: readonly string[];
  onToggle: (color: string) => void;
  small?: boolean;
}

function SwatchRow({
  colors,
  selectedColors,
  onToggle,
  small,
}: SwatchRowProps) {
  return (
    <div className="zt:flex zt:shrink-0 zt:flex-wrap zt:items-center">
      {colors.map((hex) => {
        const selected = selectedColors.includes(hex);
        return (
          // The box is the pointer target and the focus ring; the swatch
          // inside it is the colour. Fixing the box at 20x24 keeps six colours
          // in one compact strip — the row is `shrink-0`, so every pixel it
          // takes comes off the tag name beside it.
          <span
            key={hex}
            aria-pressed={selected}
            className="zt:flex zt:h-6 zt:w-5 zt:shrink-0 zt:cursor-pointer zt:items-center zt:justify-center zt:rounded-sm zt:focus-visible:ring-2 zt:focus-visible:ring-border-focus"
            {...activatable(() => onToggle(hex))}
            {...tooltipAttrs(annotationColorLabel(hex))}
          >
            <span
              className={cn(
                "zt:rounded-sm zt:ring-offset-1 zt:ring-offset-background zt:motion-safe:transition-shadow",
                "zt:bg-(--zt-swatch-color)",
                small ? "zt:size-3.5" : "zt:size-4",
                selected && "zt:ring-2 zt:ring-primary",
              )}
              style={{ "--zt-swatch-color": hex } as React.CSSProperties}
            />
          </span>
        );
      })}
    </div>
  );
}

function TagPill({
  chip,
  onToggle,
  truncate,
  dense,
}: {
  chip: TagChip;
  onToggle: (tag: string) => void;
  truncate?: boolean;
  dense?: boolean;
}) {
  const disabled = !chip.selected && !chip.available;
  const state = chip.selected ? "selected" : disabled ? "disabled" : "resting";
  return (
    <span
      aria-pressed={chip.selected}
      aria-disabled={disabled || undefined}
      className={tagChipVariants({
        state,
        density: dense ? "dense" : "comfortable",
        truncate,
      })}
      {...activatable(() => onToggle(chip.name), { disabled })}
      {...tooltipAttrs(
        m.annot_view_filter_tag_tooltip({
          name: chip.name,
          count: chip.hitCount,
        }),
      )}
    >
      {truncate ? (
        <span className="zt:block zt:max-w-27.5 zt:truncate">{chip.name}</span>
      ) : (
        chip.name
      )}
    </span>
  );
}

/**
 * The whole tag vocabulary, in a Chooser hanging under a dashed action chip.
 * Counting (k = selected tag count ≥ 2) shows a filter icon and k in accent
 * styling; otherwise shows "+{n-1}" (n = vocabulary size) in muted styling.
 * The two states carry two different meanings, so each one gets its own glyph
 * rather than its own colour. The chip never shrinks or wraps.
 */
function TagChooser({
  chips,
  selectedTags,
  onChange,
}: {
  chips: readonly TagChip[];
  selectedTags: readonly string[];
  onChange: (tags: string[]) => void;
}) {
  const selectedCount = selectedTags.length;
  const counting = selectedCount >= 2;
  const count = counting ? selectedCount : chips.length - 1;
  const ariaLabel = counting
    ? m.annot_view_filter_trigger_selected({ count })
    : m.annot_view_filter_trigger_show_all();

  // The Chooser matches on the label alone, so what a row needs beyond its
  // name travels with it rather than being looked up again while rendering.
  const rows = useMemo(
    () =>
      chips.map((chip) => ({
        value: chip.name,
        label: chip.name,
        hitCount: chip.hitCount,
        disabled: !chip.selected && !chip.available,
      })),
    [chips],
  );

  return (
    <Chooser value={selectedTags} onValueChange={onChange}>
      <Chooser.Trigger
        data-counting={counting ? "" : undefined}
        className={cn(
          // Shares the tag pills' radius, but stays a dashed *action* chip — a solid
          // 1px border and muted fill keep it distinct from the native data chips.
          "zt:inline-flex zt:shrink-0 zt:cursor-pointer zt:items-center zt:gap-0.75 zt:rounded-(--tag-radius) zt:border zt:border-dashed zt:border-border zt:bg-background zt:px-2.5 zt:py-0.5 zt:text-xs zt:whitespace-nowrap zt:text-muted-foreground zt:focus-visible:ring-2 zt:focus-visible:ring-border-focus",
          "zt:data-counting:border-primary zt:data-counting:bg-[color-mix(in_srgb,var(--interactive-accent)_12%,var(--background-primary))] zt:data-counting:text-accent-foreground",
        )}
        {...tooltipAttrs(ariaLabel)}
      >
        {counting ? <Icon name="filter" size={10} /> : "+"}
        {count}
        <svg
          width="8"
          height="8"
          viewBox="0 0 8 8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="zt:duration-150 zt:group-data-open:rotate-180 zt:motion-safe:transition-transform"
        >
          <path d="M1.5 3 4 5.5 6.5 3" />
        </svg>
      </Chooser.Trigger>
      <Chooser.Popup>
        <Chooser.Input
          placeholder={m.annot_view_filter_tag_search_placeholder()}
          clearLabel={m.annot_view_clear_search()}
        />
        <Chooser.List items={rows} emptyLabel={m.annot_view_filter_tag_empty()}>
          {(row) => (
            <Chooser.Item
              key={row.value}
              value={row.value}
              disabled={row.disabled}
              {...tooltipAttrs(
                m.annot_view_filter_tag_tooltip({
                  name: row.label,
                  count: row.hitCount,
                }),
              )}
            >
              {row.label}
            </Chooser.Item>
          )}
        </Chooser.List>
      </Chooser.Popup>
    </Chooser>
  );
}

function ClearLink({ onClear }: { onClear: () => void }) {
  return (
    <span
      className="zt:cursor-pointer zt:rounded-sm zt:text-xs zt:text-accent-foreground zt:hover:underline zt:focus-visible:ring-2 zt:focus-visible:ring-border-focus"
      {...activatable(onClear)}
    >
      {m.annot_view_filter_clear()}
    </span>
  );
}
