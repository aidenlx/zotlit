// Obsidian's own menu chrome over Base UI's menu primitives.
import "./menu.css";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { IconName } from "obsidian";
import { useContext } from "react";
import type { ReactNode, Ref } from "react";

import { cn, tooltipAttrs } from "@/lib/utils";

import { Icon } from "./icon";
import { MenuContainerContext, MenuContainerProvider } from "./menu-container";

export interface MenuContentProps {
  /** Which side of the trigger the menu prefers. */
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  children?: ReactNode;
}

/**
 * The menu surface, dressed as Obsidian's own: `.menu` for the chrome and
 * `.menu-scroll` for the item list, so a long menu scrolls inside the same
 * container Obsidian's menus use and a theme's menu rules reach it.
 *
 * Placement stays with Base UI's positioner; `menu.css` says what that costs
 * Obsidian's own `.menu` rules and why.
 *
 * @see apps/obsidian/docs/adr/0042-the-surfaces-inside-the-pdf-reader-are-vanilla-dom-on-obsidians-popover.md
 */
export function MenuContent({
  side = "bottom",
  align = "start",
  children,
}: MenuContentProps) {
  const container = useContext(MenuContainerContext);
  return (
    <BaseMenu.Portal container={container ?? undefined}>
      <BaseMenu.Positioner side={side} align={align} sideOffset={4}>
        <BaseMenu.Popup className="menu zt-menu">
          <div className="menu-scroll">{children}</div>
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

/**
 * One run of items between separators. Obsidian's own menu wraps each such run
 * in a `.menu-group`, which its mobile stylesheet rounds as one block.
 */
export function MenuGroup({ children }: { children?: ReactNode }) {
  return <div className="menu-group">{children}</div>;
}

export interface MenuItemProps {
  icon?: IconName;
  disabled?: boolean;
  /**
   * Obsidian renders an element's `aria-label` as its hover tooltip. A blocked
   * item names its reason here, so the reason is readable in place.
   *
   * @see apps/obsidian/policies/tooltips.md
   */
  reason?: string;
  onClick?: () => void;
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

export function MenuItem({
  icon,
  disabled,
  reason,
  onClick,
  children,
  ref,
}: MenuItemProps) {
  return (
    <BaseMenu.Item
      ref={ref}
      className={menuItemClass({ disabled })}
      disabled={disabled}
      {...(reason === undefined ? null : tooltipAttrs(reason))}
      onClick={onClick}
    >
      <div className="menu-item-icon">{icon && <Icon name={icon} />}</div>
      <div className="menu-item-title">{children}</div>
    </BaseMenu.Item>
  );
}

export interface MenuRadioGroupProps {
  value: string;
  onValueChange: (value: string) => void;
  children?: ReactNode;
}

/** One choice among several — the Follow Mode, the Attachment on screen. */
export function MenuRadioGroup({
  value,
  onValueChange,
  children,
}: MenuRadioGroupProps) {
  return (
    <BaseMenu.RadioGroup
      value={value}
      onValueChange={(next) => onValueChange(String(next))}
    >
      <MenuGroup>{children}</MenuGroup>
    </BaseMenu.RadioGroup>
  );
}

export interface MenuRadioItemProps extends Omit<MenuItemProps, "icon"> {
  value: string;
}

/**
 * The chosen entry carries `mod-checked` and a check glyph in its own icon
 * slot, which is what Obsidian's `MenuItem.setChecked` builds.
 */
export function MenuRadioItem({
  value,
  disabled,
  reason,
  children,
  ref,
}: MenuRadioItemProps) {
  return (
    <BaseMenu.RadioItem
      ref={ref}
      value={value}
      className={(state) => menuItemClass({ disabled, checked: state.checked })}
      disabled={disabled}
      {...(reason === undefined ? null : tooltipAttrs(reason))}
    >
      <BaseMenu.RadioItemIndicator className="menu-item-icon mod-checked">
        <Icon name="check" />
      </BaseMenu.RadioItemIndicator>
      <div className="menu-item-title">{children}</div>
    </BaseMenu.RadioItem>
  );
}

/** A non-interactive line: a heading, or the reason a neighbour is blocked. */
export function MenuLabel({ children }: { children?: ReactNode }) {
  return (
    <div className="menu-item is-label">
      <div className="menu-item-title">{children}</div>
    </div>
  );
}

export function MenuSeparator() {
  return <BaseMenu.Separator className="menu-separator" />;
}

function menuItemClass({
  disabled,
  checked,
}: {
  disabled?: boolean;
  checked?: boolean;
}): string {
  return cn(
    "menu-item tappable",
    disabled && "is-disabled",
    checked && "mod-checked",
  );
}

export const Menu = {
  ContainerProvider: MenuContainerProvider,
  Root: BaseMenu.Root,
  Trigger: BaseMenu.Trigger,
  Content: MenuContent,
  Group: MenuGroup,
  Item: MenuItem,
  Label: MenuLabel,
  RadioGroup: MenuRadioGroup,
  RadioItem: MenuRadioItem,
  Separator: MenuSeparator,
};
