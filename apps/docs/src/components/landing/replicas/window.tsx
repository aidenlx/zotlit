// The plain window every landing replica sits in: our own frame, not
// Obsidian's — a title bar with the view's icon and name, then the pane that
// matters. Inside, the replicas use ZotLit's own labels (the plugin's `m.*`
// messages), the plugin's Lucide icons, and its class vocabulary mapped onto
// the site tokens.
// @see apps/docs/DESIGN.md → Illustration, Landing (Replicas)

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export function ReplicaWindow({
  icon: Icon,
  title,
  label,
  children,
  className,
}: {
  icon: LucideIcon;
  /** The view's own name, as the plugin titles its tab. */
  title: string;
  /**
   * What the picture shows, for readers who cannot see it. Without one the
   * window is a working control, and its body stays in the accessibility tree.
   */
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={label ? "img" : undefined}
      aria-label={label}
      className={cn(
        "@container overflow-hidden rounded-xl border border-transparent bg-fd-card text-fd-foreground shadow-ring",
        className,
      )}
    >
      <div
        aria-hidden
        className="flex h-9 items-center gap-2 border-b border-fd-border px-3 text-[13px] text-fd-muted-foreground"
      >
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-fd-border" />
          <span className="size-2.5 rounded-full bg-fd-border" />
          <span className="size-2.5 rounded-full bg-fd-border" />
        </span>
        <Icon className="ms-2 size-3.5" strokeWidth={1.5} />
        <span className="truncate">{title}</span>
      </div>
      <div aria-hidden={label ? true : undefined}>{children}</div>
    </div>
  );
}
