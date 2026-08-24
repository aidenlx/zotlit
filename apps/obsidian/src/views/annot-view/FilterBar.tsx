// Top filter bar: swatches, first tag chip, tag-vocabulary trigger, count/clear
// cluster; toggles an inline tag-cloud panel rendered directly beneath it.
import { useMemo } from "react";

import { annotationColorToName } from "@zotlit/db";
import type { AnnotationColorName } from "@zotlit/db";

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
  useToggleSelectedColor,
  useToggleSelectedTagID,
  useTogglePanel,
} from "./store";
import { tagChipVariants } from "./tag-chip";

const COLOR_MESSAGE: Record<AnnotationColorName, () => string> = {
  yellow: m.annot_view_color_yellow,
  red: m.annot_view_color_red,
  green: m.annot_view_color_green,
  blue: m.annot_view_color_blue,
  purple: m.annot_view_color_purple,
  magenta: m.annot_view_color_magenta,
  orange: m.annot_view_color_orange,
  gray: m.annot_view_color_gray,
  plum: m.annot_view_color_plum,
};

/** Color name for a swatch tooltip; falls back to the raw hex for colors outside the reader/Citavi palette. */
function colorLabel(hex: string): string {
  const name = annotationColorToName(hex);
  return name ? COLOR_MESSAGE[name]() : hex;
}

export function FilterBar() {
  const annotations = useAnnotStore((s) => s.annotations);
  const panelOpen = useAnnotStore((s) => s.panelOpen);
  const selectedColors = useAnnotStore((s) => s.selectedColors);
  const clearFilters = useClearFilters();
  const togglePanel = useTogglePanel();
  const toggleColor = useToggleSelectedColor();
  const toggleTag = useToggleSelectedTagID();

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
  const selectedTagCount = filter.tagIDs.length;
  const vocabSize = tagChips.length;

  if (!annotations || annotations.length === 0) return null;

  return (
    <>
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
              <TagsTrigger
                selectedCount={selectedTagCount}
                vocabSize={vocabSize}
                panelOpen={panelOpen}
                onToggle={togglePanel}
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
      {panelOpen && (
        <div className="zt:max-h-57.5 zt:shrink-0 zt:overflow-y-auto zt:border-b zt:border-border zt:bg-popover zt:px-3 zt:py-2">
          <div className="zt:flex zt:flex-wrap zt:gap-1">
            {tagChips.map((chip) => (
              <TagPill
                key={chip.tagID}
                chip={chip}
                onToggle={toggleTag}
                dense
              />
            ))}
          </div>
        </div>
      )}
    </>
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
    <div className="zt:flex zt:shrink-0 zt:flex-wrap zt:items-center zt:gap-1.5">
      {colors.map((hex) => {
        const selected = selectedColors.includes(hex);
        return (
          <span
            key={hex}
            aria-pressed={selected}
            className={cn(
              "zt:shrink-0 zt:cursor-pointer zt:rounded-sm zt:ring-offset-1 zt:ring-offset-background zt:motion-safe:transition-shadow",
              small ? "zt:size-3" : "zt:size-4",
              selected && "zt:ring-2 zt:ring-primary",
            )}
            style={{ backgroundColor: hex }}
            {...activatable(() => onToggle(hex))}
            {...tooltipAttrs(colorLabel(hex))}
          />
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
  onToggle: (tagID: number) => void;
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
      {...activatable(() => onToggle(chip.tagID), { disabled })}
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
 * Dashed action chip that opens/closes the tag panel. Counting (k = selected
 * tag count ≥ 2) shows "+{k-1}" in accent styling; otherwise shows "+{n-1}"
 * (n = vocabulary size) in muted styling. Never shrinks or wraps.
 */
function TagsTrigger({
  selectedCount,
  vocabSize,
  panelOpen,
  onToggle,
}: {
  selectedCount: number;
  vocabSize: number;
  panelOpen: boolean;
  onToggle: () => void;
}) {
  const counting = selectedCount >= 2;
  const count = counting ? selectedCount - 1 : vocabSize - 1;
  const ariaLabel = counting
    ? m.annot_view_filter_trigger_selected({ count })
    : m.annot_view_filter_trigger_show_all();

  return (
    <span
      aria-expanded={panelOpen}
      data-counting={counting ? "" : undefined}
      className={cn(
        // Shares the tag pills' radius, but stays a dashed *action* chip — a solid
        // 1px border and muted fill keep it distinct from the native data chips.
        "zt:inline-flex zt:shrink-0 zt:cursor-pointer zt:items-center zt:gap-0.75 zt:rounded-(--tag-radius) zt:border zt:border-dashed zt:border-border zt:bg-background zt:px-2.5 zt:py-0.5 zt:text-xs zt:whitespace-nowrap zt:text-muted-foreground",
        "zt:data-counting:border-primary zt:data-counting:bg-[color-mix(in_srgb,var(--interactive-accent)_12%,var(--background-primary))] zt:data-counting:text-accent-foreground",
      )}
      {...activatable(onToggle)}
      {...tooltipAttrs(ariaLabel)}
    >
      +{count}
      <svg
        width="8"
        height="8"
        viewBox="0 0 8 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        data-open={panelOpen ? "" : undefined}
        className="zt:duration-150 zt:data-open:rotate-180 zt:motion-safe:transition-transform"
      >
        <path d="M1.5 3 4 5.5 6.5 3" />
      </svg>
    </span>
  );
}

function ClearLink({ onClear }: { onClear: () => void }) {
  return (
    <span
      className="zt:cursor-pointer zt:text-xs zt:text-accent-foreground zt:hover:underline"
      {...activatable(onClear)}
    >
      {m.annot_view_filter_clear()}
    </span>
  );
}
