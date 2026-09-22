// The control row: colour and tag Choosers, the search toggle, and a trailing
// group carrying the count, Clear and collapse. One row of icon buttons under
// the header, its grouping carried by space rather than by a rule.
import { useMemo } from "react";
import type { Ref } from "react";

import { Chooser } from "@/components/chooser";
import type { ChooserGroup, ChooserRow } from "@/components/chooser-logic";
import { Icon } from "@/components/obsidian/icon";
import { IconButton } from "@/components/obsidian/icon-button";
import { annotationColorLabel } from "@/lib/annotation-colors";
import * as m from "@/lib/i18n/generated/messages";
import { runtime } from "@/lib/i18n/generated/runtime";
import { cn, tooltipAttrs } from "@/lib/utils";

import {
  cappedSelection,
  deriveSwatchColors,
  deriveTagChips,
  filterAnnotations,
  isFilterActive,
} from "./filter";
import type { TagChip } from "./filter";
import {
  useAnnotFilter,
  useAnnotStore,
  useClearFilters,
  useSetSelectedColors,
  useSetSelectedTags,
  useToggleSearchOpen,
  useToggleSelectedColor,
} from "./store";

/** How many colours the trigger draws before it starts counting instead. */
const COLOR_CAP = 3;

/** The tag trigger draws one name, however many tags the filter holds. */
const TAG_CAP = 1;

