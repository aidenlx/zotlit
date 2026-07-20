"use client";

// Interim landing notice for Chinese v1 permalinks. While v2 has no zh-CN docs,
// `/zh-CN/*` bounces to the English home (see lib/v1-redirects.mjs); this reads
// the `?from=v1&src=&lang=zh-CN` hint and points the visitor at the English
// equivalent page (or /docs) plus the exact original v1 page. Dead once zh-CN
// i18n ships and no zh path lands on `/`.

import { ArrowUpRight, ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { cn } from "@/lib/cn";
import { zotlitLegacyUrl } from "@/lib/shared";
import { PAGE_MAP } from "@/lib/v1-redirects.mjs";

const linkClass = cn(
  "inline-flex items-center gap-1 font-medium text-fd-primary",
  "underline decoration-fd-primary/40 underline-offset-[3px]",
  "transition-[text-decoration-color] hover:decoration-fd-primary",
);

function Notice() {
  const params = useSearchParams();
  const [dismissed, setDismissed] = useState(false);

  const src = params.get("src");
  // Guard against open-redirect input: only rebuild the back-link from an
  // internal absolute path, never a caller-supplied host.
  if (
    dismissed ||
    params.get("from") !== "v1" ||
    params.get("lang") !== "zh-CN" ||
    !src ||
    !src.startsWith("/") ||
    src.startsWith("//")
  ) {
    return null;
  }

  const v1Href = `${zotlitLegacyUrl}/zh-CN${src === "/" ? "" : src}`;
  const equivalent = PAGE_MAP[src];

  return (
    <aside className="relative mt-6 border border-s-2 border-fd-border border-s-fd-primary bg-fd-card px-5 py-4 pe-11 shadow-[4px_4px_0_0_var(--color-fd-border)]">
      <p
        lang="zh-CN"
        className="text-[0.95rem] leading-relaxed text-fd-foreground"
      >
        ZotLit v2 的中文文档尚未就绪，已跳转到英文站首页。
      </p>
      <p
        lang="zh-CN"
        className="mt-2.5 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[0.9rem]"
      >
        {equivalent ? (
          <Link href={equivalent} className={linkClass}>
            阅读此页的英文版
            <ChevronRight aria-hidden className="size-[1em]" />
          </Link>
        ) : (
          <Link href="/docs" className={linkClass}>
            浏览 v2 英文文档
            <ChevronRight aria-hidden className="size-[1em]" />
          </Link>
        )}
        <a
          href={v1Href}
          target="_blank"
          rel="noreferrer noopener"
          className={linkClass}
        >
          打开原 v1 页面
          <ArrowUpRight aria-hidden className="size-[1em]" />
        </a>
      </p>
      <button
        type="button"
        aria-label="关闭提示"
        onClick={() => setDismissed(true)}
        className="absolute inset-e-2 top-3 text-fd-muted-foreground/60 hover:text-fd-foreground"
      >
        <X className="size-4" />
      </button>
    </aside>
  );
}

export function V1HomeNotice() {
  // `useSearchParams` needs a Suspense boundary so only this notice reads the
  // query at runtime; the home page stays statically generated.
  return (
    <Suspense fallback={null}>
      <Notice />
    </Suspense>
  );
}
