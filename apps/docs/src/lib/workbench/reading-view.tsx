// The result column as a paper sheet: one unified pipeline from generated
// Markdown to an inert hast tree, and the one hast-to-JSX map that renders it.
// Every parser node type this app reads is read here and nowhere else, so
// swapping a package stays inside this file.

import { blockReferences, checkbox } from "@quartz-community/rehype-obsidian";
import remarkObsidian from "@quartz-community/remark-obsidian";
import type {
  Highlight,
  Tag,
  Wikilink,
} from "@quartz-community/remark-obsidian";
import type {
  Element,
  ElementContent,
  Properties,
  Root,
  RootContent,
} from "hast";
import { Fragment, createElement } from "react";
import type { ReactNode } from "react";
import rehypeCallouts from "rehype-callouts";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import type { RenderedProperty, RenderedRange } from "@zotlit/workbench/render";

import { m } from "@/paraglide/messages.js";

import imagePlaceholder from "./image-placeholder.svg";
import { PropertyList } from "./property-list";

/** What an `![[…]]` or `![](…)` embed points at, by the target's file type. */
type EmbedKind = "audio" | "image" | "note" | "pdf" | "video";

/** The inert marks this map renders in place of anything that would navigate. */
type InertKind = "embed" | "link" | "tag" | "wikilink";

const EMBED_KIND_BY_EXTENSION = new Map<string, EmbedKind>([
  ...asKind("image", "avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"),
  ...asKind("audio", "3gp", "flac", "m4a", "mp3", "oga", "ogg", "wav"),
  ...asKind("video", "mkv", "mov", "mp4", "ogv", "webm"),
  ...asKind("pdf", "pdf"),
]);

function asKind(
  kind: EmbedKind,
  ...extensions: string[]
): [string, EmbedKind][] {
  return extensions.map((extension) => [extension, kind]);
}

/**
 * The reading-view pipeline. `remarkObsidian` drops comment nodes outright, so
 * `%%…%%` disappears from the sheet the way Obsidian's reading view hides it.
 */
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkObsidian, {
    comments: true,
    customTaskChars: true,
    highlights: true,
    // Math rendering is out of scope for the web Workbench.
    math: false,
    tags: true,
    wikilinks: true,
  })
  .use(remarkRehype, {
    handlers: {
      highlight: (state, node) =>
        element("mark", {}, state.all(node as Highlight)),
      tag: (_state, node) => {
        const { value } = node as Tag;
        return inertMark("tag", value, `#${value}`);
      },
      wikilink: (_state, node) => wikilinkMark(node as Wikilink),
    },
  })
  .use(() => (tree: Root, file) => {
    blockReferences(tree, file);
    checkbox(tree);
  })
  .use(rehypeCallouts, { showIndicator: false })
  .use(() => inertTargets)
  .freeze();

/** Generated Markdown as an inert hast tree. */
export function parseNote(markdown: string): Root {
  return processor.runSync(processor.parse(markdown), markdown);
}

function element(
  tagName: string,
  properties: Properties,
  children: ElementContent[] = [],
): Element {
  return { type: "element", tagName, properties, children };
}

function inertMark(kind: InertKind, target: string, text = ""): Element {
  return element(
    "span",
    { className: [`zt-${kind}`], "data-zt": kind, "data-target": target },
    text ? [{ type: "text", value: text }] : [],
  );
}

function wikilinkMark({ alias, embedded, heading, path }: Wikilink): Element {
  const target = heading ? `${path}#${heading}` : path;
  return embedded
    ? embedMark(target)
    : inertMark("wikilink", target, alias || target);
}

function embedMark(target: string, kind?: EmbedKind): Element {
  const extension = target.split("#")[0]!.split(".").pop()!.toLowerCase();
  const mark = inertMark("embed", target);
  mark.properties["data-embed"] =
    kind ?? EMBED_KIND_BY_EXTENSION.get(extension) ?? "note";
  return mark;
}

/**
 * Strips every navigable target the pipeline produced. Snapshots carry no file
 * contents and no vault, so an anchor becomes an inert mark and an image
 * becomes the placeholder its file type deserves.
 */
function inertTargets(parent: Element | Root): void {
  const children = parent.children as ElementContent[];
  for (const [index, child] of children.entries()) {
    if (child.type !== "element") continue;
    if (child.tagName === "img") {
      children[index] = embedMark(String(child.properties.src ?? ""), "image");
      continue;
    }
    inertTargets(child);
    if (child.tagName === "a") {
      children[index] = {
        ...inertMark("link", String(child.properties.href ?? "")),
        children: child.children,
      };
    }
  }
}

