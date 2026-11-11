// Job 1, "Bring your library": the Library View's library tree as ZotLit fills
// it from the Zotero database on disk — My Library with its collections and
// two group libraries — while Zotero itself is closed.
// Replica of apps/obsidian/src/views/library/library-tree.tsx and the
// welcome checklist's connect step (views/welcome/Welcome.tsx).

import {
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Folder,
  Library,
  LoaderCircle,
  Users,
} from "lucide-react";
import { useRef } from "react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { m } from "@/paraglide/messages.js";

import { COLLECTION, PAPERS } from "./papers";
import { useLoop } from "./use-loop";
import { ReplicaWindow } from "./window";

function Row({
  depth = 0,
  icon,
  open,
  selected,
  count,
  children,
}: {
  depth?: number;
  icon: ReactNode;
  open?: boolean;
  selected?: boolean;
  count?: number;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-md py-1 pe-2 text-[13px]",
        selected
          ? "bg-fd-muted font-medium text-fd-foreground"
          : "text-fd-muted-foreground",
      )}
      style={{ paddingInlineStart: 6 + depth * 16 }}
    >
      <span className="w-3.5 shrink-0">
        {open === true && (
          <ChevronDown className="size-3.5" strokeWidth={1.5} />
        )}
        {open === false && (
          <ChevronRight className="size-3.5" strokeWidth={1.5} />
        )}
      </span>
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count !== undefined && (
        <span className="text-[11.5px] tabular-nums">{count}</span>
      )}
    </div>
  );
}

const ICON = "size-3.5 shrink-0";

/** How long each frame of the loop shows, in ms; the last is the finished frame. */
const FRAMES = [1400, 5200];

export default function ConnectReplica() {
  const ref = useRef<HTMLDivElement>(null);
  // Looking for Zotero, then the libraries arrive.
  const frame = useLoop(ref, FRAMES);
  const ready = frame === 1;
  return (
    <div ref={ref}>
      <ReplicaWindow
        icon={Library}
        title={m.library_view_name()}
        label={`${m.library_view_name()}: ${m.settings_library_scope_personal()}, ${COLLECTION}, Shared Reading, Lab Archive`}
      >
        <div className="grid @xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
          <div className="border-fd-border p-3 @xl:border-e">
            <p className="px-1.5 pb-1.5 font-mono text-[10.5px] tracking-[0.08em] text-fd-muted-foreground uppercase">
              {m.library_view_tree_label()}
            </p>
            <Row icon={<Clock className={ICON} strokeWidth={1.5} />}>
              {m.library_view_recent()}
            </Row>
            <div
              className={cn(
                "transition-opacity duration-150 ease-out",
                ready ? "opacity-100" : "opacity-0",
              )}
            >
              <Row open icon={<Library className={ICON} strokeWidth={1.5} />}>
                {m.settings_library_scope_personal()}
              </Row>
              <Row
                depth={1}
                selected
                icon={<Folder className={ICON} strokeWidth={1.5} />}
                count={PAPERS.length}
              >
                {COLLECTION}
              </Row>
              <Row
                depth={1}
                icon={<Folder className={ICON} strokeWidth={1.5} />}
                count={1}
              >
                Data visualization
              </Row>
              <Row
                open={false}
                icon={<Users className={ICON} strokeWidth={1.5} />}
              >
                Shared Reading
              </Row>
              <Row
                open={false}
                icon={<Users className={ICON} strokeWidth={1.5} />}
              >
                Lab Archive
              </Row>
            </div>
          </div>
          <div className="grid content-start gap-3 border-t border-fd-border p-4 @xl:border-t-0">
            <div className="flex items-start gap-3 rounded-lg bg-fd-muted p-3">
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full",
                  ready
                    ? "bg-fd-primary text-fd-primary-foreground"
                    : "text-fd-muted-foreground",
                )}
              >
                {ready ? (
                  <Check className="size-3.5" strokeWidth={2.25} />
                ) : (
                  <LoaderCircle
                    className="size-4 motion-safe:animate-spin"
                    strokeWidth={1.5}
                  />
                )}
              </span>
              <div className="min-w-0">
                <p className="text-[14px] font-semibold">
                  {m.welcome_step_connect_title()}
                </p>
                <p className="text-[13px] text-fd-muted-foreground">
                  {ready
                    ? m.welcome_step_connect_connected({ count: 1284 })
                    : m.welcome_step_connect_checking()}
                </p>
              </div>
            </div>
            <div
              className={cn(
                "grid gap-1.5 text-[13px] transition-opacity duration-150 ease-out",
                ready ? "opacity-100" : "opacity-0",
              )}
            >
              <div className="flex justify-between gap-3 border-b border-fd-border pb-1.5">
                <span className="text-fd-muted-foreground">
                  {m.settings_library_scope_name()}
                </span>
                <span className="font-medium">
                  {m.settings_library_scope_all()}
                </span>
              </div>
              {[
                { name: m.settings_library_scope_personal(), Icon: Library },
                { name: "Shared Reading", Icon: Users },
                { name: "Lab Archive", Icon: Users },
              ].map(({ name, Icon }) => (
                <div
                  key={name}
                  className="flex items-center gap-2 text-fd-muted-foreground"
                >
                  <Icon className={ICON} strokeWidth={1.5} />
                  <span>{name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </ReplicaWindow>
    </div>
  );
}
