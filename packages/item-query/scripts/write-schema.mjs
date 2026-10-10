import { writeFile } from "node:fs/promises";

import { describeQueryVocabulary } from "@zotlit/item-query/schema";

await writeFile(
  new URL("../dist/query.schema.json", import.meta.url),
  `${JSON.stringify(describeQueryVocabulary(), null, 2)}\n`,
);
