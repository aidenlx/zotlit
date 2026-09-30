// An entry's reader-facing description, Markdown rendered with the docs' own prose components.

import { createMarkdownRenderer } from "fumadocs-core/content/md";
import remarkGfm from "remark-gfm";

import { getMDXComponents } from "@/components/mdx";
import { cn } from "@/lib/cn";
import { ztProse } from "@/lib/prose";

const { Markdown } = createMarkdownRenderer({ remarkPlugins: [remarkGfm] });

export function EntryDescription({ markdown }: { markdown: string }) {
  return (
    <div
      className={cn(
        "prose max-w-[72ch]",
        ztProse,
        // On a phone, a table's cells pad less, and a link or a property name
        // breaks where it must, so the table fits the screen's width.
        "max-sm:prose-th:px-1.5 max-sm:prose-td:px-1.5",
        "[&_td_a]:[overflow-wrap:anywhere] [&_td_code]:[overflow-wrap:anywhere]",
      )}
    >
      <Markdown components={getMDXComponents()}>{markdown}</Markdown>
    </div>
  );
}
