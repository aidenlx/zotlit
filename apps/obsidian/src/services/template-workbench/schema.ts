// Bundled contract JSON Schemas, and the contract-root vocabulary they define.

import { type ContractRoot } from "@zotlit/db";
import annotationSchema from "@zotlit/db/contract/annotation.schema.json?raw";
import filenameSchema from "@zotlit/db/contract/filename.schema.json?raw";
import noteSchema from "@zotlit/db/contract/note.schema.json?raw";

/** Committed schema bytes, returned verbatim by `template-schema`. */
export const TEMPLATE_SCHEMAS = {
  note: noteSchema,
  annotation: annotationSchema,
  filename: filenameSchema,
} as const satisfies Record<ContractRoot, string>;

/** The accepted `root` values, in the order selector messages list them. */
export const CONTRACT_ROOT_NAMES = Object.keys(
  TEMPLATE_SCHEMAS,
) as readonly ContractRoot[];

export function parseContractRoot(
  value: string | undefined,
): ContractRoot | null {
  return value !== undefined && Object.hasOwn(TEMPLATE_SCHEMAS, value)
    ? (value as ContractRoot)
    : null;
}
