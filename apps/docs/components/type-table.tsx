"use client";

// Vendored from fumadocs (`fumadocs add type-table`, base-ui). Adapted for the
// template contract: rows carry a name prefix, an ordered list of labelled
// detail rows, and no default/deprecated fields the contract never has.

import { useTranslations } from "@fuma-translate/react";
import { cva } from "class-variance-authority";
import Link from "fumadocs-core/link";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "fumadocs-ui/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import {
  Fragment,
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

import { cn } from "@/lib/cn";

/** One labelled line in an expanded row, e.g. `Liquid` → `{{ zt.noteLink }}`. */
export interface DetailNode {
  label: string;
  content: ReactNode;
}

export interface TypeNode {
  /** Additional description of the field. */
  description?: ReactNode;
  /** Type signature (short). */
  type: ReactNode;
  /** Type signature (full). */
  typeDescription?: ReactNode;
  /** Optional `href` for the type. */
  typeDescriptionLink?: string;
  required?: boolean;
  details?: readonly DetailNode[];
}

const fieldVariants = cva("text-fd-muted-foreground not-prose pe-2");

export function TypeTable({
  anchor,
  type,
  prefix,
  className,
  ...props
}: {
  type: Record<string, TypeNode>;
  /** Row anchors extend it, e.g. `creators` gives `#creators-family`. */
  anchor?: string;
  /** Rendered before every row name, e.g. `zt.`. */
  prefix?: string;
} & ComponentProps<"div">) {
  const t = useTranslations({ note: "type table" });

  return (
    <div
      className={cn(
        "@container my-6 flex flex-col overflow-hidden rounded-2xl border bg-fd-card p-1 text-sm text-fd-card-foreground",
        className,
      )}
      {...props}
    >
      <div className="not-prose flex items-center px-3 py-1 font-medium text-fd-muted-foreground">
        <p className="w-1/4">{t("Prop")}</p>
        <p className="@max-xl:hidden">{t("Type")}</p>
      </div>
      {Object.entries(type).map(([key, value]) => (
        <Item
          key={key}
          anchor={anchor}
          name={key}
          prefix={prefix}
          item={value}
        />
      ))}
    </div>
  );
}

function Item({
  anchor,
  name,
  prefix,
  item: {
    description,
    required = false,
    typeDescription,
    type,
    typeDescriptionLink,
    details = [],
  },
}: {
  anchor?: string;
  name: string;
  prefix?: string;
  item: TypeNode;
}) {
  const t = useTranslations({ note: "type table" });
  const [open, setOpen] = useState(false);
  const id = anchor ? `${anchor}-${name}` : undefined;

  useEffect(() => {
    const hash = window.location.hash;
    if (!id || !hash) return;
    if (`#${id}` === hash) setOpen(true);
  }, [id]);

  return (
    <Collapsible
      id={id}
      open={open}
      onOpenChange={(v) => {
        if (v && id) {
          window.history.replaceState(null, "", `#${id}`);
        }
        setOpen(v);
      }}
      className={cn(
        "scroll-m-20 overflow-hidden rounded-xl border transition-all",
        open
          ? "bg-fd-background shadow-sm not-last:mb-2"
          : "border-transparent",
      )}
    >
      <CollapsibleTrigger className="not-prose group relative flex w-full flex-row items-center px-3 py-2 text-start hover:bg-fd-accent">
        <code className="w-1/4 min-w-fit pe-2 font-mono font-medium text-fd-primary">
          {prefix}
          {name}
          {!required && "?"}
        </code>
        {typeDescriptionLink ? (
          <Link href={typeDescriptionLink} className="underline @max-xl:hidden">
            {type}
          </Link>
        ) : (
          <span className="@max-xl:hidden">{type}</span>
        )}
        <ChevronDown className="absolute inset-e-2 size-4 text-fd-muted-foreground transition-transform group-data-[open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="fd-scroll-container grid grid-cols-[1fr_3fr] gap-y-4 overflow-auto border-t p-3 text-sm">
          <div className="col-span-full prose prose-no-margin text-sm empty:hidden">
            {description}
          </div>
          {typeDescription && (
            <>
              <p className={cn(fieldVariants())}>{t("Type")}</p>
              <p className="not-prose my-auto">{typeDescription}</p>
            </>
          )}
          {details.map((detail) => (
            <Fragment key={detail.label}>
              <p className={cn(fieldVariants())}>{detail.label}</p>
              <div className="not-prose my-auto">{detail.content}</div>
            </Fragment>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
