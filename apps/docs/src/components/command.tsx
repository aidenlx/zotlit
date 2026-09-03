// "Run this Obsidian command" mark for docs prose: a terminal rubric with the
// command-palette name in the serif display voice. The block form adds a
// copy-to-clipboard link; the inline form stays minimal — glyph + name only.
import { asMarkdown, md } from "fumadocs-core/server";
import { Terminal } from "lucide-react";
import { useState } from "react";

import type { LocalizedString } from "@/paraglide/runtime.js";

interface CommandOptions {
  /** Render mid-sentence instead of as a standalone block directive. */
  inline?: boolean;
}

export type CommandProps = CommandOptions &
  (
    | {
        /** ZotLit command name rendered from the product Message catalog. */
        name: LocalizedString;
        children?: never;
      }
    | {
        /** Exact command-palette name owned by another product. */
        children: string;
        name?: never;
      }
  );

export function Command(props: CommandProps) {
  const inline = props.inline ?? false;
  const commandName =
    props.name === undefined ? props.children : `ZotLit: ${props.name}`;

  // The Markdown edition carries the command name as code. The inline form
  // stays mid-sentence; the block form keeps its standalone rubric as a
  // blockquote, where the terminal glyph becomes the word it stands for and
  // the copy affordance drops — a reader of Markdown already has the text.
  if (asMarkdown()) {
    return inline
      ? md`\`${commandName}\``
      : md.linePrefix("> ")`Command: \`${commandName}\``;
  }

  if (inline) {
    return (
      <span className="not-prose inline">
        <Terminal
          aria-hidden
          className="mr-[0.2em] inline size-[1em] shrink-0 align-[-0.14em] text-fd-primary select-none"
        />
        <span className="border-b border-fd-primary/45 pb-[0.02em] font-medium text-fd-foreground">
          {commandName}
        </span>
      </span>
    );
  }
  return <BlockCommand commandName={commandName} />;
}

function BlockCommand({ commandName }: { commandName: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(commandName).then(
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
        {commandName}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Command name copied" : "Copy command name"}
        className={
          "ml-auto shrink-0 cursor-pointer self-center font-mono text-[0.68rem] font-semibold tracking-widest text-fd-primary uppercase transition-opacity" +
          " hover:opacity-80" +
          " focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary"
        }
      >
        {copied ? "Copied ✓" : "Copy →"}
      </button>
    </span>
  );
}
