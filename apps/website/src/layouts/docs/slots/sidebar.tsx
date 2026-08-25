// Owned docs-layout sidebar slot: fumadocs' stock shapes with the site's type
// on them — orange mono-uppercase folder rubrics, muted mono-uppercase
// `links`-prop entries, near-ink page links.
// Vendored from @fumadocs/base-ui `layouts/docs/slots/sidebar`; everything it
// imports stays on package entry points. Re-diff on bumps.

import { cva } from "class-variance-authority";
import { usePathname } from "fumadocs-core/framework";
import Link from "fumadocs-core/link";
import type * as PageTree from "fumadocs-core/page-tree";
import * as Base from "fumadocs-ui/components/sidebar/base";
import { createLinkItemRenderer } from "fumadocs-ui/components/sidebar/link-item";
import { createPageTreeRenderer } from "fumadocs-ui/components/sidebar/page-tree";
import type { SidebarPageTreeComponents } from "fumadocs-ui/components/sidebar/page-tree";
import { buttonVariants } from "fumadocs-ui/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "fumadocs-ui/components/ui/popover";
import { useTreePath } from "fumadocs-ui/contexts/tree";
import { useDocsLayout } from "fumadocs-ui/layouts/docs";
import { LinkItem } from "fumadocs-ui/layouts/shared";
import { isLayoutTabActive } from "fumadocs-ui/layouts/shared";
import type { LayoutTab } from "fumadocs-ui/layouts/shared";
import { SearchTrigger } from "fumadocs-ui/layouts/shared/slots/search-trigger";
import {
  Check,
  ChevronDown,
  ChevronsUpDown,
  Languages,
  SidebarIcon,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/cn.ts";
import { mergeRefs } from "@/lib/merge-refs.ts";

const itemVariants = cva(
  "relative flex flex-row items-center gap-2 rounded-lg p-2 text-start text-fd-muted-foreground wrap-anywhere [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        link: "transition-colors hover:bg-fd-accent/50 hover:text-fd-accent-foreground/80 hover:transition-none data-[active=true]:bg-fd-primary/10 data-[active=true]:text-fd-primary data-[active=true]:hover:transition-colors",
        button:
          "transition-colors hover:bg-fd-accent/50 hover:text-fd-accent-foreground/80 hover:transition-none",
      },
      highlight: {
        true: "data-[active=true]:before:content-[''] data-[active=true]:before:bg-fd-primary data-[active=true]:before:absolute data-[active=true]:before:w-px data-[active=true]:before:inset-y-2.5 data-[active=true]:before:inset-s-2.5",
      },
    },
  },
);

export interface SidebarProps extends ComponentProps<"aside"> {
  components?: Partial<SidebarPageTreeComponents>;
  banner?: ReactNode;
  footer?: ReactNode;

  /**
   * Support collapsing the sidebar on desktop mode
   *
   * @defaultValue true
   */
  collapsible?: boolean;
}

export type SidebarProviderProps = Base.SidebarProviderProps;

export const { useSidebar } = Base;

export function SidebarProvider(props: SidebarProviderProps) {
  return <Base.SidebarProvider {...props} />;
}