/**
 * The elements this map paints. Template output is untrusted, so anything
 * absent renders as its children alone.
 */
const RENDERED_TAGS = new Set([
  "blockquote",
  "br",
  "code",
  "del",
  "details",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "input",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "section",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]);

/** Attributes carried through to the DOM, beside `class` and every `data-`. */
const KEPT_ATTRIBUTES = new Set([
  "align",
  "checked",
  "colSpan",
  "open",
  "rowSpan",
  "start",
  "type",
]);

function toJsx(node: ElementContent, key: number): ReactNode {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return null;

  const children = node.children.map(toJsx);
  if (node.properties["data-zt"] === "embed") {
    return (
      <EmbedPlaceholder
        key={key}
        kind={embedKind(node.properties["data-embed"])}
        target={String(node.properties["data-target"])}
      />
    );
  }
  if (!RENDERED_TAGS.has(node.tagName)) {
    return <Fragment key={key}>{children}</Fragment>;
  }
  return createElement(
    node.tagName,
    toProps(node, key),
    children.length > 0 ? children : undefined,
  );
}

function toProps(
  { properties, tagName }: Element,
  key: number,
): Record<string, unknown> {
  const props: Record<string, unknown> = { key };
  for (const [name, value] of Object.entries(properties)) {
    if (name === "className") {
      props.className = Array.isArray(value) ? value.join(" ") : String(value);
    } else if (name.startsWith("data-") || KEPT_ATTRIBUTES.has(name)) {
      props[name] = value;
    }
  }
  // The sheet shows a note that lives elsewhere, so its task boxes report
  // rather than accept input.
  if (tagName === "input") props.disabled = true;
  return props;
}

const EMBED_LABEL = {
  audio: m.workbench_embed_file_unavailable,
  image: m.workbench_image_placeholder,
  note: m.workbench_embed_note_unavailable,
  pdf: m.workbench_embed_file_unavailable,
  video: m.workbench_embed_file_unavailable,
} satisfies Record<EmbedKind, () => string>;

/** `data-embed` back as the union `embedMark` wrote, so the label stays checked. */
function embedKind(value: unknown): EmbedKind {
  const kind = String(value);
  return kind in EMBED_LABEL ? (kind as EmbedKind) : "note";
}

function EmbedPlaceholder({
  kind,
  target,
}: {
  kind: EmbedKind;
  target: string;
}) {
  const label = EMBED_LABEL[kind]();
  return (
    <span
      data-zt="embed"
      data-embed={kind}
      className="my-1 flex flex-col gap-0.5 border border-dashed border-fd-border px-2 py-1.5"
    >
      {kind === "image" && (
        <img
          src={imagePlaceholder}
          alt={m.workbench_image_placeholder()}
          width={640}
          height={360}
          loading="lazy"
          className="my-1 h-auto w-full max-w-sm rounded-sm"
        />
      )}
      <span className="font-mono text-[0.62rem] font-semibold tracking-widest text-fd-muted-foreground uppercase">
        {label}
      </span>
      <span className="truncate font-mono text-[0.7rem]">{target}</span>
    </span>
  );
}

const SHEET_STYLE = [
  "prose prose-sm max-w-none font-sans",
  "prose-h1:font-serif prose-h1:font-medium prose-h2:font-serif prose-h2:font-medium prose-h3:font-serif prose-h3:font-medium",
  "prose-code:rounded-none prose-pre:rounded-none",
  "[&_.zt-link]:underline [&_.zt-link]:decoration-dotted [&_.zt-link]:underline-offset-2",
  "[&_.zt-tag]:text-fd-primary [&_.zt-wikilink]:text-fd-primary [&_.zt-wikilink]:underline [&_.zt-wikilink]:decoration-dotted [&_.zt-wikilink]:underline-offset-2",
  "[&_.callout]:my-3 [&_.callout]:border-0 [&_.callout]:border-l-2 [&_.callout]:border-fd-primary [&_.callout]:bg-fd-accent/40 [&_.callout]:px-3 [&_.callout]:py-2 [&_.callout]:not-italic",
  "[&_.callout-title]:font-mono [&_.callout-title]:text-[0.68rem] [&_.callout-title]:font-semibold [&_.callout-title]:tracking-widest [&_.callout-title]:text-fd-primary [&_.callout-title]:uppercase",
  "[&_summary.callout-title]:cursor-pointer",
  "[&_.callout-content]:mt-1 [&_.callout-content>*]:my-1",
].join(" ");

