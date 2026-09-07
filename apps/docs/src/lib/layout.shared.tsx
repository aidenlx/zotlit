import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import {
  BookIcon,
  MessageSquareMoreIcon,
  NewspaperIcon,
  UsersIcon,
} from "lucide-react";

import { Logo } from "@/components/logo";
import * as m from "@/paraglide/messages.js";

import { repoUrl } from "./shared";

/** Nav title and links shared by the home and docs layouts. */
export function baseOptions({
  includeDocsLink = true,
}: { includeDocsLink?: boolean } = {}): BaseLayoutProps {
  return {
    nav: { title: <Logo small className="ml-1 text-lg" /> },
    links: [
      ...(includeDocsLink
        ? [{ text: m.docs_nav_docs(), url: "/docs", icon: <BookIcon /> }]
        : []),
      {
        text: m.docs_nav_blog(),
        url: "/blog",
        icon: <MessageSquareMoreIcon />,
      },
      {
        text: m.docs_nav_changelog(),
        url: "/changelog",
        icon: <NewspaperIcon />,
      },
      { text: m.docs_nav_community(), url: "/community", icon: <UsersIcon /> },
    ],
    githubUrl: repoUrl,
  };
}
