// The fixture contract behind the page-model and GFM tests.

import type { ContractIR } from "@zotlit/db/contract/ir";

import type { SectionSpec } from "./sections.ts";

export const SPECS: readonly SectionSpec[] = [
  {
    id: "root",
    title: "Root",
    level: 2,
    types: ["Root"],
    sample: "zt",
    prefix: "zt.",
  },
  { id: "leaf", title: "Leaf", level: 2, types: ["Leaf"], sample: "leaf" },
  { id: "kinds", title: "Kinds", level: 2, types: ["Kind"] },
  {
    id: "pair",
    title: "Pair",
    level: 2,
    types: ["First", "Second"],
    captions: ["First", "Second"],
  },
  { id: "item-types", title: "Item types", level: 2, itemTypes: true },
];

export const IR: ContractIR = {
  $comment: "test",
  contractVersion: 1,
  roots: {
    note: {
      type: "Root",
      templates: ["note"],
      references: [{ owner: "Leaf", member: "owner", path: "zt" }],
    },
  },
  itemTypes: { book: ["title", "publisher"] },
  types: {
    Root: {
      kind: "object",
      description:
        "The `zt` root: a {@link Leaf} reached through\n{@link Root.leaves}.\n\nSee {@link Missing} for the rest.",
      members: [
        {
          name: "leaves",
          description: "Every leaf, sorted by {@link name}.",
          optional: false,
          type: { kind: "array", items: { kind: "ref", name: "Leaf" } },
        },
        {
          name: "label",
          description: "The label; see {@link Second.year}.",
          optional: true,
          type: {
            kind: "union",
            options: [
              { kind: "primitive", type: "string" },
              { kind: "primitive", type: "null" },
            ],
          },
        },
        {
          name: "name",
          optional: false,
          type: { kind: "primitive", type: "string" },
        },
      ],
    },
    Leaf: {
      kind: "object",
      description: "One leaf.",
      members: [
        {
          name: "owner",
          description: "The item this leaf hangs off.",
          optional: false,
          type: { kind: "ref", name: "Root" },
        },
        {
          name: "kind",
          description: "Leaf kind.",
          optional: false,
          type: {
            kind: "union",
            options: [
              { kind: "literal", value: "a" },
              { kind: "literal", value: "b" },
              { kind: "literal", value: "c" },
              { kind: "literal", value: "d" },
            ],
          },
        },
        {
          name: "link",
          description: "Wiki-link to the leaf.",
          optional: false,
          examples: [{ lang: "liquid", code: "{{ zt.link }}" }],
          type: {
            kind: "union",
            options: [
              {
                kind: "helper",
                name: "link",
                signature: "(alias?: string, subpath?: string) => string",
                filter: "leaf_link",
                value: { kind: "primitive", type: "string" },
              },
              { kind: "primitive", type: "null" },
            ],
          },
        },
      ],
    },
    Kind: {
      kind: "union",
      description: "Kind of a leaf.",
      options: [
        {
          kind: "literal",
          value: "apex",
          description: "The topmost {@link Leaf}.",
        },
        { kind: "literal", value: "stray" },
      ],
    },
    First: {
      kind: "object",
      description: "The first variant.",
      members: [
        {
          name: "year",
          description: "Year.",
          optional: false,
          type: { kind: "primitive", type: "number" },
        },
      ],
    },
    Second: {
      kind: "object",
      members: [
        {
          name: "year",
          description: "Year.",
          optional: false,
          type: { kind: "primitive", type: "number" },
        },
      ],
    },
  },
};
