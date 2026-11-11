// The closing section, "Set up your desk": the two actions, the three install
// steps, what a reader needs, the optional Zotero add-ons, and the privacy and
// licence lines.
// @see apps/docs/DESIGN.md → Landing (Setup)

import {
  ArrowUpRight,
  Library,
  Monitor,
  NotebookPen,
  Quote,
  Scale,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";

import { Message } from "@/components/message";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";

import { ActionLink, INSTALL_HREF, TUTORIAL_HREF } from "./parts";

const LABEL =
  "font-mono text-[11px] font-medium tracking-[0.08em] text-fd-muted-foreground uppercase";

function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={localizeHref(href)}
      className="inline-flex items-center gap-1 text-[14.5px] font-semibold text-fd-foreground transition-colors duration-150 ease-out hover:text-fd-primary"
    >
      {children}
      <ArrowUpRight aria-hidden className="size-[15px]" strokeWidth={2.25} />
    </a>
  );
}

export function Setup({ repo }: { repo: ReactNode }) {
  const steps = [
    {
      name: m.docs_home_step_install(),
      line: m.docs_home_step_install_line(),
      href: INSTALL_HREF,
      link: m.docs_home_step_open_obsidian(),
    },
    {
      name: m.docs_home_step_connect(),
      line: m.docs_home_step_connect_line(),
      href: TUTORIAL_HREF,
      link: m.docs_home_step_follow(),
    },
    {
      name: m.docs_home_step_open(),
      line: m.docs_home_step_open_line(),
      href: TUTORIAL_HREF,
      link: m.docs_home_step_follow(),
    },
  ];
  const need = [
    { Icon: NotebookPen, text: m.docs_home_need_obsidian() },
    { Icon: Library, text: m.docs_home_need_zotero() },
    { Icon: Monitor, text: m.docs_home_need_platforms() },
    {
      Icon: Quote,
      text: (
        <>
          <span className="font-semibold">
            {m.docs_home_need_pandoc_name()}.
          </span>{" "}
          {m.docs_home_need_pandoc()}
        </>
      ),
    },
  ];
  const addons = [
    {
      name: m.docs_home_addon_companion(),
      line: m.docs_home_addon_companion_line(),
      href: "/docs/install-companion",
    },
    {
      name: m.docs_home_addon_bbt(),
      line: m.docs_home_addon_bbt_line(),
      href: "/docs/how-to/insert-citations",
    },
  ];
  return (
    <section aria-labelledby="landing-setup" className="pt-8 pb-16">
      <div className="grid gap-12 border-t border-fd-border pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-16 lg:pt-20">
        <div>
          <h2
            id="landing-setup"
            className="font-serif text-[2.25rem] leading-[1.08] font-medium sm:text-[2.75rem]"
          >
            {m.docs_home_setup_title()}
          </h2>
          <p className="mt-3 text-[17.5px] leading-relaxed text-fd-muted-foreground">
            {m.docs_home_setup_lede()}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ActionLink href={INSTALL_HREF} primary>
              {m.docs_home_install()}
            </ActionLink>
            <ActionLink href={TUTORIAL_HREF}>
              {m.docs_home_tutorial()}
            </ActionLink>
          </div>
        </div>
        <div>
          <ol className="grid divide-fd-border overflow-hidden rounded-[14px] border border-transparent bg-fd-card shadow-ring max-md:divide-y md:grid-cols-3 md:divide-x">
            {steps.map((s, i) => (
              <li key={s.name} className="flex flex-col p-6">
                <span className="font-mono text-[12px] text-fd-primary tabular-nums">
                  <Message
                    text={m.docs_home_step_label({ number: "{number}" })}
                    slots={{ number: i + 1 }}
                  />
                </span>
                <h3 className="mt-2 text-[17px] leading-snug font-semibold">
                  {s.name}
                </h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-fd-muted-foreground">
                  {s.line}
                </p>
                <div className="mt-auto pt-5">
                  <MoreLink href={s.href}>{s.link}</MoreLink>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-12 grid gap-10 sm:grid-cols-2">
            <div>
              <h3 className={LABEL}>{m.docs_home_need_label()}</h3>
              <ul className="mt-4 grid gap-3">
                {need.map(({ Icon, text }, i) => (
                  <li
                    // oxlint-disable-next-line react/no-array-index-key -- a fixed list
                    key={i}
                    className="flex items-start gap-3 text-[15.5px] leading-snug"
                  >
                    <Icon
                      aria-hidden
                      className="mt-0.5 size-[17px] shrink-0 text-fd-muted-foreground"
                      strokeWidth={1.5}
                    />
                    <span>{text}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className={LABEL}>{m.docs_home_addons_label()}</h3>
              <ul className="mt-4 grid gap-4">
                {addons.map((a) => (
                  <li key={a.name}>
                    <p className="text-[15.5px] font-semibold">{a.name}</p>
                    <p className="mt-0.5 text-[15px] leading-snug text-fd-muted-foreground">
                      {a.line}
                    </p>
                    <div className="mt-1">
                      <MoreLink href={a.href}>
                        {m.docs_home_addon_install()}
                      </MoreLink>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-12 grid gap-5 border-t border-fd-border pt-8 text-[15.5px] leading-snug sm:grid-cols-2">
            <p className="flex items-start gap-3">
              <ShieldCheck
                aria-hidden
                className="mt-0.5 size-[18px] shrink-0 text-fd-muted-foreground"
                strokeWidth={1.5}
              />
              {m.docs_home_privacy()}
            </p>
            <p className="flex items-start gap-3">
              <Scale
                aria-hidden
                className="mt-0.5 size-[18px] shrink-0 text-fd-muted-foreground"
                strokeWidth={1.5}
              />
              <span>
                {m.docs_home_license()}
                <span className="mt-2 block">{repo}</span>
              </span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