export interface FilterBarProps {
  /** The search bar the search toggle reveals, for `aria-controls`. */
  searchBarId: string;
  /** Where Escape in the search bar sends focus back to. */
  searchButtonRef: Ref<HTMLDivElement>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function FilterBar({
  searchBarId,
  searchButtonRef,
  collapsed,
  onToggleCollapsed,
}: FilterBarProps) {
  const annotations = useAnnotStore((s) => s.annotations);
  const selectedColors = useAnnotStore((s) => s.selectedColors);
  const searchOpen = useAnnotStore((s) => s.searchOpen);
  const clearFilters = useClearFilters();
  const toggleSearchOpen = useToggleSearchOpen();
  const toggleColor = useToggleSelectedColor();
  const setColors = useSetSelectedColors();
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

  if (!annotations || annotations.length === 0) return null;

  return (
    // The row's leading edge is the header button's: both sit in the same 8px
    // inline padding and both pull their first glyph 6px in, so the glyphs
    // share one edge.
    <div className="zt:flex zt:shrink-0 zt:items-center zt:px-2 zt:pt-1 zt:text-sm">
      {swatchColors.length >= 1 && (
        <ColorChooser
          colors={swatchColors}
          selectedColors={selectedColors}
          onToggle={toggleColor}
          onClear={() => setColors([])}
        />
      )}
      {tagChips.length >= 1 && (
        <TagChooser
          chips={tagChips}
          selectedTags={filter.tags}
          onChange={setTags}
        />
      )}
      <IconButton
        ref={searchButtonRef}
        icon="search"
        active={searchOpen}
        aria-expanded={searchOpen}
        aria-controls={searchBarId}
        onClick={toggleSearchOpen}
        {...tooltipAttrs(m.annot_view_search_tooltip())}
      />
      {/* `ms-auto` is the gap between the leading group and the trailing one:
          the row's grouping is space, never a rule. */}
      <div className="zt:ms-auto zt:flex zt:shrink-0 zt:items-center zt:gap-1">
        {active && (
          <span className="zt:whitespace-nowrap zt:text-muted-foreground zt:tabular-nums">
            {m.annot_view_filter_count({ shown, total })}
          </span>
        )}
        {active && (
          <IconButton
            icon="filter-x"
            onClick={clearFilters}
            {...tooltipAttrs(m.annot_view_clear_filters())}
          />
        )}
        <IconButton
          icon={collapsed ? "chevrons-up-down" : "chevrons-down-up"}
          onClick={onToggleCollapsed}
          {...tooltipAttrs(
            collapsed
              ? m.annot_view_expand_tooltip()
              : m.annot_view_collapse_tooltip(),
          )}
        />
      </div>
    </div>
  );
}

/**
 * The shape both Choosers hang under: Obsidian's own `clickable-icon` box, a
 * 16px glyph in 4px by 6px of padding, with the disclosure arrow after it.
 * The Chooser's stylesheet rolls its trigger back to the plugin's own layers,
 * which discards that box along with Obsidian's button rules, so the box is
 * drawn again here in utilities.
 */
const filterTrigger =
  "clickable-icon zt:inline-flex zt:shrink-0 zt:items-center zt:gap-0.5 zt:rounded-(--clickable-icon-radius) zt:px-1.5 zt:py-1 zt:text-muted-foreground zt:hover:bg-muted zt:hover:text-foreground zt:focus-visible:ring-2 zt:focus-visible:ring-border-focus zt:focus-visible:outline-none zt:data-open:bg-muted zt:data-open:text-foreground";

/**
 * The trigger's disclosure arrow, at the `--icon-xs` Obsidian gives the
 * auxiliary arrow of its own text-icon buttons; it turns over while its
 * Chooser stands open.
 */
function TriggerChevron() {
  return (
    <Icon
      name="chevron-down"
      size="var(--icon-xs)"
      className="zt:duration-150 zt:group-data-open:rotate-180 zt:motion-safe:transition-transform"
    />
  );
}

/** What a trigger's cap leaves out, counted beside what it draws. */
function HiddenCount({ count }: { count: number }) {
  return (
    <span className="zt:tabular-nums">
      {m.annot_view_filter_more_count({ count })}
    </span>
  );
}

/** The caller's `className` sets the box; `hex` only fills it. */
function Swatch({ hex, className }: { hex: string; className?: string }) {
  return (
    <span
      className={cn(
        "zt:inline-block zt:shrink-0 zt:rounded-full zt:bg-(--zt-swatch-color) zt:align-middle zt:ring-1 zt:ring-foreground/10 zt:ring-inset",
        className,
      )}
      style={{ "--zt-swatch-color": hex } as React.CSSProperties}
    />
  );
}

/**
 * The one colour a tick moved, read off the selection the Chooser reports: the
 * colour the next selection gained, or the one it lost. `undefined` when the
 * two selections hold the same colours, which nothing ticking a row produces.
 */
function changedColor(
  before: readonly string[],
  after: readonly string[],
): string | undefined {
  return (
    after.find((hex) => !before.includes(hex)) ??
    before.find((hex) => !after.includes(hex))
  );
}

/**
 * The row that empties a filter's selection, in either Chooser: it names no
 * value of its own and carries the gesture instead. What the render callbacks
 * discriminate a row on.
 */
interface ActionRow extends ChooserRow {
  action: (close: () => void) => void;
}

/**
 * What an action row answers to inside its Chooser, where a value names a row
 * rather than a colour or a tag. It wears the plugin's own prefix, so no hex
 * and no tag name collides with it.
 */
function clearRowValue(kind: "colors" | "tags"): string {
  return `zt:clear-${kind}`;
}

/** A colour row draws the name beside its swatch and carries nothing else. */
type ColorRow = (ChooserRow & { action?: undefined }) | ActionRow;

/**
 * The colours present in the annotations, in a Chooser hanging under the
 * trigger. Each row is a square swatch and the colour's own name, so the list
 * reads without a tooltip; it carries no search field, because a palette of at
 * most eight is read by sight.
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
  onClear,
}: {
  colors: readonly string[];
  selectedColors: readonly string[];
  onToggle: (color: string) => void;
  onClear: () => void;
}) {
  const counting = selectedColors.length > 0;

  // The trigger wears the selection in the palette order the rows keep, so the
  // same filter reads the same way whatever order its colours were ticked in.
  const selected = useMemo(
    () => colors.filter((hex) => selectedColors.includes(hex)),
    [colors, selectedColors],
  );
  const { shown, hiddenCount } = cappedSelection(selected, COLOR_CAP);

  // The cap reaches the eye alone: the accessible name lists every colour.
  const ariaLabel = counting
    ? m.annot_view_filter_color_trigger_active({
        colors: new Intl.ListFormat(runtime.getLocale(), {
          type: "conjunction",
        }).format(selected.map(annotationColorLabel)),
      })
    : m.annot_view_filter_color_trigger();

  // The action row sits in a second group, reached by the same arrow keys, and
  // stands only while something is selected: a row offering to clear an empty
  // selection is a row that does nothing.
  const groups = useMemo<ChooserGroup<ColorRow>[]>(() => {
    const entries = colors.map((hex) => ({
      value: hex,
      label: annotationColorLabel(hex),
    }));
    if (selectedColors.length === 0) return [{ items: entries }];
    return [
      { items: entries },
      {
        items: [
          {
            value: clearRowValue("colors"),
            label: m.annot_view_filter_color_clear(),
            action: () => onClear(),
          },
        ],
      },
    ];
  }, [colors, selectedColors.length, onClear]);

  return (
    // The store keeps the colour action #1194 asks to reuse unchanged — it
    // takes the one colour that moved — so the selection the Chooser reports
    // is read back down to that colour here. The recovery is exact rather
    // than a guess: a tick on a row is the only thing that calls
    // `onValueChange` — by click or by Enter, both through `activatedRow` —
    // and what it hands over is `toggledValues(selected, value)`, which
    // differs from the selection it was given by that one value alone. The
    // action row runs instead of ticking, so clearing never reaches here.
    <Chooser
      value={selectedColors}
      onValueChange={(next) => {
        const moved = changedColor(selectedColors, next);
        if (moved !== undefined) onToggle(moved);
      }}
    >
      <Chooser.Trigger className={filterTrigger} {...tooltipAttrs(ariaLabel)}>
        {counting ? (
          <span className="zt:flex zt:items-center zt:gap-0.5">
            {shown.map((hex) => (
              <Swatch key={hex} hex={hex} className="zt:size-2.5" />
            ))}
          </span>
        ) : (
          <Icon name="palette" />
        )}
        {hiddenCount > 0 && <HiddenCount count={hiddenCount} />}
        <TriggerChevron />
      </Chooser.Trigger>
      <Chooser.Popup className="zt:min-w-40">
        {/* No empty message: the list carries no search field, so nothing
            narrows it and the palette is never empty — a trigger stands only
            where a colour does. */}
        <Chooser.List
          groups={groups}
          aria-label={m.annot_view_filter_color_list()}
        >
          {(row) =>
            row.action ? (
              <Chooser.Action key={row.value} value={row.value} icon="x">
                {row.label}
              </Chooser.Action>
            ) : (
              <Chooser.Item key={row.value} value={row.value}>
                <Swatch hex={row.value} className="zt:me-1.5 zt:size-3" />
                {row.label}
              </Chooser.Item>
            )
          }
        </Chooser.List>
      </Chooser.Popup>
    </Chooser>
  );
}

