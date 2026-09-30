// An entry's reader-facing description, Markdown rendered with the docs' own prose components.

import { createMarkdownRenderer } from "fumadocs-core/content/md";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import type { ComponentProps } from "react";
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
        "max-sm:[&_td_a]:[overflow-wrap:anywhere] max-sm:[&_td_code]:[overflow-wrap:anywhere]",
      )}
    >
      <Markdown components={getMDXComponents({ pre: DescriptionCode })}>
        {markdown}
      </Markdown>
    </div>
  );
}

/** A code block of the description, padded as the page's own call blocks are. */
function DescriptionCode(props: ComponentProps<"pre">) {
  return (
    <CodeBlock {...props}>
      <Pre className="px-4">{props.children}</Pre>
    </CodeBlock>
  );
}
