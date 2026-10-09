import { writeFile } from "node:fs/promises";

import { describeItemQueryVocabulary } from "@zotlit/item-query/schema";

await writeFile(
  new URL("../dist/item-query.schema.json", import.meta.url),
  `${JSON.stringify(describeItemQueryVocabulary(), null, 2)}\n`,
);
