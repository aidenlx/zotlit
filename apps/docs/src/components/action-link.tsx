import Link from "fumadocs-core/link";
import { ArrowUpRight, Download, Link as LinkIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ObsidianMark } from "@/components/obsidian-mark.tsx";
import { cn } from "@/lib/cn.ts";

type ActionKind = "download" | "obsidian" | "external";

const icons: Record<ActionKind, (props: { className?: string }) => ReactNode> =
  {
    download: ({ className }) => <Download className={className} />,
    obsidian: ({ className }) => <ObsidianMark className={className} />,
    external: ({ className }) => <LinkIcon className={className} />,
  };

export interface ActionLinkProps {
  href: string;
  kind: ActionKind;
  /** Mono filename rendered beside the link (download only). */
  filename?: string;
  children: ReactNode;
}

/**
 * Square hairline-bordered link with a leading kind glyph and a trailing arrow,
 * matching the changelog's "Open release" device. `download` saves the asset;
 * `obsidian` opens an `obsidian://` deep link in the app; `external` opens a web
 * page in a new tab.
 */
export function ActionLink({
  href,
  kind,
  filename,
  children,
}: ActionLinkProps) {
  const Icon = icons[kind];
  const isSelfLink = href.startsWith("/");
  const linkClassName = cn(
    "inline-flex items-center gap-2 border border-fd-border bg-fd-card px-3 py-1.5",
    "text-[0.92rem] font-medium text-fd-foreground",
    "hover:border-fd-primary hover:text-fd-primary",
    "[&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit",
  );
  const content = (
    <>
      <Icon className="size-[1.05em] shrink-0 text-fd-primary" />
      <span>{children}</span>
      <ArrowUpRight
        aria-hidden
        className="size-[1.05em] shrink-0 text-fd-primary"
      />
    </>
  );
  return (
    <span className="not-prose inline-flex flex-wrap items-center gap-x-3 gap-y-1.5 align-middle">
      {isSelfLink ? (
        <Link href={href} className={linkClassName}>
          {content}
        </Link>
      ) : (
        <a
          href={href}
          {...(kind === "download"
            ? { download: true }
            : { target: "_blank", rel: "noreferrer noopener" })}
          className={linkClassName}
        >
          {content}
        </a>
      )}
      {filename && (
        <span className="font-mono text-[0.76rem] text-fd-muted-foreground">
          {filename}
        </span>
      )}
    </span>
  );
}
