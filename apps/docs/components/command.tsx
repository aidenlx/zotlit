"use client";

// "Run this Obsidian command" mark for docs prose: a terminal rubric with the
// command-palette name in the serif display voice. The block form adds a
// copy-to-clipboard link; the inline form stays minimal — glyph + name only.
import { Terminal } from "lucide-react";
import { useState } from "react";

export interface CommandProps {
  /** Exact command-palette string, e.g. `ZotLit: Open template data explorer`. */
  children: string;
  /** Render mid-sentence instead of as a standalone block directive. */
  inline?: boolean;
}

export function Command({ children, inline = false }: CommandProps) {
  if (inline) {
    return (
      <span className="not-prose inline">
        <Terminal
          aria-hidden
          className="mr-[0.2em] inline size-[1em] shrink-0 align-[-0.14em] text-fd-primary select-none"
        />
        <span className="border-b border-fd-primary/45 pb-[0.02em] font-medium text-fd-foreground">
          {children}
        </span>
      </span>
    );
  }
  return <BlockCommand>{children}</BlockCommand>;
}

function BlockCommand({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(children).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  }

  return (
    <span className="not-prose my-4 flex items-center gap-2 border-b border-fd-border pt-1 pb-2">
      <Terminal
        aria-hidden
        className="size-[1.15rem] shrink-0 text-fd-primary select-none"
      />
      <span className="font-serif text-[1.22rem] leading-tight font-medium text-fd-foreground">
        {children}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Command name copied" : "Copy command name"}
        className={
          "ml-auto shrink-0 cursor-pointer self-center text-[0.76rem] font-medium tracking-[0.09em] text-fd-primary transition-opacity" +
          " [font-variant-caps:all-small-caps] hover:opacity-80" +
          " focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary"
        }
      >
        {copied ? "Copied ✓" : "Copy →"}
      </button>
    </span>
  );
}
