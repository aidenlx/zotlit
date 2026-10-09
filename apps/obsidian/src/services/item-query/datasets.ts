// The Query Dataset selected by from; command registration is shared.
import { ANNOTATIONS, ITEMS } from "@zotlit/item-query";
import type { ItemQueryRequest, QueryDataset } from "@zotlit/item-query";

import type { QueryDatasetId } from "./worker-protocol";

export interface CliDataset {
  readonly engine: QueryDataset<ItemQueryRequest>;
}

export const CLI_DATASETS: Readonly<Record<QueryDatasetId, CliDataset>> = {
  items: { engine: ITEMS },
  annotations: { engine: ANNOTATIONS },
};