export function Sidebar({
  footer,
  banner,
  collapsible = true,
  components,
  ...rest
}: SidebarProps) {
  const {
    menuItems,
    slots,
    props: { tabs, nav, tabMode },
  } = useDocsLayout();
  const iconLinks = menuItems.filter((item) => item.type === "icon");
  const viewport = (
    <Base.SidebarViewport>
      <div className="flex flex-col gap-0.5">
        {/* No trailing margin on the last link item — `links`-prop entries read
            as ordinary page links, uniform with the page tree below. */}
        {menuItems
          .filter((v) => v.type !== "icon")
          .map((item, i) => (
            <SidebarLinkItem key={i} item={item} />
          ))}
        <SidebarPageTree Item={SidebarPageItem} {...components} />
      </div>
    </Base.SidebarViewport>
  );

  return (
    <>
      <SidebarContent {...rest}>
        <div className="flex flex-col gap-3 p-4 pb-2">
          <div className="flex">
            {slots.navTitle && (
              <slots.navTitle className="me-auto inline-flex items-center gap-2.5 text-[0.9375rem] font-medium" />
            )}
            {nav?.children}
            {collapsible && (
              <SidebarCollapseTrigger
                className={cn(
                  buttonVariants({
                    color: "ghost",
                    size: "icon-sm",
                    className: "mb-auto text-fd-muted-foreground",
                  }),
                )}
              >
                <SidebarIcon />
              </SidebarCollapseTrigger>
            )}
          </div>
          {slots.searchTrigger && <slots.searchTrigger.full hideIfDisabled />}
          {tabs.length > 0 && tabMode === "auto" && (
            <SidebarTabsDropdown tabs={tabs} />
          )}
          {banner}
        </div>
        {viewport}
        {(slots.languageSelect ||
          iconLinks.length > 0 ||
          slots.themeSwitch ||
          footer) && (
          <div className="flex flex-col p-4 pt-2">
            {slots.languageSelect && (
              <slots.languageSelect.root
                variant="secondary"
                className="mb-2 justify-start bg-fd-secondary/50 text-start text-fd-muted-foreground"
              >
                <Languages className="size-4.5" />
                <slots.languageSelect.text />
                <ChevronDown className="ms-auto size-3.5" />
              </slots.languageSelect.root>
            )}
            <div className="flex items-center rounded-lg border bg-fd-secondary/50 p-0.5 pe-0 text-fd-muted-foreground empty:hidden">
              {iconLinks.map((item, i) => (
                <LinkItem
                  key={i}
                  item={item}
                  className={cn(
                    buttonVariants({ size: "icon-sm", color: "ghost" }),
                  )}
                  aria-label={item.label}
                >
                  {item.icon}
                </LinkItem>
              ))}
              {slots.themeSwitch && (
                <slots.themeSwitch className="ms-auto rounded-none border-y-0 border-e-0 px-1 py-0 *:rounded-md" />
              )}
            </div>
            {footer}
          </div>
        )}
      </SidebarContent>
      <SidebarDrawer>
        <div className="flex flex-col gap-3 p-4 pb-2">
          <div className="flex items-center gap-1.5 text-fd-muted-foreground">
            <div className="flex flex-1">
              {iconLinks.map((item, i) => (
                <LinkItem
                  key={i}
                  item={item}
                  className={cn(
                    buttonVariants({
                      size: "icon-sm",
                      color: "ghost",
                      className: "p-2",
                    }),
                  )}
                  aria-label={item.label}
                >
                  {item.icon}
                </LinkItem>
              ))}
            </div>
            {slots.languageSelect && (
              <slots.languageSelect.root>
                <Languages className="size-4.5" />
                <slots.languageSelect.text />
              </slots.languageSelect.root>
            )}
            {slots.themeSwitch && <slots.themeSwitch className="p-0" />}
            <SidebarTrigger
              className={cn(
                buttonVariants({
                  color: "ghost",
                  size: "icon-sm",
                  className: "p-2",
                }),
              )}
            >
              <SidebarIcon />
            </SidebarTrigger>
          </div>
          {tabs.length > 0 && <SidebarTabsDropdown tabs={tabs} />}
          {banner}
        </div>
        {viewport}
        <div className="flex flex-col border-t p-4 pt-2 empty:hidden">
          {footer}
        </div>
      </SidebarDrawer>
    </>
  );
}

function SidebarFolder(props: ComponentProps<typeof Base.SidebarFolder>) {
  return <Base.SidebarFolder {...props} />;
}

function SidebarCollapseTrigger(
  props: ComponentProps<typeof Base.SidebarCollapseTrigger>,
) {
  return <Base.SidebarCollapseTrigger {...props} />;
}

