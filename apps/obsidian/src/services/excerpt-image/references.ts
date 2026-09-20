// Parses the current note's links independently of the asynchronous metadata cache.
import { parser } from "@lezer/markdown";
import { regex } from "arkregex";
import { parseLinktext } from "obsidian";
import type { App, TFile } from "obsidian";

const markdown = parser.configure({
  defineNodes: ["WikiLink"],
  parseInline: [
    {
      name: "WikiLink",
      before: "Link",
      parse(cx, next, pos) {
        const start = next === 33 ? pos + 1 : pos;
        if (cx.char(start) !== 91 || cx.char(start + 1) !== 91) return -1;
        for (let end = start + 2; end < cx.end; end++) {
          if (cx.char(end) === 10) return -1;
          if (cx.char(end) === 92) {
            end++;
            continue;
          }
          if (cx.char(end) === 93 && cx.char(end + 1) === 93) {
            return cx.addElement(cx.elt("WikiLink", pos, end + 2));
          }
        }
        return -1;
      },
    },
  ],
});
const WHITESPACE = /\s+/g;
const ESCAPE = regex("\\\\([!-/:-@\\[-`{-~])", "g");
const labelKey = (text: string) =>
  text.trim().replace(WHITESPACE, " ").toLowerCase();

function markdownTarget(raw: string): string {
  const unwrapped = raw.startsWith("<") ? raw.slice(1, -1) : raw;
  const unescaped = parseLinktext(unwrapped.replace(ESCAPE, "$1")).path;
  try {
    return decodeURIComponent(unescaped);
  } catch {
    return unescaped;
  }
}

export async function referencedExcerptPaths(
  app: App,
  file: TFile,
): Promise<string[]> {
  const content = await app.vault.read(file);
  const definitions = new Map<string, string>();
  const targets: string[] = [];
  const labels: string[] = [];
  markdown.parse(content).iterate({
    enter({ node, name, from, to }) {
      if (name === "WikiLink") {
        const raw = content.slice(from, to);
        const start = raw.startsWith("!") ? 3 : 2;
        targets.push(parseLinktext(raw.slice(start, -2).split("|")[0]!).path);
      } else if (name === "LinkReference") {
        const label = node.getChild("LinkLabel"),
          url = node.getChild("URL");
        if (label && url) {
          const key = labelKey(content.slice(label.from + 1, label.to - 1));
          if (!definitions.has(key))
            definitions.set(
              key,
              markdownTarget(content.slice(url.from, url.to)),
            );
        }
      } else if (name === "Link" || name === "Image") {
        const url = node.getChild("URL");
        if (url) targets.push(markdownTarget(content.slice(url.from, url.to)));
        else {
          const label = node.getChild("LinkLabel");
          const marks = node.getChildren("LinkMark");
          const explicit = label && content.slice(label.from + 1, label.to - 1);
          if (explicit) labels.push(labelKey(explicit));
          else if (marks[0] && marks[1])
            labels.push(labelKey(content.slice(marks[0].to, marks[1].from)));
        }
      }
    },
  });
  for (const label of labels) {
    const target = definitions.get(label);
    if (target) targets.push(target);
  }
  const paths = new Set<string>();
  for (const link of targets) {
    const target = app.metadataCache.getFirstLinkpathDest(link, file.path);
    if (target) paths.add(target.path);
  }
  return [...paths];
}
