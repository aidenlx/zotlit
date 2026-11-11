// The working draft of the "Cite while you write" moment: the visitor types
// `[@`, picks a paper from the citation suggester, and the citation shows
// formatted, as ZotLit renders it in Live Preview once the cursor moves away.
// `[@sandve2013, p. 2]` reads as "(Sandve et al. 2013, 2)".
//
// The line is a run of committed tokens (text and rendered citations) and one
// text field at its end. Backspace in the empty field takes the last token
// back into the field as Markdown, so a citation can be edited, as in the app.
// Replica of the citation suggester (apps/obsidian/src/services/item-lookup/
// render-hit.ts, views/citation-suggest/) and the `zt-citation` widget
// (services/citekey-editor/).

import { ArrowRight, NotebookPen } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { INSTALL_HREF } from "@/components/landing/parts";
import { Message } from "@/components/message";
import { cn } from "@/lib/cn";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";

import { DraftFrame, SENTENCE, TryFooter, TryHint } from "./cite";
import { DRAFT, DRAFT_TEXT, PAPERS, byline, chicagoCite } from "./papers";
import type { Paper } from "./papers";
import { ReplicaWindow } from "./window";

type Token = string | { key: string; page?: string };

/** `[@key]` or `[@key, p. 2]`, as Markdown writes a citation. */
const CITATION = /\[@([^\]\s,;]+)(?:,\s*p(?:p)?\.\s*([^\]]+?))?\s*\]/g;
/** An open `[@query` at the end of the text: the suggester's trigger. */
const TRIGGER = /\[@([^\]\s,;]*)$/;

/** The papers the draft's first paragraph cites, which the suggester lists first. */
const CITED = new Set(
  DRAFT_TEXT[0]!.flatMap((run) => (typeof run === "string" ? [] : [run.key])),
);

