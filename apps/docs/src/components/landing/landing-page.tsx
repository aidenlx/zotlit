// The landing page, top to bottom: the hero on its research desk, the
// research sequence in five steps, the collection-to-table demo, the trust
// row, and the closing call to start the tutorial.
// The page prerenders in its final, readable state; motion starts after
// load, and only with motion allowed.
// @see apps/docs/DESIGN.md → Landing

import type { ReactNode } from "react";

import { textLinkClass } from "@/components/learn/action-classes";
import { Message } from "@/components/message";
import { cn } from "@/lib/cn";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";

import { Hero } from "./hero";
import { Actions } from "./parts";
import { TableDemo } from "./table-demo";
import { Workflow } from "./workflow";

const TRUST = [
  [m.docs_home_trust_private, m.docs_home_privacy],
  [m.docs_home_trust_open, m.docs_home_license],
  [m.docs_home_trust_zotero, m.docs_home_trust_zotero_line],
] as const;

function Trust() {
  return (
    <section className="border-t border-fd-border py-16">
      <ul className="mx-auto grid max-w-6xl gap-8 px-4 sm:grid-cols-3 sm:px-8">
        {TRUST.map(([lead, line]) => (
          <li key={lead()}>
            <p className="font-serif text-xl font-medium text-balance">
              {lead()}
            </p>
            <p className="mt-2 text-base text-pretty text-fd-muted-foreground">
              {line()}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Closing() {
  return (
    <section
      aria-labelledby="landing-close-title"
      className="bg-fd-muted py-20 text-center sm:py-24"
    >
      <div className="mx-auto flex max-w-3xl flex-col items-center px-4 sm:px-8">
        <h2
          id="landing-close-title"
          className="font-serif text-3xl leading-[1.2] font-medium text-balance sm:text-5xl sm:leading-[1.15]"
        >
          {m.docs_home_close_title()}
        </h2>
        <Actions className="mt-8" />
        <p className="mt-8 text-[0.9375rem] text-pretty text-fd-muted-foreground">
          <Message
            text={m.docs_home_close_switch({
              compare: "{compare}",
              trouble: "{trouble}",
            })}
            slots={{
              compare: (
                <AnswerLink path="/docs/answers/zotlit-vs-zotero-integration-vs-citations">
                  {m.docs_home_close_compare()}
                </AnswerLink>
              ),
              trouble: (
                <AnswerLink path="/docs/answers/zotero-integration-not-working">
                  {m.docs_home_close_trouble()}
                </AnswerLink>
              ),
            }}
          />
        </p>
      </div>
    </section>
  );
}

/** A link to an answer page for readers who use another Zotero plugin. */
function AnswerLink({ path, children }: { path: string; children: string }) {
  return (
    <a
      href={localizeHref(path)}
      className={cn(
        textLinkClass,
        "font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary",
      )}
    >
      {children}
    </a>
  );
}

export function LandingPage({ footer }: { footer: ReactNode }) {
  return (
    <div className="flex w-full flex-1 flex-col overflow-x-clip">
      <Hero />
      <Workflow />
      <TableDemo />
      <Trust />
      <Closing />
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-8">{footer}</div>
    </div>
  );
}
