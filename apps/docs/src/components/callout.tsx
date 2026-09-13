import { asMarkdown, md } from "fumadocs-core/server";
import {
  CircleCheck,
  CircleX,
  Info,
  Lightbulb,
  TriangleAlert,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/cn";

export type CalloutType =
  | "info"
  | "warn"
  | "error"
  | "success"
  | "warning"
  | "idea";

const iconClass = "size-5 -me-0.5 fill-(--callout-color) text-fd-card";

/** Obsidian's callout keyword for each type this component resolves to. */
const obsidianTypes: Record<CalloutType, string> = {
  info: "info",
  warn: "warning",
  warning: "warning",
  error: "error",
  success: "success",
  idea: "tip",
};

export function Callout({
  children,
  title,
  ...props
}: { title?: ReactNode } & Omit<CalloutContainerProps, "title">) {
  // A reader of the Markdown edition is working in Obsidian, so the callout
  // keeps its shape there: the type keyword in a `> [!type]` header, the title
  // beside it, and the body as the quoted lines under it.
  if (asMarkdown()) {
    const type = obsidianTypes[resolveAlias(props.type ?? "info")];
    const header = title ? md`[!${type}] ${title}` : `[!${type}]`;

    return md.linePrefix("> ")`${header}\n${children}`;
  }

  return (
    <CalloutContainer {...props}>
      {title && <CalloutTitle>{title}</CalloutTitle>}
      <CalloutDescription>{children}</CalloutDescription>
    </CalloutContainer>
  );
}

export interface CalloutContainerProps extends ComponentProps<"div"> {
  /**
   * @defaultValue info
   */
  type?: CalloutType;

  /**
   * Force an icon
   */
  icon?: ReactNode;
}

function resolveAlias(type: CalloutType) {
  if (type === "warn") return "warning";
  if ((type as unknown) === "tip") return "info";
  return type;
}

export function CalloutContainer({
  type: inputType = "info",
  icon,
  children,
  className,
  style,
  ...props
}: CalloutContainerProps) {
  const type = resolveAlias(inputType);

  return (
    <div
      className={cn(
        "my-4 flex gap-2 rounded-xl border bg-fd-card p-3 ps-1 text-sm text-fd-card-foreground shadow-md",
        className,
      )}
      style={
        {
          "--callout-color": `var(--color-fd-${type}, var(--color-fd-muted))`,
          ...style,
        } as object
      }
      {...props}
    >
      <div role="none" className="w-0.5 rounded-sm bg-(--callout-color)/50" />
      {icon ??
        {
          info: <Info className={iconClass} />,
          warning: <TriangleAlert className={iconClass} />,
          error: <CircleX className={iconClass} />,
          success: <CircleCheck className={iconClass} />,
          idea: (
            <Lightbulb className="-me-0.5 size-5 fill-(--callout-color) text-(--callout-color)" />
          ),
        }[type]}
      <div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div>
    </div>
  );
}

export function CalloutTitle({
  children,
  className,
  ...props
}: ComponentProps<"p">) {
  return (
    <p className={cn("my-0! font-medium", className)} {...props}>
      {children}
    </p>
  );
}

export function CalloutDescription({
  children,
  className,
  ...props
}: ComponentProps<"p">) {
  return (
    <div
      className={cn(
        "prose-no-margin text-fd-muted-foreground empty:hidden",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