/** A tag row, carrying the hit count its tooltip reads. */
interface TagEntryRow extends ChooserRow {
  hitCount: number;
  action?: undefined;
}

/** What the render callback discriminates on `action` to tell apart. */
type TagRow = TagEntryRow | ActionRow;

/**
 * The whole tag vocabulary, in a Chooser hanging under the same trigger shape
 * the colours wear. Its active state is bounded the same way: the first
 * selected tag's name, then a count of the rest, so the row stops growing as
 * the selection piles up.
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
  const counting = selectedTags.length > 0;

  // In the order the rows keep, so the name on the trigger is the one leading
  // the list rather than whichever tag was ticked first.
  const selected = useMemo(
    () => chips.filter((chip) => chip.selected).map((chip) => chip.name),
    [chips],
  );
  const { shown, hiddenCount } = cappedSelection(selected, TAG_CAP);

  const ariaLabel = counting
    ? m.annot_view_filter_tag_trigger_active({
        tags: new Intl.ListFormat(runtime.getLocale(), {
          type: "conjunction",
        }).format(selected),
      })
    : m.annot_view_filter_tag_trigger();

  // The Chooser matches on the label alone, so what a row needs beyond its
  // name travels with it rather than being looked up again while rendering.
  //
  // The action row sits in a second group, separated from the tags and
  // reached by the same arrow keys. It appears only while something is
  // selected, which is beyond what #1193 asked for and kept because a row
  // offering to clear an empty selection is a row that does nothing: the
  // vocabulary the user came to read is what the list should hold. Its label
  // is fixed — nothing here reads what the user typed, and the query leaves
  // the row standing either way.
  const groups = useMemo<ChooserGroup<TagRow>[]>(() => {
    const tags = chips.map((chip) => ({
      value: chip.name,
      label: chip.name,
      hitCount: chip.hitCount,
      disabled: !chip.selected && !chip.available,
    }));
    if (selectedTags.length === 0) return [{ items: tags }];
    return [
      { items: tags },
      {
        items: [
          {
            value: clearRowValue("tags"),
            label: m.annot_view_filter_tag_clear(),
            action: () => onChange([]),
          },
        ],
      },
    ];
  }, [chips, selectedTags.length, onChange]);

  return (
    <Chooser value={selectedTags} onValueChange={onChange}>
      <Chooser.Trigger className={filterTrigger} {...tooltipAttrs(ariaLabel)}>
        <Icon name="tag" />
        {/* The full name is in the accessible name and in the list; the
            trigger spends a bounded share of the row on it. */}
        {shown.map((name) => (
          <span key={name} className="zt:max-w-32 zt:truncate">
            {name}
          </span>
        ))}
        {hiddenCount > 0 && <HiddenCount count={hiddenCount} />}
        <TriggerChevron />
      </Chooser.Trigger>
      <Chooser.Popup>
        <Chooser.Input
          placeholder={m.annot_view_filter_tag_search_placeholder()}
          clearLabel={m.annot_view_clear_search()}
        />
        <Chooser.List
          groups={groups}
          aria-label={m.annot_view_filter_tag_list()}
          emptyLabel={m.annot_view_filter_tag_empty()}
        >
          {(row) =>
            row.action ? (
              <Chooser.Action key={row.value} value={row.value} icon="x">
                {row.label}
              </Chooser.Action>
            ) : (
              <Chooser.Item
                key={row.value}
                value={row.value}
                {...tooltipAttrs(
                  m.annot_view_filter_tag_tooltip({
                    name: row.label,
                    count: row.hitCount,
                  }),
                )}
              >
                {row.label}
              </Chooser.Item>
            )
          }
        </Chooser.List>
      </Chooser.Popup>
    </Chooser>
  );
}
