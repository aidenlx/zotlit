// The Query Dataset selected by from; command registration is shared.
import { ANNOTATIONS, ATTACHMENTS, ITEMS } from "@zotlit/item-query";
import type { AnnotationQueryRequest, QueryDataset } from "@zotlit/item-query";

import type { QueryDatasetId } from "./worker-protocol";

export interface CliDataset {
  readonly engine: QueryDataset<AnnotationQueryRequest>;
}

export const CLI_DATASETS: Readonly<Record<QueryDatasetId, CliDataset>> = {
  items: { engine: ITEMS },
  attachments: { engine: ATTACHMENTS },
  annotations: { engine: ANNOTATIONS },
};
