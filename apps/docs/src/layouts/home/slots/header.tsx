// Owned home-layout header slot: the site nav in the apparatus-label voice —
// IBM Plex Mono uppercase links under the double-hairline signature.
// Vendored from @fumadocs/base-ui `layouts/home/slots/header`; everything it
// imports stays on package entry points. Re-diff on bumps.
//
// `MobileSearchTrigger` below is a local addition, not part of the vendored
// original: it reproduces `fumadocs-ui`'s icon-variant `SearchTrigger`
// because that component drops every prop but `className`, so it can't take
// the `suppressHydrationWarning` this nav needs (see the note beside it).

import { Dialog } from "@base-ui/react/dialog";
import { NavigationMenu as Primitive } from "@base-ui/react/navigation-menu";
import { useTranslations } from "@fuma-translate/react";
import { cva } from "class-variance-authority";
import Link from "fumadocs-core/link";
import { buttonVariants } from "fumadocs-ui/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "fumadocs-ui/components/ui/collapsible";
import { useSearchContext } from "fumadocs-ui/contexts/search";
import { useHomeLayout } from "fumadocs-ui/layouts/home";
import { LinkItem } from "fumadocs-ui/layouts/shared";
import type { LinkItemType } from "fumadocs-ui/layouts/shared";
import { useIsScrollTop } from "fumadocs-ui/utils/use-is-scroll-top";
import { ChevronDown, Languages, Search } from "lucide-react";
import {
  createContext,
  Fragment,
  use,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";
import { mergeRefs } from "@/lib/merge-refs";

export const navItemVariants = cva("[&_svg]:size-4", {
  variants: {
    variant: {
      // Apparatus-label voice: IBM Plex Mono uppercase (the "Machine" register).
      main: "inline-flex items-center gap-1 p-2 font-mono text-[0.8125rem] font-medium uppercase tracking-[0.11em] text-fd-muted-foreground transition-colors hover:text-fd-accent-foreground data-[active=true]:text-fd-primary",
      button: buttonVariants({
        color: "secondary",
        className: "gap-1.5",
      }),
      icon: buttonVariants({
        color: "ghost",
        size: "icon",
      }),
    },
  },
  defaultVariants: {
    variant: "main",
  },
});

const MobileNavigationMenuContext = createContext<{
  setOpen: (v: boolean) => void;
} | null>(null);

export function Header(props: ComponentProps<"header">) {
  const {
    navItems,
    menuItems,
    slots,
    props: { nav },
  } = useHomeLayout();
  const headerRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const t = useTranslations({ note: "home layout header" });
  const transparentMode = nav?.transparentMode ?? "none";
  const isTop = useIsScrollTop({ enabled: transparentMode === "top" }) ?? true;
  const isNavTransparent =
    transparentMode === "top" ? isTop : transparentMode === "always";

  const onClick = useEffectEvent((e: Event) => {
    const element = headerRef.current;
    if (!open || !element) return;
    if (element !== e.target && !element.contains(e.target as HTMLElement)) {
      setOpen(false);
    }
  });

  useEffect(() => {
    window.addEventListener("click", onClick);

    return () => {
      window.removeEventListener("click", onClick);
    };
  }, []);

  const list = (
    <Primitive.List
      ref={listRef}
      className="mx-auto flex h-14 w-full max-w-(--fd-layout-width) items-center px-4"
    >
      {slots.navTitle && (
        <slots.navTitle className="inline-flex items-center gap-2.5 font-semibold" />
      )}
      {nav?.children}
      <ul className="flex flex-row items-center gap-2 px-6 max-sm:hidden">
        {navItems
          .filter((item) => !isSecondary(item))
          .map((item, i) => (
            <NavigationMenuLinkItem key={i} item={item} />
          ))}
      </ul>
      <div className="flex flex-1 flex-row items-center justify-end gap-1.5 max-lg:hidden">
        {slots.searchTrigger && (
          <slots.searchTrigger.full
            hideIfDisabled
            // Chrome control, so it stays on the sans stack even though the
            // (home) container voice is serif — matches the /docs sidebar trigger.
            className="w-full max-w-[240px] rounded-full ps-2.5 font-sans"
            // Base UI's NavigationMenu.List wraps every descendant in a
            // Composite roving-tabindex domain, even non-item children like
            // this trigger. Its tabIndex/aria-disabled only settle once the
            // Composite registers this button post-mount, so the very first
            // client render disagrees with the SSR markup — self-corrects
            // before paint, so this is a false-positive hydration warning.
            suppressHydrationWarning
          />
        )}
        {slots.themeSwitch && <slots.themeSwitch />}
        {slots.languageSelect && (
          <slots.languageSelect.root>
            <Languages className="size-5" />
          </slots.languageSelect.root>
        )}
        <ul className="flex flex-row items-center gap-2 empty:hidden">
          {navItems.filter(isSecondary).map((item, i) => (
            <NavigationMenuLinkItem
              key={i}
              className={cn(
                item.type === "icon" && "-mx-1 first:ms-0 last:me-0",
              )}
              item={item}
            />
          ))}
        </ul>
      </div>
      <div className="ms-auto -me-1.5 flex flex-row items-center lg:hidden">
        {slots.searchTrigger && <MobileSearchTrigger />}
        <CollapsibleTrigger
          aria-label={t("Toggle Menu", { note: "aria-label" })}
          className={cn(
            buttonVariants({
              size: "icon",
              color: "ghost",
            }),
          )}
          onPointerEnter={
            nav?.enableHoverToOpen
              ? () => {
                  setOpen(true);
                }
              : undefined
          }
          // See the suppressHydrationWarning note on the full search
          // trigger above — same Composite roving-tabindex false positive.
          suppressHydrationWarning
        >
          <ChevronDown
            className={cn("transition-transform", open && "rotate-180")}
          />
        </CollapsibleTrigger>
      </div>
    </Primitive.List>
  );

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      render={
        <header
          id="nd-nav"
          {...props}
          ref={mergeRefs(headerRef, props.ref)}
          className={cn(
            "sticky top-0 z-40 h-14",
            // Double-hairline signature: the nav's own border-b plus this offset
            // 3px rule. Hidden while the mobile drawer is open — the drawer's
            // rounded, shadowed edge closes the header instead.
            !open &&
              "after:absolute after:inset-x-0 after:-bottom-1 after:border-b-[3px] after:border-fd-border after:content-['']",
            props.className,
          )}
        >
          <Primitive.Root
            className={(s) =>
              cn(
                "border-b backdrop-blur-lg transition-[box-shadow,background-color,border-radius]",
                open && "max-lg:rounded-b-2xl max-lg:shadow-lg",
                (open || !isNavTransparent || s.open) && "bg-fd-background/80",
              )
            }
          >
            {list}
            <CollapsibleContent className="mx-auto max-w-(--fd-layout-width) lg:hidden">
              <div className="flex flex-col p-4 pt-2 sm:flex-row sm:items-center sm:justify-end">
                <MobileNavigationMenuContext
                  value={useMemo(() => ({ setOpen }), [])}
                >
                  {menuItems
                    .filter((item) => !isSecondary(item))
                    .map((item, i) => (
                      <MobileNavigationMenuLinkItem
                        key={i}
                        item={item}
                        className="sm:hidden"
                      />
                    ))}
                  <div className="-ms-1.5 flex flex-row items-center gap-2 max-sm:mt-2">
                    {menuItems.filter(isSecondary).map((item, i) => (
                      <MobileNavigationMenuLinkItem
                        key={i}
                        item={item}
                        className={cn(
                          item.type === "icon" && "-mx-1 first:ms-0",
                        )}
                      />
                    ))}
                    <div role="separator" className="flex-1" />
                    {slots.languageSelect && (
                      <slots.languageSelect.root>
                        <Languages className="size-5" />
                        {slots.languageSelect.text && (
                          <slots.languageSelect.text />
                        )}
                        <ChevronDown className="size-3 text-fd-muted-foreground" />
                      </slots.languageSelect.root>
                    )}
                    {slots.themeSwitch && <slots.themeSwitch />}
                  </div>
                </MobileNavigationMenuContext>
              </div>
            </CollapsibleContent>
            <Primitive.Portal>
              <Primitive.Positioner
                side="bottom"
                anchor={listRef}
                collisionPadding={{ top: 5, bottom: 5 }}
                className="z-40 box-border h-(--positioner-height) w-(--anchor-width) max-w-(--available-width) duration-(--duration) ease-(--easing) before:absolute before:content-[''] data-instant:transition-none data-[side=bottom]:before:top-[-10px] data-[side=bottom]:before:right-0 data-[side=bottom]:before:left-0 data-[side=bottom]:before:h-2.5 data-[side=left]:before:top-0 data-[side=left]:before:right-[-10px] data-[side=left]:before:bottom-0 data-[side=left]:before:w-2.5 data-[side=right]:before:top-0 data-[side=right]:before:bottom-0 data-[side=right]:before:left-[-10px] data-[side=right]:before:w-2.5 data-[side=top]:before:right-0 data-[side=top]:before:bottom-[-10px] data-[side=top]:before:left-0 data-[side=top]:before:h-2.5"
                style={{
                  ["--duration" as string]: "0.35s",
                  ["--easing" as string]: "cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              >
                <Primitive.Popup className="relative h-(--popup-height) w-full rounded-xl border bg-fd-popover/80 text-fd-popover-foreground shadow-lg backdrop-blur-md transition-[opacity,width,height] duration-(--duration) ease-(--easing) data-ending-style:opacity-0 data-ending-style:duration-150 data-starting-style:opacity-0">
                  <Primitive.Viewport className="relative size-full overflow-hidden" />
                </Primitive.Popup>
              </Primitive.Positioner>
            </Primitive.Portal>
          </Primitive.Root>
        </header>
      }
    />
  );
}

// Vendored equivalent of fumadocs-ui's `SearchTrigger` (icon variant): its
// packaged component only forwards `className`, dropping every other prop
// before it reaches the rendered `<button>`. We need `suppressHydrationWarning`
// to land there (see the note on the full search trigger above), so this
// stays a thin, exact reproduction of the packaged markup.
function MobileSearchTrigger() {
  const { enabled, dialogHandle } = useSearchContext();
  const t = useTranslations({ note: "search trigger" });
  if (!enabled) return null;

  return (
    <Dialog.Trigger
      handle={dialogHandle}
      type="button"
      className={cn(buttonVariants({ size: "icon-sm", color: "ghost" }), "p-2")}
      data-search=""
      aria-label={t("Open Search", { note: "aria-label" })}
      suppressHydrationWarning
    >
      <Search />
    </Dialog.Trigger>
  );
}

function isSecondary(item: LinkItemType): boolean {
  if ("secondary" in item && item.secondary != null) return item.secondary;

  return item.type === "icon";
}

function NavigationMenuLinkItem({
  item,
  className,
  ...props
}: {
  item: LinkItemType;
  className?: string;
}) {
  if (item.type === "custom") return item.children;

  if (item.type === "menu") {
    const children = item.items.map((child, j) => {
      if (child.type === "custom") {
        return <Fragment key={j}>{child.children}</Fragment>;
      }

      const {
        banner = child.icon ? (
          <div className="w-fit rounded-md border bg-fd-muted p-1 [&_svg]:size-4">
            {child.icon}
          </div>
        ) : null,
        ...rest
      } = child.menu ?? {};

      return (
        <Primitive.Link
          key={`${j}-${child.url}`}
          render={
            <Link
              href={child.url}
              external={child.external}
              {...rest}
              className={cn(
                "flex flex-col gap-2 rounded-lg border bg-fd-card p-3 transition-colors hover:bg-fd-accent/80 hover:text-fd-accent-foreground",
                rest.className,
              )}
            >
              {rest.children ?? (
                <>
                  {banner}
                  <p className="text-base font-medium">{child.text}</p>
                  <p className="text-sm text-fd-muted-foreground empty:hidden">
                    {child.description}
                  </p>
                </>
              )}
            </Link>
          }
        />
      );
    });

    return (
      <Primitive.Item className={cn("list-none", className)} {...props}>
        <Primitive.Trigger className={cn(navItemVariants(), "rounded-md")}>
          {item.url ? (
            <Link href={item.url} external={item.external}>
              {item.text}
            </Link>
          ) : (
            item.text
          )}
        </Primitive.Trigger>
        <Primitive.Content
          className={cn(
            "h-full w-(--anchor-width) max-w-(--available-width) p-3",
            "transition-[opacity,transform,translate] duration-(--duration) ease-(--easing)",
            "data-ending-style:opacity-0 data-starting-style:opacity-0",
            "data-starting-style:data-[activation-direction=left]:-translate-x-1/2",
            "data-starting-style:data-[activation-direction=right]:translate-x-1/2",
            "data-ending-style:data-[activation-direction=left]:translate-x-1/2",
            "data-ending-style:data-[activation-direction=right]:-translate-x-1/2",
            "grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3",
          )}
        >
          {children}
        </Primitive.Content>
      </Primitive.Item>
    );
  }

  return (
    <Primitive.Item className={cn("list-none", className)} {...props}>
      <Primitive.Link
        render={
          <LinkItem
            item={item}
            aria-label={item.type === "icon" ? item.label : undefined}
            className={cn(navItemVariants({ variant: item.type }))}
          >
            {item.type === "icon" ? item.icon : item.text}
          </LinkItem>
        }
      />
    </Primitive.Item>
  );
}

function MobileNavigationMenuLinkItem({
  item,
  ...props
}: {
  item: LinkItemType;
  className?: string;
}) {
  const { setOpen } = use(MobileNavigationMenuContext)!;

  if (item.type === "custom")
    return <div className={cn("grid", props.className)}>{item.children}</div>;

  if (item.type === "menu") {
    return (
      <div className={cn("mb-4 flex flex-col", props.className)}>
        <p className="mb-1 text-sm text-fd-muted-foreground">
          {item.url ? (
            <Link
              href={item.url}
              external={item.external}
              onClick={() => setOpen(false)}
            >
              {item.icon}
              {item.text}
            </Link>
          ) : (
            <>
              {item.icon}
              {item.text}
            </>
          )}
        </p>
        {item.items.map((child, i) => (
          <MobileNavigationMenuLinkItem key={i} item={child} />
        ))}
      </div>
    );
  }

  return (
    <LinkItem
      item={item}
      className={cn(
        {
          main: "inline-flex items-center gap-2 py-1.5 transition-colors hover:text-fd-popover-foreground/50 data-[active=true]:font-medium data-[active=true]:text-fd-primary [&_svg]:size-4",
          icon: buttonVariants({
            size: "icon",
            color: "ghost",
          }),
          button: buttonVariants({
            color: "secondary",
            className: "gap-1.5 [&_svg]:size-4",
          }),
        }[item.type ?? "main"],
        props.className,
      )}
      aria-label={item.type === "icon" ? item.label : undefined}
      onClick={() => setOpen(false)}
    >
      {item.icon}
      {item.type === "icon" ? undefined : item.text}
    </LinkItem>
  );
}
