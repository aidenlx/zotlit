"use client";
// Shared "Left-gutter ledger" view for the 404 and runtime-error pages.
import { useSearchContext } from "fumadocs-ui/contexts/search";
import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/logo";
import { errorPageModel, type ErrorStatus } from "@/lib/error-page-model";

const rowClassName =
  "group flex w-full cursor-pointer items-center gap-3 py-2.5 text-left focus-visible:text-fd-primary outline-none";
const termClassName =
  "font-mono uppercase tracking-[0.1em] text-sm text-fd-foreground transition-colors group-hover:text-fd-primary group-focus-visible:text-fd-primary";

export function ErrorPage({
  status,
  onReset,
}: {
  status: ErrorStatus;
  onReset?: () => void;
}) {
  const { setOpenSearch } = useSearchContext();
  const model = errorPageModel(status);

  return (
    <div className="relative flex min-h-screen w-full flex-1 items-center justify-center bg-fd-background px-6 py-20">
      <Link
        href="/"
        aria-label="ZotLit home"
        data-error-brand
        className="absolute top-6 left-6 text-lg"
      >
        <Logo />
      </Link>
      <div className="grid w-full max-w-4xl grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-[10rem_1px_1fr]">
        <div className="text-left sm:text-right">
          <div className="font-mono text-5xl leading-none font-medium text-fd-foreground sm:text-6xl">
            {model.code}
          </div>
          <div className="mt-3 font-mono text-xs font-semibold tracking-[0.14em] text-fd-primary uppercase">
            {model.statusLabel}
          </div>
        </div>
        <div className="hidden border-l border-fd-border sm:block" />
        <div className="min-w-0">
          <h1 className="font-serif text-3xl font-medium text-fd-foreground sm:text-4xl">
            {model.headline}
          </h1>
          <p className="mt-3 font-serif text-lg text-fd-muted-foreground italic">
            {model.standfirst}
          </p>
          <div className="mt-8 border-t border-fd-border" />
          <p className="mt-8 font-mono text-xs font-semibold tracking-[0.14em] text-fd-muted-foreground uppercase">
            {model.exitLabel}
          </p>
          <div className="mt-3">
            {model.exits.map((exit) => {
              const content = (
                <>
                  <span className={termClassName}>{exit.label}</span>
                  <span
                    aria-hidden
                    className="flex-1 border-b border-dotted border-fd-border"
                  />
                  <ChevronRight
                    aria-hidden
                    size={16}
                    className="shrink-0 text-fd-primary transition-transform group-hover:translate-x-1"
                  />
                </>
              );

              if ("href" in exit) {
                const external = /^https?:\/\//.test(exit.href);
                return (
                  <a
                    key={exit.label}
                    href={exit.href}
                    className={rowClassName}
                    {...(external
                      ? { target: "_blank", rel: "noreferrer noopener" }
                      : {})}
                  >
                    {content}
                  </a>
                );
              }

              return (
                <button
                  key={exit.label}
                  type="button"
                  className={rowClassName}
                  onClick={
                    exit.action === "reset"
                      ? onReset
                      : () => setOpenSearch(true)
                  }
                >
                  {content}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
