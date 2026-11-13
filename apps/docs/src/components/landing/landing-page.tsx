// The landing page, top to bottom: the hero on its research desk, the
// research sequence in five steps, the collection-to-table demo, the trust
// row, and the closing call to install.
// The page prerenders in its final, readable state; motion starts after
// load, and only with motion allowed.
// @see apps/docs/DESIGN.md → Landing

import type { ReactNode } from "react";

import { m } from "@/paraglide/messages.js";

import { Hero } from "./hero";
import { Actions } from "./parts";
import { TableDemo } from "./table-demo";
import { Workflow } from "./workflow";

const TRUST = [
  m.docs_home_trust_private,
  m.docs_home_trust_open,
  m.docs_home_trust_zotero,
] as const;

function Trust() {
  return (
    <section className="border-t border-fd-border py-16">
      <ul className="mx-auto grid max-w-6xl gap-8 px-4 sm:grid-cols-3 sm:px-8">
        {TRUST.map((lead) => (
          <li
            key={lead()}
            className="font-serif text-xl font-medium text-balance"
          >
            {lead()}
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
      </div>
    </section>
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
