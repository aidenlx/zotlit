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
import type { Element, ElementContent, Properties, Root } from "hast";
import { Fragment, createElement } from "react";
import type { ReactNode } from "react";
import rehypeCallouts from "rehype-callouts";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import type { RenderedProperty } from "@zotlit/workbench/render";

import { m } from "@/paraglide/messages.js";

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

function embedMark(target: string): Element {
  const extension = target.split("#")[0]!.split(".").pop()!.toLowerCase();
  const kind = EMBED_KIND_BY_EXTENSION.get(extension) ?? "note";
  const mark = inertMark("embed", target);
  mark.properties["data-embed"] = kind;
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
      children[index] = embedMark(String(child.properties.src ?? ""));
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
  image: m.workbench_embed_image_unavailable,
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

/**
 * The result column's body: the generated note as the reader would see it,
 * every target inert, or the generated Markdown byte for byte — which stays the
 * reference whenever the reading view is approximate.
 */
export function ResultSheet({
  markdown,
  properties,
  showMarkdown,
}: {
  markdown: string;
  properties: readonly RenderedProperty[];
  showMarkdown: boolean;
}) {
  if (showMarkdown) {
    return (
      <pre
        dir="ltr"
        role="document"
        aria-label={m.workbench_result_markdown_body()}
        className="font-mono text-[0.8rem] leading-relaxed break-words whitespace-pre-wrap"
      >
        {markdown}
      </pre>
    );
  }
  return (
    <div>
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
        className={SHEET_STYLE}
      >
        {parseNote(markdown).children.map((node, index) =>
          toJsx(node as ElementContent, index),
        )}
      </div>
    </div>
  );
}

/**
 * A property grid — the name beside the value, or beside the reason it has
 * none. The sheet's own frontmatter list and the Properties tab's columns are
 * this one list.
 */
export function PropertyList({
  properties,
  label,
  className = "",
}: {
  properties: readonly RenderedProperty[];
  label?: string;
  className?: string;
}) {
  return (
    <dl
      aria-label={label}
      className={`grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-1 ${className}`}
    >
      {properties.map((property) => (
        <Fragment key={`${property.position}:${property.key}`}>
          <dt className="truncate font-mono text-fd-muted-foreground">
            {property.key}
          </dt>
          <dd className="break-words">
            <PropertyValue property={property} />
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** A produced value, or the reason it has none. */
export function PropertyValue({ property }: { property: RenderedProperty }) {
  if (property.missing || property.value == null) {
    return (
      <span className="text-fd-muted-foreground italic">
        {property.missing
          ? m.workbench_property_unset()
          : m.workbench_property_empty()}
      </span>
    );
  }
  return propertyText(property.value);
}

/** One property value as a single line of text, shared by every property list. */
export function propertyText(value: unknown): string {
  if (Array.isArray(value)) return value.map(propertyText).join(", ");
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}
