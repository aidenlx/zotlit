// An entry's reader-facing description, Markdown rendered with the docs' own prose components.

import { createMarkdownRenderer } from "fumadocs-core/content/md";
import remarkGfm from "remark-gfm";

import { getMDXComponents } from "@/components/mdx";
import { cn } from "@/lib/cn";
import { ztProse } from "@/lib/prose";

const { Markdown } = createMarkdownRenderer({ remarkPlugins: [remarkGfm] });

export function EntryDescription({ markdown }: { markdown: string }) {
  return (
    <div className={cn("prose max-w-[72ch]", ztProse)}>
      <Markdown components={getMDXComponents()}>{markdown}</Markdown>
    </div>
  );
}
