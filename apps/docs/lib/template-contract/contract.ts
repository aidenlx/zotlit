import type { ContractIR } from "@zotlit/db/contract/ir";
import ir from "@zotlit/db/contract/ir.json" with { type: "json" };

export const CONTRACT_IR = ir as unknown as ContractIR;