export function SidebarTrigger(props: ComponentProps<"button">) {
  return <Base.SidebarTrigger {...props} />;
}

function SidebarContent({
  ref: refProp,
  className,
  children,
  ...props
}: ComponentProps<"aside">) {
  const ref = useRef<HTMLElement>(null);

  return (
    <Base.SidebarContent>
      {({ collapsed, hovered, ref: asideRef, ...rest }) => (
        <>
          <div
            data-sidebar-placeholder=""
            className="pointer-events-none sticky top-(--fd-docs-row-1) z-20 h-[calc(var(--fd-docs-height)-var(--fd-docs-row-1))] [grid-area:sidebar] *:pointer-events-auto max-md:hidden md:layout:[--fd-sidebar-width:268px]"
          >
            {collapsed && (
              <div className="absolute inset-y-0 inset-s-0 w-4" {...rest} />
            )}
            <aside
              id="nd-sidebar"
              ref={mergeRefs(ref, refProp, asideRef)}
              data-collapsed={collapsed}
              data-hovered={collapsed && hovered}
              className={cn(
                "absolute inset-y-0 inset-s-0 flex w-full flex-col items-end border-e bg-fd-card text-sm duration-250 *:w-(--fd-sidebar-width)",
                collapsed && [
                  "inset-y-2 w-(--fd-sidebar-width) rounded-xl border transition-transform",
                  hovered
                    ? "translate-x-2 shadow-lg rtl:-translate-x-2"
                    : "-translate-x-(--fd-sidebar-width) rtl:translate-x-full",
                ],
                ref.current &&
                  (ref.current.getAttribute("data-collapsed") === "true") !==
                    collapsed &&
                  "transition-[width,inset-block,translate,background-color]",
                className,
              )}
              {...props}
              {...rest}
            >
              {children}
            </aside>
          </div>
          <div
            data-sidebar-panel=""
            className={cn(
              "fixed inset-s-4 top-[calc(--spacing(4)+var(--fd-docs-row-3))] z-10 flex rounded-xl border bg-fd-muted p-0.5 text-fd-muted-foreground shadow-lg transition-opacity",
              (!collapsed || hovered) && "pointer-events-none opacity-0",
            )}
          >
            <Base.SidebarCollapseTrigger
              className={cn(
                buttonVariants({
                  color: "ghost",
                  size: "icon-sm",
                  className: "rounded-lg",
                }),
              )}
            >
              <SidebarIcon />
            </Base.SidebarCollapseTrigger>
            <SearchTrigger className="rounded-lg" hideIfDisabled />
          </div>
        </>
      )}
    </Base.SidebarContent>
  );
}

function SidebarDrawer({
  children,
  className,
  ...props
}: ComponentProps<typeof Base.SidebarDrawerContent>) {
  return (
    <>
      <Base.SidebarDrawerOverlay className="fixed inset-0 z-40 backdrop-blur-xs data-[state=closed]:animate-fd-fade-out data-[state=open]:animate-fd-fade-in" />
      <Base.SidebarDrawerContent
        className={cn(
          "fixed inset-y-0 inset-e-0 z-40 flex w-[85%] max-w-95 flex-col border-s bg-fd-background text-[0.9375rem] shadow-lg data-[state=closed]:animate-fd-sidebar-out data-[state=open]:animate-fd-sidebar-in",
          className,
        )}
        {...props}
      >
        {children}
      </Base.SidebarDrawerContent>
    </>
  );
}

function SidebarSeparator({
  className,
  style,
  children,
  ...props
}: ComponentProps<"p">) {
  const depth = Base.useFolderDepth();

  return (
    <Base.SidebarSeparator
      className={cn(
        "mt-6 mb-1 inline-flex items-center gap-2 px-2 empty:mb-0 [&_svg]:size-4 [&_svg]:shrink-0",
        depth === 0 && "first:mt-0",
        className,
      )}
      style={{
        paddingInlineStart: getItemOffset(depth),
        ...style,
      }}
      {...props}
    >
      {children}
    </Base.SidebarSeparator>
  );
}

