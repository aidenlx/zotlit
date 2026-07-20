"use client";

// Contextual notice shown at the top of a docs page when the visitor arrived
// via a v1→v2 permalink redirect (`?from=v1&src=<v1-path>`). Links back to the
// exact v1 page and, for `zh-CN` sources, flags that v2 is English-only for now.

import { ArrowUpRight, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { cn } from "@/lib/cn";
import { zotlitLegacyUrl } from "@/lib/shared";

function Notice() {
  const params = useSearchParams();
  const [dismissed, setDismissed] = useState(false);

  const src = params.get("src");
  // Guard against open-redirect input: only build the back-link from an
  // internal absolute path, never a caller-supplied host.
  if (
    dismissed ||
    params.get("from") !== "v1" ||
    !src ||
    !src.startsWith("/") ||
    src.startsWith("//")
  ) {
    return null;
  }

  const isZh = params.get("lang") === "zh-CN";
  const href = `${zotlitLegacyUrl}${isZh ? "/zh-CN" : ""}${src}`;

  return (
    <div
      className={cn(
        "not-prose relative mb-6 flex flex-col gap-2 border border-fd-border bg-fd-card",
        "px-4 py-3 pe-10 text-[0.9rem] leading-snug text-fd-foreground",
      )}
    >
      <p className="text-fd-muted-foreground">
        You followed a link to the ZotLit v1 docs. This is the closest page in
        the v2 docs.
      </p>
      {isZh && (
        <p className="text-fd-muted-foreground" lang="zh-CN">
          中文 v2 文档尚未翻译，暂显示英文版。
        </p>
      )}
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className={cn(
          "inline-flex w-fit items-center gap-1 font-medium text-fd-primary",
          "underline decoration-fd-primary/40 underline-offset-[3px]",
          "transition-[text-decoration-color] hover:decoration-fd-primary",
        )}
      >
        View the original v1 page
        <ArrowUpRight aria-hidden className="size-[1.05em]" />
      </a>
      <button
        type="button"
        aria-label="Dismiss notice"
        onClick={() => setDismissed(true)}
        className="absolute inset-e-2 top-2 text-fd-muted-foreground/60 hover:text-fd-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export function V1RedirectNotice() {
  // `useSearchParams` needs a Suspense boundary so only this notice reads the
  // query at runtime; the surrounding docs page stays statically generated.
  return (
    <Suspense fallback={null}>
      <Notice />
    </Suspense>
  );
}
