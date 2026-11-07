// The web Workbench's Help menu, the twin of the Obsidian view's Help action:
// the docs pages a template author returns to, then the community. Each page
// opens in a new tab, so the template being edited stays open here; the
// trailing arrow shows it, and a screen reader hears it.
import {
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  CircleHelp,
  MessagesSquare,
} from "lucide-react";
import type { ReactNode } from "react";

import { HELP_PAGES, useWorkbenchHost } from "@zotlit/workbench/ui";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";

/** One page of the menu, which opens in a new tab and says so. */
function HelpLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <DropdownMenuLinkItem href={href} target="_blank" rel="noreferrer">
      {icon}
      {children}
      <ArrowUpRight aria-hidden className="ms-auto" />
      <span className="sr-only"> {m.docs_workbench_opens_new_tab()}</span>
    </DropdownMenuLinkItem>
  );
}

export function HelpMenu() {
  // The host's community link, which the Problems area offers too.
  const { communityUrl } = useWorkbenchHost();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="xs" />}>
        <CircleHelp aria-hidden />
        {m.workbench_help()}
        <ChevronDown aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" size="xs">
        {HELP_PAGES.map(({ label, path }) => (
          <HelpLink
            key={path}
            href={localizeHref(path)}
            icon={<BookOpen aria-hidden />}
          >
            {m[label]()}
          </HelpLink>
        ))}
        {communityUrl !== undefined && (
          <>
            <DropdownMenuSeparator />
            <HelpLink href={communityUrl} icon={<MessagesSquare aria-hidden />}>
              {m.workbench_problems_community()}
            </HelpLink>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