/** Splits text into plain runs and citations. */
function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let at = 0;
  for (const match of text.matchAll(CITATION)) {
    if (match.index > at) out.push(text.slice(at, match.index));
    out.push(
      match[2] ? { key: match[1]!, page: match[2] } : { key: match[1]! },
    );
    at = match.index + match[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

const markdown = (t: Token) =>
  typeof t === "string" ? t : `[@${t.key}${t.page ? `, p. ${t.page}` : ""}]`;

function matches(p: Paper, query: string) {
  const q = query.toLowerCase();
  return (
    p.citekey.toLowerCase().includes(q) ||
    p.title.toLowerCase().includes(q) ||
    p.authors.some((a) => a.toLowerCase().includes(q)) ||
    String(p.year).includes(q)
  );
}

function Citation({ token }: { token: Exclude<Token, string> }) {
  const p = PAPERS.find((x) => x.citekey === token.key);
  if (!p)
    return (
      <span className="text-fd-muted-foreground underline decoration-dotted underline-offset-2">
        {markdown(token)}
      </span>
    );
  return <span className="text-(--zt-cite)">{chicagoCite(p, token.page)}</span>;
}

export default function TryCite() {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const trigger = TRIGGER.exec(text);
  const results = trigger
    ? PAPERS.filter((p) => matches(p, trigger[1]!)).sort(
        (a, b) => Number(CITED.has(b.citekey)) - Number(CITED.has(a.citekey)),
      )
    : [];
  const open = !!trigger && !dismissed && results.length > 0;
  const current = Math.min(active, results.length - 1);
  const pending = [...text.matchAll(CITATION)].at(-1);
  const cited = tokens.some((t) => typeof t !== "string");

  const focusEnd = (at?: number) =>
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      const pos = at ?? el.value.length;
      el.setSelectionRange(pos, pos);
    });

  /** Renders the field's Markdown, as Live Preview does once the cursor leaves it. */
  const commit = () => {
    if (!text) return;
    setTokens((t) => [...t, ...tokenize(text)]);
    setText("");
  };

  const pick = (p: Paper) => {
    if (!trigger) return;
    const next = `${text.slice(0, trigger.index)}[@${p.citekey}]`;
    setText(next);
    setActive(0);
    // The cursor waits inside the brackets, ready for a page.
    focusEnd(next.length - 1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActive((current + step + results.length) % results.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(results[current]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(true);
        return;
      }
    }
    const el = e.currentTarget;
    // The cursor leaves the citation: past its closing bracket, or already beyond it.
    const leaving = (el.selectionStart ?? 0) >= el.value.length - 1;
    if (
      e.key === "Enter" ||
      (e.key === "ArrowRight" && leaving && text.endsWith("]"))
    ) {
      e.preventDefault();
      commit();
      return;
    }
    if (e.key === "Backspace" && text === "" && tokens.length > 0) {
      e.preventDefault();
      const last = tokens.at(-1)!;
      setTokens(tokens.slice(0, -1));
      const raw = markdown(last);
      setText(raw);
      focusEnd(typeof last === "string" ? raw.length : raw.length - 1);
    }
  };

  const reset = () => {
    setTokens([]);
    setText("");
    setDismissed(false);
    setActive(0);
    focusEnd(0);
  };

  const listbox = `${id}-papers`;
  const option = (i: number) => `${id}-paper-${i}`;

  let message;
  if (cited && !text)
    message = (
      <a
        href={localizeHref(INSTALL_HREF)}
        className="inline-flex items-center gap-1.5 font-semibold text-fd-primary underline underline-offset-4"
      >
        {m.docs_home_try_done()}
        <ArrowRight aria-hidden className="size-4" strokeWidth={2.25} />
      </a>
    );
  else if (pending && !pending[2])
    message = (
      <Message
        text={m.docs_home_try_page_hint({ locator: "{locator}" })}
        slots={{
          locator: (
            <kbd className="rounded-sm border border-fd-border bg-fd-muted px-1 font-mono text-[0.9em]">
              , p. 2
            </kbd>
          ),
        }}
      />
    );
  else message = <TryHint />;

  return (
    <>
      {/* The suggester may hang below the window's edge, as a popup does. */}
      <ReplicaWindow
        icon={NotebookPen}
        title={`${DRAFT}.md`}
        className="relative z-10 overflow-visible"
      >
        <DraftFrame
          line={
            <div className="relative">
              <p>
                {SENTENCE}
                {tokens.map((t, i) =>
                  typeof t === "string" ? (
                    // oxlint-disable-next-line react/no-array-index-key -- tokens have no identity but their place
                    <span key={i}>{t}</span>
                  ) : (
                    // oxlint-disable-next-line react/no-array-index-key -- tokens have no identity but their place
                    <Citation key={i} token={t} />
                  ),
                )}
                <input
                  ref={input}
                  type="text"
                  value={text}
                  aria-label={m.docs_home_try_input_label()}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={open}
                  aria-controls={listbox}
                  aria-activedescendant={open ? option(current) : undefined}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  size={Math.max(6, text.length + 2)}
                  onChange={(e) => {
                    setText(e.target.value);
                    setDismissed(false);
                    setActive(0);
                  }}
                  onKeyDown={onKeyDown}
                  onBlur={commit}
                  className="ms-0.5 inline-block max-w-full rounded-sm border-b border-dashed border-fd-muted-foreground/60 bg-transparent px-0.5 text-[15px] text-fd-foreground outline-none focus-visible:border-solid focus-visible:border-fd-ring focus-visible:bg-fd-accent"
                />
              </p>
              <div
                hidden={!open}
                className="absolute inset-x-0 top-full z-10 mt-2 overflow-hidden rounded-lg bg-fd-popover text-fd-popover-foreground shadow-[0_8px_24px_-8px_rgb(0_0_0/0.25)] ring-1 ring-fd-border @lg:end-auto @lg:w-[30rem]"
              >
                <ul
                  id={listbox}
                  role="listbox"
                  aria-label={m.docs_home_try_label()}
                >
                  {results.map((p, i) => (
                    <li
                      key={p.citekey}
                      id={option(i)}
                      role="option"
                      aria-selected={i === current}
                      onMouseDown={(e) => e.preventDefault()}
                      onPointerEnter={() => setActive(i)}
                      onClick={() => pick(p)}
                      className={cn(
                        "cursor-pointer border-b border-fd-border px-3 py-2 last:border-b-0",
                        i === current && "bg-fd-accent",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <p className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
                          {p.title}
                        </p>
                        <span className="shrink-0 rounded-sm bg-fd-muted px-1.5 py-0.5 font-mono text-[11.5px] text-fd-muted-foreground">
                          {p.citekey}
                        </span>
                      </div>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-fd-muted-foreground">
                        <span>
                          {byline(p)}, <span className="italic">{p.venue}</span>
                        </span>
                        {CITED.has(p.citekey) && (
                          <span className="rounded-full border border-fd-border px-1.5 text-[11px]">
                            {m.citation_suggester_cited_in_note()}
                          </span>
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
                <div
                  aria-hidden
                  className="flex flex-wrap gap-x-3 border-t border-fd-border bg-fd-muted px-3 py-1.5 text-[11.5px] text-fd-muted-foreground"
                >
                  <span>
                    <kbd className="font-mono">↑↓</kbd>{" "}
                    {m.instruction_navigate()}
                  </span>
                  <span>
                    <kbd className="font-mono">↵</kbd>{" "}
                    {m.instruction_insert_citation()}
                  </span>
                  <span>
                    <kbd className="font-mono">esc</kbd>{" "}
                    {m.instruction_dismiss()}
                  </span>
                </div>
              </div>
            </div>
          }
        />
      </ReplicaWindow>
      <TryFooter message={message} onReset={reset} />
    </>
  );
}
