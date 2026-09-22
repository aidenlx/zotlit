// Top filter bar: colour trigger, first tag chip, tag-vocabulary trigger,
// count/clear cluster; each trigger opens its vocabulary in a Chooser anchored
// under it.
import { useCallback, useMemo } from "react";

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
  // One derived colour is already worth a trigger: ticking it hides every
  // annotation that carries no colour. The tag trigger asks for two because
  // its first chip stands beside it, so a vocabulary of one is fully shown
  // already; every colour lives inside the Chooser instead.
  const paletteSize = swatchColors.length;

  if (!annotations || annotations.length === 0) return null;

  return (
    <div className="zt:flex zt:min-h-7 zt:shrink-0 zt:items-start zt:gap-2 zt:border-b zt:border-border zt:px-3 zt:py-1">
      {/* Wrappable zone: swatches, divider, first chip, trigger wrap among
            themselves when space runs out. The count/Clear cluster below sits
            outside this zone so it never joins the wrap. */}
      <div className="zt:flex zt:min-w-0 zt:flex-1 zt:flex-wrap zt:items-center zt:gap-2">
        {paletteSize >= 1 && (
          <ColorChooser
            colors={swatchColors}
            selectedColors={selectedColors}
            onToggle={toggleColor}
          />
        )}
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

/**
 * The dashed action chip both filter triggers wear. A solid 1px border and a
 * muted fill keep it distinct from the native data chips beside it; the
 * counting state swaps in accent styling, so an active filter is readable
 * without opening it.
 */
const filterTriggerChip = cn(
  "zt:inline-flex zt:shrink-0 zt:cursor-pointer zt:items-center zt:gap-0.75 zt:rounded-(--tag-radius) zt:border zt:border-dashed zt:border-border zt:bg-background zt:px-2.5 zt:py-0.5 zt:text-xs zt:whitespace-nowrap zt:text-muted-foreground zt:focus-visible:ring-2 zt:focus-visible:ring-border-focus",
  "zt:data-counting:border-primary zt:data-counting:bg-[color-mix(in_srgb,var(--interactive-accent)_12%,var(--background-primary))] zt:data-counting:text-accent-foreground",
);

/** The chip's disclosure arrow; it turns over while its Chooser stands open. */
function TriggerChevron() {
  return (
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
  );
}

/** The caller's `className` sets the box; `hex` only fills it. */
function Swatch({ hex, className }: { hex: string; className?: string }) {
  return (
    <span
      className={cn(
        "zt:inline-block zt:shrink-0 zt:rounded-sm zt:bg-(--zt-swatch-color) zt:ring-1 zt:ring-border",
        className,
      )}
      style={{ "--zt-swatch-color": hex } as React.CSSProperties}
    />
  );
}

/**
 * The colours present in the annotations, in a Chooser hanging under the same
 * dashed action chip the tag filter uses. It carries no search field: a
 * palette is read by sight, so each row is the swatch alone and the tick
 * beside it carries the selected state.
 *
 * With no search field, the surface stands on the other half of ADR 0044's
 * carve-out: colours are ticked several at a time, and an Obsidian `Menu`
 * closes on the first click, so the popup a multi-tick gesture needs is one
 * `Menu` cannot hold.
 * @see apps/obsidian/docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md
 */
function ColorChooser({
  colors,
  selectedColors,
  onToggle,
}: {
  colors: readonly string[];
  selectedColors: readonly string[];
  onToggle: (color: string) => void;
}) {
  const counting = selectedColors.length > 0;
  const ariaLabel = counting
    ? m.annot_view_filter_color_trigger_selected({
        count: selectedColors.length,
      })
    : m.annot_view_filter_color_trigger_show_all();

  const rows = useMemo(
    () =>
      colors.map((hex) => ({ value: hex, label: annotationColorLabel(hex) })),
    [colors],
  );

  // The chip wears the selection in the palette order the rows keep, so the
  // same filter reads the same way whatever order its colours were ticked in.
  const selectedSwatches = useMemo(
    () => colors.filter((hex) => selectedColors.includes(hex)),
    [colors, selectedColors],
  );

  // The Chooser reports the whole selection a tick leaves behind, while the
  // store toggles one colour at a time. The single entry the two lists
  // disagree on is the colour that was ticked, so the existing store action
  // is reached without a second one beside it.
  const onValueChange = useCallback(
    (next: readonly string[]) => {
      const changed =
        next.find((hex) => !selectedColors.includes(hex)) ??
        selectedColors.find((hex) => !next.includes(hex));
      if (changed !== undefined) onToggle(changed);
    },
    [selectedColors, onToggle],
  );

  return (
    <Chooser value={selectedColors} onValueChange={onValueChange}>
      <Chooser.Trigger
        data-counting={counting ? "" : undefined}
        className={filterTriggerChip}
        {...tooltipAttrs(ariaLabel)}
      >
        {/* A fixed 1rem-tall content box, so a chip of glyphs stands the same
            height as the tag chip beside it, whose height a line box sets. */}
        <span className="zt:flex zt:h-4 zt:items-center zt:gap-0.5">
          {counting ? (
            selectedSwatches.map((hex) => (
              <Swatch key={hex} hex={hex} className="zt:size-3" />
            ))
          ) : (
            <Icon name="palette" size={12} />
          )}
        </span>
        <TriggerChevron />
      </Chooser.Trigger>
      <Chooser.Popup className="zt:min-w-40">
        <Chooser.List
          items={rows}
          emptyLabel={m.annot_view_filter_color_empty()}
        >
          {(row) => (
            <Chooser.Item
              key={row.value}
              value={row.value}
              {...tooltipAttrs(row.label)}
            >
              <Swatch hex={row.value} className="zt:h-4 zt:w-24" />
            </Chooser.Item>
          )}
        </Chooser.List>
      </Chooser.Popup>
    </Chooser>
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
        className={filterTriggerChip}
        {...tooltipAttrs(ariaLabel)}
      >
        {counting ? <Icon name="filter" size={10} /> : "+"}
        {count}
        <TriggerChevron />
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
