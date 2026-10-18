// The Select: one value out of a list, picked from a Chooser popup with a
// search field, as a Bases toolbar menu picks a property, an operator or a
// layout. It stands where a native `<select>` stood and draws itself from the
// variables Obsidian draws a dropdown with, so a caller that tuned those
// variables for its surroundings keeps its look.
//
// The Bases property picker is the same combobox as every other one, given
// options that carry an icon and a raw id beside the name. A Select is the
// same: an option with an `icon` puts it before its name in the row and on the
// trigger, and an option with a `detail` shows it at the end of its row, unless
// it repeats the name. There is no property variant to pick.
//
// @see apps/obsidian/docs/bases-toolbar-menu.md#comboboxes

import { useCallback, useLayoutEffect, useRef } from "react";
import type {
  ButtonHTMLAttributes,
  FocusEvent,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
  Ref,
  RefObject,
} from "react";

import { Icon } from "@/components/obsidian/icon";
import * as m from "@/lib/i18n/generated/messages";
import { composing } from "@/lib/ime";
import { cn } from "@/lib/utils";

import { Chooser, useChooserOpenSearch } from "./chooser";
import type { ChooserRow } from "./chooser-logic";

export interface SelectOption {
  value: string;
  /** The name the row and the trigger show. */
  label: string;
  /** The glyph before the name, such as a property's type icon. */
  icon?: ReactNode;
  /** Muted text at the end of the row, such as a property's raw id. */
  detail?: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "value" | "onChange" | "children" | "popoverTarget" | "type"
> {
  value: string;
  onChange: (next: string) => void;
  options: readonly SelectOption[];
  /**
   * The trigger's text while the value is empty, in the placeholder ink. A
   * value that names no option shows as itself.
   */
  placeholder?: string;
  ref?: Ref<HTMLButtonElement>;
}

interface SelectRow extends ChooserRow {
  option: SelectOption;
}

/**
 * The trigger as Obsidian draws `select, .combobox-button`: the dropdown's
 * background, the input's shadow and radius, Bases' combobox padding and gap.
 * Every one is read from its variable, which is how the Filter's statement,
 * the sort row's joined pair and the conjunction strip the box back.
 */
const triggerClass = cn(
  "zt:flex zt:h-(--input-height) zt:max-w-full zt:min-w-0 zt:items-center zt:gap-(--size-2-2) zt:overflow-hidden zt:whitespace-nowrap",
  "zt:ps-(--size-4-2) zt:pe-(--size-2-3) zt:text-start zt:text-sm zt:leading-(--line-height-tight) zt:font-(--input-font-weight) zt:text-foreground",
  "zt:cursor-(--cursor) zt:rounded-(--input-radius) zt:bg-(--dropdown-background) zt:shadow-(--input-shadow) zt:[corner-shape:var(--corner-shape)]",
  "zt:not-aria-disabled:hover:bg-(--dropdown-background-hover) zt:not-aria-disabled:hover:shadow-(--input-shadow-hover) zt:data-open:bg-(--dropdown-background-hover)",
  "zt:focus-visible:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)] zt:focus-visible:outline-none",
);

/** The glyph box of a row and of the trigger, at Obsidian's small icon size. */
const glyphClass =
  "zt:flex zt:min-w-(--icon-s) zt:shrink-0 zt:items-center zt:text-(--icon-color) zt:[--icon-size:var(--icon-s)] zt:[--icon-stroke:var(--icon-s-stroke-width)]";

/**
 * @example
 * ```tsx
 * <Select
 *   aria-label="Direction"
 *   value={direction}
 *   onChange={setDirection}
 *   options={[
 *     { value: "ASC", label: "A → Z" },
 *     { value: "DESC", label: "Z → A" },
 *   ]}
 * />
 * ```
 */
export function Select({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
  onKeyDown,
  ref,
  ...rest
}: SelectProps) {
  const popup = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const attach = useCallback(
    (node: HTMLButtonElement | null) => {
      trigger.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  // The Chooser ticks; a Select keeps one value. A press on the value that
  // stands untoggles it there, which here keeps it, and either way the popup
  // shuts, as a native select's does.
  const choose = useCallback(
    (next: string[]) => {
      const picked = next.find((entry) => entry !== value);
      popup.current?.hidePopover();
      if (picked !== undefined) onChange(picked);
    },
    [value, onChange],
  );

  // A popup that shuts with focus inside it, on a pick or on Escape, hands
  // focus back to its trigger. The browser restores focus only for the first
  // popover of a stack, and a Select in the Sort, Group or Filter popover is
  // the second, whose search field would leave focus nowhere.
  const shutting = useRef(false);
  useLayoutEffect(() => {
    const shell = popup.current;
    if (!shell) return;
    const onBeforeToggle = (event: Event) => {
      if ((event as ToggleEvent).newState !== "closed") return;
      if (!shell.contains(shell.doc.activeElement)) return;
      shutting.current = true;
      trigger.current?.focus({ preventScroll: true });
      shutting.current = false;
    };
    // Captured, so it runs before the Chooser's own listener unmounts the
    // session, and the search field with it, which drops focus to the body.
    shell.addEventListener("beforetoggle", onBeforeToggle, { capture: true });
    return () =>
      shell.removeEventListener("beforetoggle", onBeforeToggle, {
        capture: true,
      });
  }, []);

  return (
    <Chooser value={[value]} onValueChange={choose}>
      <SelectBody
        {...rest}
        value={value}
        options={options}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        onKeyDown={onKeyDown}
        attach={attach}
        popup={popup}
        trigger={trigger}
        shutting={shutting}
      />
    </Chooser>
  );
}

interface SelectBodyProps extends Omit<SelectProps, "onChange" | "ref"> {
  attach: (node: HTMLButtonElement | null) => void;
  popup: RefObject<HTMLDivElement | null>;
  trigger: RefObject<HTMLButtonElement | null>;
  /** Set while a shutting popup hands focus back to the trigger. */
  shutting: RefObject<boolean>;
}

/** The trigger and the popup, inside the Chooser whose search they open. */
function SelectBody({
  value,
  options,
  placeholder,
  disabled,
  className,
  onKeyDown,
  attach,
  popup,
  trigger,
  shutting,
  ...rest
}: SelectBodyProps) {
  const openSearch = useChooserOpenSearch();
  const current = options.find((option) => option.value === value);
  const glyphs = options.some((option) => option.icon !== undefined);
  const rows: SelectRow[] = options.map((option) => ({
    value: option.value,
    // The query reaches the raw id too, as the Bases picker matches it.
    label: shownDetail(option)
      ? `${option.label} ${option.detail}`
      : option.label,
    disabled: option.disabled,
    option,
  }));

  // Focus that leaves the popup shuts it, as a Tab or Shift+Tab out of a
  // native select's list does. A popover shuts on a press outside, not on
  // focus moving out, and an open one goes on holding the keys of the
  // control focus left for, the trigger included. A press on the trigger
  // moves focus there too, and is left to the popover, which shuts on it.
  const pressed = useRef(false);
  const leave = (event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget;
    if (!next?.instanceOf(Node) || popup.current?.contains(next)) return;
    if (
      trigger.current?.contains(next) &&
      (pressed.current || shutting.current)
    )
      return;
    if (trigger.current?.getAttribute("aria-expanded") !== "true") return;
    popup.current?.hidePopover();
  };

  return (
    <>
      <Chooser.Trigger
        ref={attach}
        role="combobox"
        aria-haspopup="listbox"
        blocked={disabled}
        data-value={value}
        {...rest}
        // The arrow keys open the popup from the trigger, as they open a
        // native select and the Bases combobox; a printable key opens it
        // searching for that key, as typing on a Bases combobox does.
        onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || disabled) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            popup.current?.showPopover();
            return;
          }
          if (
            event.key.length !== 1 ||
            event.key === " " ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            composing(event)
          )
            return;
          event.preventDefault();
          openSearch(event.key);
        }}
        onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
          rest.onPointerDown?.(event);
          pressed.current = true;
          event.currentTarget.doc.addEventListener(
            "pointerup",
            () => (pressed.current = false),
            { once: true, capture: true },
          );
        }}
        onBlur={(event: FocusEvent<HTMLButtonElement>) => {
          rest.onBlur?.(event);
          leave(event);
        }}
        className={cn(triggerClass, className)}
      >
        {current?.icon !== undefined && (
          <span aria-hidden className={glyphClass} data-select-icon="">
            {current.icon}
          </span>
        )}
        <span
          data-placeholder={!current && !value ? "" : undefined}
          className="zt:me-auto zt:min-w-0 zt:truncate zt:data-placeholder:text-(--input-placeholder-color)"
        >
          {current ? current.label : value || placeholder}
        </span>
        <Icon
          name="chevrons-up-down"
          size="var(--icon-xs)"
          strokeWidth="var(--icon-xs-stroke-width)"
          className="zt:shrink-0 zt:text-(--icon-color)"
        />
      </Chooser.Trigger>
      <Chooser.Popup
        ref={popup}
        data-select-popup=""
        // A trigger near the window's end edge opens its popup toward the
        // start instead, as the Query View's toolbar menus do.
        className="zt:[position-try-fallbacks:flip-block,flip-inline,flip-block_flip-inline]"
        // A Select inside a `<label>`, as a page field holds one, would have
        // the label hand every press in the popup back to the trigger, which
        // reopens the popup a choice just shut. The label's activation runs
        // whether or not the click propagates; only a cancelled click stops it.
        onClick={(event) => event.preventDefault()}
        onBlur={leave}
      >
        <Chooser.Input
          placeholder={m.select_search()}
          clearLabel={m.select_clear_search()}
        />
        <Chooser.List<SelectRow>
          groups={[{ items: rows }]}
          label={rest["aria-label"] ?? placeholder ?? ""}
          aria-multiselectable={false}
          emptyLabel={m.select_no_match()}
        >
          {(row) => (
            <Chooser.Item
              key={row.value}
              value={row.value}
              data-value={row.value}
              // The tick reads the row's selected state.
              className="zt:group"
              leading={
                glyphs ? (
                  <span aria-hidden className={glyphClass}>
                    {row.option.icon}
                  </span>
                ) : (
                  false
                )
              }
              // The tick stands at the end of the row, as Bases orders it.
              end={
                <>
                  {shownDetail(row.option) && (
                    <span className="zt:shrink-0 zt:truncate zt:text-xs zt:text-muted-foreground">
                      {row.option.detail}
                    </span>
                  )}
                  <Icon
                    name="check"
                    size="var(--icon-xs)"
                    strokeWidth="var(--icon-xs-stroke-width)"
                    className="zt:invisible zt:shrink-0 zt:group-aria-selected:visible"
                  />
                </>
              }
            >
              <span data-select-label="">{row.option.label}</span>
            </Chooser.Item>
          )}
        </Chooser.List>
      </Chooser.Popup>
    </>
  );
}

/** A detail that only repeats the name stays off the row, as Bases leaves it. */
function shownDetail(option: SelectOption): boolean {
  return !!option.detail && option.detail !== option.label;
}
