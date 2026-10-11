// The explicit English-page action for unapproved or missing Chinese content.

import { useRouterState } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useSyncExternalStore } from "react";

import type { PageLocaleState } from "@/lib/translation-state";
import * as m from "@/paraglide/messages.js";

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

export function LocaleFallbackNotice({ state }: { state: PageLocaleState }) {
  const location = useRouterState({
    select: (router) => ({
      publicHref: router.location.publicHref,
      // Router-only history updates must also re-read the browser fragment.
      hash: router.location.hash,
    }),
  });
  const hash = useSyncExternalStore(subscribeToHash, browserHash, serverHash);
  if (!state.isPlaceholder) return null;

  const url = new URL(location.publicHref, "https://zotlit.invalid");
  url.hash = hash;
  // Preserve the arrival query: a V1 Chinese archive link stays Chinese even
  // when the reader chooses the English V2 page. Readiness owns this notice.
  const englishHref = `${state.canonicalPath}${url.search}${url.hash}`;

  return (
    <div
      role="note"
      lang="en"
      className="not-prose flex flex-col gap-2 border-b border-fd-border bg-fd-card px-6 py-3 text-[0.9rem] leading-snug text-fd-foreground"
    >
      <p className="text-fd-muted-foreground">
        {m.docs_locale_fallback({}, { locale: "en" })}
      </p>
      {/* A native anchor leaves the Chinese locale instead of passing through
          the router's outgoing locale rewrite. */}
      <a
        href={englishHref}
        className="inline-flex w-fit items-center gap-1 font-medium text-fd-primary underline decoration-fd-primary/40 underline-offset-[3px] transition-[text-decoration-color] hover:decoration-fd-primary"
      >
        {m.docs_read_in_english({}, { locale: "en" })}
        <ArrowRight aria-hidden className="size-[1.05em]" />
      </a>
    </div>
  );
}
