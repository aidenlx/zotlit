// The Template-slot → contract-root registry shared by the contract generator and the Template Workbench CLI.

/**
 * Stamped in every generated schema's `$id` and in the Workbench's JSON
 * envelopes. Bump when the `zt` contract or the diagnostic codes change.
 */
export const CONTRACT_VERSION = 1;

/** Every emitted `zt` data root, in the order the contract documents them. */
export const CONTRACT_ROOTS = ["note", "annotation", "filename"] as const;

/** A `zt` data root a Template renders against. */
export type ContractRoot = (typeof CONTRACT_ROOTS)[number];

/**
 * The contract root each Template name's `zt` resolves to. `cite` / `cite2` are
 * absent: citation-scoped data needs synthesized Citation Items and Locators,
 * which is a follow-up.
 */
export const TEMPLATE_SLOT_ROOTS = {
  note: "note",
  content: "note",
  annotation: "annotation",
  filename: "filename",
} as const satisfies Record<string, ContractRoot>;

/** A Template name the Workbench can inspect and render. */
export type TemplateSlot = keyof typeof TEMPLATE_SLOT_ROOTS;

/** Template names rendering against `root`, in registry order. */
export function templateSlotsForRoot(root: ContractRoot): TemplateSlot[] {
  return Object.entries(TEMPLATE_SLOT_ROOTS)
    .filter(([, slotRoot]) => slotRoot === root)
    .map(([slot]) => slot as TemplateSlot);
}
