// The language strip at the top of a page. It has two states:
// - a `/zh-CN` page with no Chinese file says English is shown and links to the English page;
// - an English page with a Chinese edition offers that edition to a reader whose browser puts Chinese first.

import { useRouterState } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Banner } from "@/components/banner";
import {
  CHINESE_READER_ATTR,
  rememberLanguageChoice,
} from "@/lib/language-choice";
import type { PageLocaleState } from "@/lib/locale-state";
import * as m from "@/paraglide/messages.js";
import { getLocale } from "@/paraglide/runtime.js";

function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

const browserHash = () => window.location.hash;
// Fragments never reach the server. React reads the browser snapshot after
// hydration, including when the router still carries its server snapshot.
const serverHash = () => "";

const STRIP_HEIGHT = "2.25rem";

/** The suggestion strip's marker attribute, which its visibility rule names. */
const SUGGESTION_ATTR = "data-chinese-edition";

/**
 * Full-height app shells, where a top strip would push the app's own bottom
 * bar off the screen.
 */
const appShellPages: ReadonlySet<string> = new Set(["/workbench"]);

export function LanguageBanner({ state }: { state: PageLocaleState }) {
  const location = useRouterState({
    select: (router) => ({
      publicHref: router.location.publicHref,
      // Router-only history updates must also re-read the browser fragment.
      hash: router.location.hash,
    }),
  });
  const hash = useSyncExternalStore(subscribeToHash, browserHash, serverHash);

  const url = new URL(location.publicHref, "https://zotlit.invalid");
  url.hash = hash;

  if (state.isFallback) {
    // Preserve the arrival query: a V1 Chinese archive link stays Chinese even
    // when the reader chooses the English V2 page. The missing locale file owns this notice.
    const englishHref = `${state.canonicalPath}${url.search}${url.hash}`;

    // The thin top strip: `--fd-banner-height` moves the sticky header and
    // sidebar down by its height instead of the notice pushing the page.
    return (
      <Banner
        role="note"
        lang={getLocale()}
        height={STRIP_HEIGHT}
        className={STRIP_CLASS}
      >
        <StripText
          message={m.docs_locale_fallback()}
          href={englishHref}
          action={m.docs_read_in_english()}
        />
      </Banner>
    );
  }

  const chinese = state.alternates.find(
    (alternate) => alternate.locale === "zh-CN",
  );
  if (
    state.contentLocale !== "en" ||
    !chinese ||
    appShellPages.has(state.canonicalPath)
  )
    return null;

  // In the HTML of every eligible page, shown only under the attribute that the
  // <head> script sets before the first paint; the same attribute sets the strip
  // height, so a reader who does not see the strip gets no gap either.
  return (
    <Banner
      {...{ [SUGGESTION_ATTR]: "" }}
      role="note"
      lang="zh-CN"
      height={STRIP_HEIGHT}
      changeLayout={false}
      onClose={() => rememberLanguageChoice("en")}
      className={STRIP_CLASS}
    >
      <style>
        {`:root:not([${CHINESE_READER_ATTR}]) [${SUGGESTION_ATTR}] { display: none; }` +
          ` :root[${CHINESE_READER_ATTR}] { --fd-banner-height: ${STRIP_HEIGHT}; }`}
      </style>
      <StripText
        message={m.docs_chinese_edition_available({}, { locale: "zh-CN" })}
        href={`${chinese.path}${url.search}${url.hash}`}
        action={m.docs_read_in_chinese({}, { locale: "zh-CN" })}
      />
    </Banner>
  );
}

const STRIP_CLASS =
  "not-prose border-b border-fd-border/70 bg-fd-secondary py-2 text-fd-secondary-foreground";

function StripText({
  message,
  href,
  action,
}: {
  message: string;
  href: string;
  action: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-center gap-x-1.5 px-7 text-[0.8125rem] leading-snug tracking-[0.005em]">
      <p className="text-balance">{message}</p>
      {/* A native anchor changes the locale with the page, instead of passing
          through the router's outgoing locale rewrite. */}
      <a
        href={href}
        className="font-medium whitespace-nowrap text-fd-primary underline decoration-fd-primary/40 underline-offset-[3px] transition-[text-decoration-color] hover:decoration-fd-primary"
      >
        {action}
        <ArrowRight
          aria-hidden
          className="ms-0.5 inline size-[1.05em] shrink-0 align-[-0.14em]"
        />
      </a>
    </div>
  );
}