function SidebarItem({
  className,
  style,
  children,
  ...props
}: ComponentProps<typeof Base.SidebarItem>) {
  const depth = Base.useFolderDepth();

  return (
    <Base.SidebarItem
      className={cn(
        itemVariants({ variant: "link", highlight: depth >= 1 }),
        // Uniform rubric: every root-level row (links-prop entries included)
        // speaks the orange caps voice; nested page links lead in near-ink.
        depth === 0
          ? "font-mono text-[0.72rem] font-semibold tracking-widest text-fd-primary uppercase"
          : "text-[0.84rem] text-[color-mix(in_oklab,var(--color-fd-foreground)_82%,var(--color-fd-muted-foreground))]",
        className,
      )}
      style={{
        paddingInlineStart: getItemOffset(depth),
        ...style,
      }}
      {...props}
    >
      {children}
    </Base.SidebarItem>
  );
}

// The release-availability pill rides beside the page name once the
// availability port lands — see AGENTS.md → Pending slices.
// @see https://github.com/aidenlx/zotlit/issues/857
function SidebarPageItem({ item }: { item: PageTree.Item }) {
  const pathname = usePathname();

  return (
    <SidebarItem
      href={item.url}
      external={item.external}
      active={normalizePath(item.url) === normalizePath(pathname)}
      icon={item.icon}
    >
      <span className="min-w-0 flex-1">{item.name}</span>
    </SidebarItem>
  );
}

