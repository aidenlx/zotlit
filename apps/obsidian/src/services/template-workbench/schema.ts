// Where each contract JSON Schema is published, and the contract-root vocabulary it names.

import { CONTRACT_ROOTS } from "@zotlit/db";
import type { ContractRoot } from "@zotlit/db";

import { resourceReleaseUrl } from "@/lib/constants";

/** The accepted `root` values, in the order the contract declares them. */
export const CONTRACT_ROOT_NAMES: readonly ContractRoot[] = CONTRACT_ROOTS;

export function parseContractRoot(
  value: string | undefined,
): ContractRoot | null {
  return value !== undefined &&
    (CONTRACT_ROOTS as readonly string[]).includes(value)
    ? (value as ContractRoot)
    : null;
}

/** Where a single root's schema is published, and what to save it as. */
export interface SchemaAsset {
  url: string;
  /** Carries the version, so a downloaded copy stays attributable to the build
   *  that answered and a later build's download cannot silently reuse it. */
  fileName: string;
}

/**
 * Published schema of every root, as `template-schema` reports them. Release CI
 * uploads one `<root>.schema.json` per contract root to the Resource Release of
 * the version it built, so a build reaches the schema its own contract emitted
 * by naming `manifest.version`.
 */
export function schemaAssets(
  pluginVersion: string,
): Record<ContractRoot, SchemaAsset> {
  return Object.fromEntries(
    CONTRACT_ROOTS.map((root) => [
      root,
      {
        url: `${resourceReleaseUrl(pluginVersion)}/${root}.schema.json`,
        fileName: `zotlit-${root}-${pluginVersion}.schema.json`,
      },
    ]),
  ) as Record<ContractRoot, SchemaAsset>;
}
