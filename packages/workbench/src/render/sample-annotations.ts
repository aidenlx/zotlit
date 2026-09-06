// Built-in annotation examples and the serialized root/descriptor pair a preview renders.

import type { SnapshotRootDescriptors } from "#/snapshot/descriptors";
import type { ItemSnapshot } from "#/snapshot/types";

import { profileSourceRevision } from "./result";

import conferencePaper from "#/samples/conference-paper.json" with { type: "json" };

export interface AnnotationExample {
  readonly id: string;
  readonly revision: string;
  readonly root: Record<string, unknown>;
  readonly descriptors: SnapshotRootDescriptors;
}

const paper = conferencePaper as unknown as ItemSnapshot;
const base = paper.roots.annotations[0]!;
const descriptors = paper.descriptors.annotations[0]!;

const examples = [
  {
    type: "highlight",
    text: "Clear methods make research easier to reproduce.",
    comment: "Use this point in the literature review.",
    tags: ["methods", "to-review"],
    colorHex: "#ffd400",
    colorName: "yellow",
  },
  {
    type: "underline",
    text: "Report the assumptions behind each result.",
    comment: null,
    tags: [],
    colorHex: "#2ea8e5",
    colorName: "blue",
  },
  {
    type: "note",
    text: null,
    comment: "Compare these findings with the replication study.",
    tags: ["follow-up"],
    colorHex: "#a28ae5",
    colorName: "purple",
  },
  {
    type: "text",
    text: null,
    comment: "Check the sample size before citing this estimate.",
    tags: [],
    colorHex: null,
    colorName: null,
  },
  {
    type: "image",
    text: null,
    comment: "Study design and participant flow.",
    tags: ["figure"],
    colorHex: "#5fb236",
    colorName: "green",
  },
  {
    type: "ink",
    text: null,
    comment: null,
    tags: [],
    colorHex: "#ff6666",
    colorName: "red",
  },
] as const;

export const SAMPLE_ANNOTATIONS: readonly AnnotationExample[] = examples.map(
  (example, index) => {
    const key = `EXAMP00${index + 1}`;
    const root = {
      ...base,
      ...example,
      key,
      indexedKey: key,
      commentHtml: example.comment,
      tags: example.tags.map((name) => ({ name, type: "manual" })),
      pageLabel: String(index + 1),
      page: index + 1,
      backlink: `zotero://open/library/items/CNPDF26A?annotation=${key}&page=${index + 1}`,
      imgLink:
        example.type === "image" || example.type === "ink"
          ? {
              $helper: "imgLink",
              signature: "(alias?: string, subpath?: string) => string",
              value: `[[annotation-${example.type}.png]]`,
            }
          : null,
    };
    const matchingDescriptors: SnapshotRootDescriptors = {
      ...descriptors,
      stringCoercions: [
        ...descriptors.stringCoercions.map((entry) =>
          entry.path.length === 0
            ? {
                ...entry,
                value: example.text ?? example.comment ?? example.type,
              }
            : entry,
        ),
        ...example.tags.map((name, tag) => ({
          path: ["tags", tag],
          value: name,
        })),
      ],
    };
    return {
      id: `example:${example.type}`,
      revision: profileSourceRevision(
        JSON.stringify([root, matchingDescriptors]),
      ),
      root,
      descriptors: matchingDescriptors,
    };
  },
);