/** Text and standalone visual elements count as visible note content. */
function hasVisibleContent(node: RootContent | Root): boolean {
  if (node.type === "text") return node.value.trim().length > 0;
  if (node.type !== "element" && node.type !== "root") return false;
  if (
    node.type === "element" &&
    (node.properties["data-zt"] === "embed" ||
      ["hr", "br", "input", "img"].includes(node.tagName))
  ) {
    return true;
  }
  return node.children.some(hasVisibleContent);
}

function EmptyNote() {
  return (
    <p className="grid min-h-24 flex-1 place-items-center px-3 py-6 text-center text-sm text-fd-muted-foreground">
      {m.workbench_result_empty()}
    </p>
  );
}

/**
 * The result column's body: the generated note as the reader would see it,
 * every target inert, or the generated Markdown byte for byte — which stays the
 * reference whenever the reading view is approximate.
 */
export function ResultSheet({
  markdown,
  properties,
  showMarkdown,
  marks = [],
}: {
  markdown: string;
  properties: readonly RenderedProperty[];
  showMarkdown: boolean;
  /** Where each annotation the format produced landed in `markdown`. */
  marks?: readonly RenderedRange[];
}) {
  if (showMarkdown) {
    if (!markdown.trim()) return <EmptyNote />;
    return (
      <pre
        dir="ltr"
        role="document"
        aria-label={m.workbench_result_markdown_body()}
        className="font-mono text-[0.8rem] leading-relaxed break-words whitespace-pre-wrap"
      >
        {markedText(markdown, marks)}
      </pre>
    );
  }
  const tree = parseNote(markdown);
  const hasContent = hasVisibleContent(tree);
  return (
    <div className="flex flex-1 flex-col">
      {properties.length > 0 && (
        <PropertyList
          properties={properties}
          label={m.workbench_result_properties()}
          className="mb-4 border-b border-fd-border pb-3 text-xs"
        />
      )}
      <div
        role="document"
        aria-label={m.workbench_result_body()}
        className={hasContent ? SHEET_STYLE : "flex flex-1 flex-col"}
      >
        {hasContent ? markedBlocks(tree, marks) : <EmptyNote />}
      </div>
    </div>
  );
}

/**
 * One annotation's output in the sheet. The tint and ring answer the host's
 * `data-emphasis` on the region around the sheet, so the many outputs light
 * up together while the reader is at the one format that made them.
 */
const OUTPUT_STYLE =
  "-mx-2 rounded-sm px-2 transition-[background-color,box-shadow] duration-150 ease-[cubic-bezier(0.2,0,0,1)] group-data-emphasis:bg-fd-primary/8 group-data-emphasis:shadow-[0_0_0_2px_var(--color-fd-primary)]";

/** Whether a parsed node's source lies inside a rendered annotation. */
function within(node: ElementContent, { from, to }: RenderedRange): boolean {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start !== undefined && end !== undefined && start < to && end > from;
}

/**
 * The sheet's blocks, with each annotation's run of them gathered into one
 * marked block. The parser writes a bare line break between blocks and gives
 * it no source position, so one inside a run stays with the run.
 */
function markedBlocks(
  tree: Root,
  marks: readonly RenderedRange[],
): ReactNode[] {
  const nodes = tree.children as ElementContent[];
  const blocks: ReactNode[] = [];
  for (let index = 0; index < nodes.length; ) {
    const node = nodes[index]!;
    const mark = marks.find((range) => within(node, range));
    if (!mark) {
      blocks.push(toJsx(node, index));
      index += 1;
      continue;
    }
    const run: ReactNode[] = [];
    while (index < nodes.length) {
      const next = nodes[index]!;
      const between =
        next.type === "text" &&
        next.position === undefined &&
        nodes[index + 1] !== undefined &&
        within(nodes[index + 1]!, mark);
      if (!within(next, mark) && !between) break;
      run.push(toJsx(next, index));
      index += 1;
    }
    blocks.push(
      <div
        key={`mark-${index}`}
        data-zt="annotation-output"
        className={OUTPUT_STYLE}
      >
        {run}
      </div>,
    );
  }
  return blocks;
}

/** The generated Markdown byte for byte, each annotation's bytes in a marked span. */
function markedText(
  markdown: string,
  marks: readonly RenderedRange[],
): ReactNode[] {
  const pieces: ReactNode[] = [];
  let cursor = 0;
  for (const { from, to } of marks) {
    if (from < cursor) continue;
    pieces.push(markdown.slice(cursor, from));
    pieces.push(
      <span key={from} data-zt="annotation-output" className={OUTPUT_STYLE}>
        {markdown.slice(from, to)}
      </span>,
    );
    cursor = to;
  }
  pieces.push(markdown.slice(cursor));
  return pieces;
}
