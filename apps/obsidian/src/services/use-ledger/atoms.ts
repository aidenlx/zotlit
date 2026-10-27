// Shared view state for the last Use of each Item.
import { Effect, Stream } from "effect";

import { held } from "@/lib/view-atoms";

import { UseLedger } from "./service";
import type { Ledger } from "./service";

export const useLedgerAtom = held<Ledger>(
  Stream.unwrap(Effect.map(UseLedger, (ledger) => ledger.changes)),
  {},
);
