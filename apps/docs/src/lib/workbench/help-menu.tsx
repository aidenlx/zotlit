// The web Workbench's Help menu, the twin of the Obsidian view's Help action:
// the docs pages a template author returns to, then the community. Each page
// opens in a new tab, so the template being edited stays open here.
import {
  BookOpen,
  ChevronDown,
  CircleHelp,
  MessagesSquare,
} from "lucide-react";

import { HELP_COMMUNITY, HELP_PAGES } from "@zotlit/workbench/ui";

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

export function HelpMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="xs" />}>
        <CircleHelp aria-hidden />
        {m.workbench_help()}
        <ChevronDown aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" size="xs">
        {HELP_PAGES.map(({ label, path }) => (
          <DropdownMenuLinkItem
            key={path}
            href={localizeHref(path)}
            target="_blank"
            rel="noreferrer"
          >
            <BookOpen aria-hidden />
            {m[label]()}
          </DropdownMenuLinkItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLinkItem
          href={localizeHref(HELP_COMMUNITY.path)}
          target="_blank"
          rel="noreferrer"
        >
          <MessagesSquare aria-hidden />
          {m[HELP_COMMUNITY.label]()}
        </DropdownMenuLinkItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
