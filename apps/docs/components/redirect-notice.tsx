"use client";

// Callout for visitors who arrived through a redirect. Driven entirely by the
// query contract documented in lib/v1-redirects.ts: `lang=zh-CN` picks the
// Chinese wording, and `from=v1` + `src` add a link to the exact v1 page. The
// route map stays server-side; this component reads the query and nothing else.

import { ArrowUpRight, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { cn } from "@/lib/cn";
import { zotlitLegacyUrl } from "@/lib/shared";

function Notice({ className }: { className?: string }) {
  const params = useSearchParams();
  const [dismissed, setDismissed] = useState(false);

  const isZh = params.get("lang") === "zh-CN";
  const src = params.get("src");
  // Guard against open-redirect input: only build the back-link from an
  // internal absolute path, never a caller-supplied host.
  const v1Src =
    params.get("from") === "v1" && src?.startsWith("/") && !src.startsWith("//")
      ? src
      : null;

  if (dismissed || (!isZh && !v1Src)) return null;

  return (
    <div
      className={cn(
        "not-prose relative flex flex-col gap-2 border border-fd-border bg-fd-card",
        "px-4 py-3 pe-10 text-[0.9rem] leading-snug text-fd-foreground",
        className,
      )}
    >
      {isZh ? (
        <p className="text-fd-muted-foreground" lang="zh-CN">
          ZotLit v2 中文内容尚未提供，当前显示英文页面。
        </p>
      ) : (
        <p className="text-fd-muted-foreground">
          You followed a link to the ZotLit v1 docs. This is the closest page in
          the v2 docs.
        </p>
      )}
      {v1Src && (
        <a
          href={`${zotlitLegacyUrl}${isZh ? "/zh-CN" : ""}${v1Src}`}
          target="_blank"
          rel="noreferrer noopener"
          lang={isZh ? "zh-CN" : undefined}
          className={cn(
            "inline-flex w-fit items-center gap-1 font-medium text-fd-primary",
            "underline decoration-fd-primary/40 underline-offset-[3px]",
            "transition-[text-decoration-color] hover:decoration-fd-primary",
          )}
        >
          {isZh ? "参阅 v1 中文文档" : "View the original v1 page"}
          <ArrowUpRight aria-hidden className="size-[1.05em]" />
        </a>
      )}
      <button
        type="button"
        aria-label={isZh ? "关闭提示" : "Dismiss notice"}
        onClick={() => setDismissed(true)}
        className="absolute inset-e-2 top-2 text-fd-muted-foreground/60 hover:text-fd-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export function RedirectNotice({ className }: { className?: string }) {
  // `useSearchParams` needs a Suspense boundary so only this notice reads the
  // query at runtime; the surrounding page stays statically generated.
  return (
    <Suspense fallback={null}>
      <Notice className={className} />
    </Suspense>
  );
}
