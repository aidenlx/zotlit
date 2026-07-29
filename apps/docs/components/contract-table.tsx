import Link from "fumadocs-core/link";
import { type ReactNode } from "react";

import irJson from "@/lib/template-contract/generated/ir.json";
import { type ContractIR } from "@/lib/template-contract/ir.ts";
import {
  buildPageModel,
  type Doc,
  type ItemTypeRow,
  type RowModel,
  type TableModel,
} from "@/lib/template-contract/page-model.ts";

import { TypeTable, type DetailNode, type TypeNode } from "./type-table";

const model = buildPageModel(irJson as unknown as ContractIR);

/**
 * The type tables of one generated section. Reads the committed contract IR
 * through the shared page model, so the tables and the emitted prose around them
 * restate the same contract.
 */
export function ContractTable({ section }: { section: string }) {
  const page = model.sections.find((entry) => entry.id === section);
  if (!page) throw new Error(`No contract section ${section}`);
  if (page.itemTypes.length > 0) {
    return <TypeTable anchor={page.id} type={itemTypeNodes(page.itemTypes)} />;
  }
  return (
    <>
      {page.tables.map((table) => (
        <div key={table.id}>
          {table.caption && <p className="font-medium">{table.caption}</p>}
          {renderDoc(table.description)}
          <TypeTable
            anchor={table.id}
            prefix={table.prefix}
            type={typeNodes(table)}
          />
        </div>
      ))}
    </>
  );
}

function typeNodes(table: TableModel): Record<string, TypeNode> {
  return Object.fromEntries(
    table.rows.map((row) => [row.name, typeNode(row)] as const),
  );
}

function typeNode(row: RowModel): TypeNode {
  return {
    type: <code>{row.shortType}</code>,
    typeDescription: <code>{row.fullType}</code>,
    typeDescriptionLink: row.typeHref,
    required: !row.optional,
    description: renderDoc(row.description),
    details: details(row),
  };
}

function details(row: RowModel): DetailNode[] {
  const nodes: DetailNode[] = [];
  if (row.helper) {
    nodes.push(
      { label: "Signature", content: <code>{row.helper.signature}</code> },
      { label: "Liquid", content: <code>{row.helper.liquid}</code> },
      { label: "Eta", content: <code>{row.helper.eta}</code> },
    );
    if (row.helper.filter) {
      nodes.push({
        label: "Liquid filter",
        content: <code>{row.helper.filter}</code>,
      });
    }
  }
  if (row.examples.length > 0) {
    nodes.push({
      label: row.examples.length > 1 ? "Examples" : "Example",
      content: (
        <div className="flex flex-col gap-2">
          {row.examples.map((example) => (
            <pre
              key={example.code}
              className="fd-scroll-container overflow-auto rounded-lg border bg-fd-secondary p-2 text-xs"
            >
              <code>{example.code}</code>
            </pre>
          ))}
        </div>
      ),
    });
  }
  return nodes;
}

function itemTypeNodes(rows: readonly ItemTypeRow[]): Record<string, TypeNode> {
  return Object.fromEntries(
    rows.map(({ itemType, fields }) => [
      itemType,
      {
        type: `${fields.length} fields`,
        required: true,
        description: (
          <p className="flex flex-wrap gap-x-2 gap-y-1">
            {fields.map((field) => (
              <code key={field}>{field}</code>
            ))}
          </p>
        ),
      } satisfies TypeNode,
    ]),
  );
}

function renderDoc(doc: Doc): ReactNode {
  return doc.map((paragraph, index) => (
    // oxlint-disable-next-line no-array-index-key -- paragraphs have no stable id
    <p key={index}>
      {paragraph.map((node, nodeIndex) => {
        switch (node.kind) {
          case "text":
            // oxlint-disable-next-line no-array-index-key -- runs have no stable id
            return <span key={nodeIndex}>{node.value}</span>;
          case "code":
            // oxlint-disable-next-line no-array-index-key -- runs have no stable id
            return <code key={nodeIndex}>{node.value}</code>;
          case "link":
            return (
              // oxlint-disable-next-line no-array-index-key -- runs have no stable id
              <Link key={nodeIndex} href={node.href}>
                {node.code ? <code>{node.text}</code> : node.text}
              </Link>
            );
        }
      })}
    </p>
  ));
}