function normalizePath(path: string) {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function SidebarLinkEntry({
  className,
  style,
  children,
  ...props
}: ComponentProps<typeof Base.SidebarItem>) {
  return (
    <Base.SidebarItem
      className={cn(
        itemVariants({ variant: "link" }),
        // Unified `links` voice (shared with the home-nav links)
        "font-mono text-[0.72rem] font-medium tracking-[0.08em] text-fd-muted-foreground uppercase",
        className,
      )}
      style={{ paddingInlineStart: getItemOffset(0), ...style }}
      {...props}
    >
      {children}
    </Base.SidebarItem>
  );
}

function SidebarFolderTrigger({
  className,
  style,
  ...props
}: ComponentProps<typeof Base.SidebarFolderTrigger>) {
  const { depth, collapsible } = Base.useFolder()!;

  return (
    <Base.SidebarFolderTrigger
      className={(state) =>
        cn(
          itemVariants({ variant: collapsible ? "button" : null }),
          // Rubricated folder labels at the TOC-title voice; chevrons stay muted.
          "w-full font-mono text-[0.72rem] font-semibold tracking-widest text-fd-primary uppercase [&_svg]:text-fd-muted-foreground",
          typeof className === "function" ? className(state) : className,
        )
      }
      style={
        typeof style === "function"
          ? (state) => ({
              paddingInlineStart: getItemOffset(depth - 1),
              ...style(state),
            })
          : { paddingInlineStart: getItemOffset(depth - 1), ...style }
      }
      {...props}
    >
      {props.children}
    </Base.SidebarFolderTrigger>
  );
}

function SidebarFolderLink({
  className,
  style,
  ...props
}: ComponentProps<typeof Base.SidebarFolderLink>) {
  const depth = Base.useFolderDepth();

  return (
    <Base.SidebarFolderLink
      className={cn(
        itemVariants({ variant: "link", highlight: depth > 1 }),
        // Folder labels carry the rubric even when the folder is a link.
        "w-full font-mono text-[0.72rem] font-semibold tracking-widest text-fd-primary uppercase [&_svg]:text-fd-muted-foreground",
        className,
      )}
      style={{
        paddingInlineStart: getItemOffset(depth - 1),
        ...style,
      }}
      {...props}
    >
      {props.children}
    </Base.SidebarFolderLink>
  );
}

function SidebarFolderContent({
  className,
  children,
  ...props
}: ComponentProps<typeof Base.SidebarFolderContent>) {
  const depth = Base.useFolderDepth();

  return (
    <Base.SidebarFolderContent
      className={(state) =>
        cn(
          "relative flex flex-col gap-0.5 pt-0.5",
          depth === 1 &&
            "before:absolute before:inset-y-1 before:inset-s-2.5 before:w-px before:bg-fd-border before:content-['']",
          typeof className === "function" ? className(state) : className,
        )
      }
      {...props}
    >
      {children}
    </Base.SidebarFolderContent>
  );
}

function SidebarTabsDropdown({
  tabs,
  placeholder,
  ...props
}: {
  placeholder?: ReactNode;
  tabs: LayoutTab[];
} & ComponentProps<"button">) {
  const [open, setOpen] = useState(false);
  const { closeOnRedirect } = useSidebar();
  const pathname = usePathname();
  const path = useTreePath();

  const selected = useMemo(() => {
    return tabs.findLast((item) => isLayoutTabActive(item, path, pathname));
  }, [tabs, path, pathname]);

  const onClick = () => {
    closeOnRedirect.current = false;
    setOpen(false);
  };

  const item = selected ? (
    <>
      <div className="size-9 shrink-0 empty:hidden md:size-5">
        {selected.icon}
      </div>
      <div>
        <p className="text-sm font-medium">{selected.title}</p>
        <p className="text-sm text-fd-muted-foreground empty:hidden md:hidden">
          {selected.description}
        </p>
      </div>
    </>
  ) : (
    placeholder
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {item && (
        <PopoverTrigger
          {...props}
          className={cn(
            "flex items-center gap-2 rounded-lg border bg-fd-secondary/50 p-2 text-start text-fd-secondary-foreground transition-colors hover:bg-fd-accent data-popup-open:bg-fd-accent data-popup-open:text-fd-accent-foreground",
            props.className,
          )}
        >
          {item}
          <ChevronsUpDown className="ms-auto size-4 shrink-0 text-fd-muted-foreground" />
        </PopoverTrigger>
      )}
      <PopoverContent className="fd-scroll-container flex w-(--anchor-width) flex-col gap-1 p-1">
        {tabs.map((item) => {
          const isActive = selected && item.url === selected.url;
          if (!isActive && item.unlisted) return;

          return (
            <Link
              key={item.url}
              href={item.url}
              onClick={onClick}
              {...item.props}
              className={cn(
                "flex items-center gap-2 rounded-lg p-1.5 hover:bg-fd-accent hover:text-fd-accent-foreground",
                item.props?.className,
              )}
            >
              <div className="size-9 shrink-0 empty:hidden md:mb-auto md:size-5">
                {item.icon}
              </div>
              <div>
                <p className="text-sm leading-none font-medium">{item.title}</p>
                <p className="mt-1 text-[0.8125rem] text-fd-muted-foreground empty:hidden">
                  {item.description}
                </p>
              </div>

              <Check
                className={cn(
                  "ms-auto size-3.5 shrink-0 text-fd-primary",
                  !isActive && "invisible",
                )}
              />
            </Link>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

function getItemOffset(depth: number) {
  return `calc(${2 + 3 * depth} * var(--spacing))`;
}

const SidebarPageTree = createPageTreeRenderer({
  SidebarFolder,
  SidebarFolderContent,
  SidebarFolderLink,
  SidebarFolderTrigger,
  SidebarItem,
  SidebarSeparator,
});

const SidebarLinkItem = createLinkItemRenderer({
  SidebarFolder,
  SidebarFolderContent,
  SidebarFolderLink,
  SidebarFolderTrigger,
  SidebarItem: SidebarLinkEntry,
});
