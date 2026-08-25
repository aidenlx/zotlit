import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import {
  BookIcon,
  MessageSquareMoreIcon,
  NewspaperIcon,
  UsersIcon,
} from "lucide-react";

import { Logo } from "@/components/logo.tsx";

import { repoUrl } from "./shared.ts";

/** Nav title and links shared by the home and docs layouts. */
export function baseOptions({
  includeDocsLink = true,
}: { includeDocsLink?: boolean } = {}): BaseLayoutProps {
  return {
    nav: { title: <Logo small className="ml-1 text-lg" /> },
    links: [
      ...(includeDocsLink
        ? [{ text: "Docs", url: "/docs", icon: <BookIcon /> }]
        : []),
      { text: "Blog", url: "/blog", icon: <MessageSquareMoreIcon /> },
      { text: "Changelog", url: "/changelog", icon: <NewspaperIcon /> },
      { text: "Community", url: "/community", icon: <UsersIcon /> },
    ],
    githubUrl: repoUrl,
  };
}
