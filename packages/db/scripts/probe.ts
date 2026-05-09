import { createClient } from "@zotlit/db";
import { loadEnvFile } from "node:process";

loadEnvFile();

if (!process.env.ZOTERO_DB_URL) {
  throw new Error("ZOTERO_DB_URL is not set");
}

const client = createClient(process.env.ZOTERO_DB_URL);

const q = client.query.items
  .findMany({
    with: { itemData: { with: { itemDataValue: true, fieldsCombined: true } } },
  })
  .prepare();

for (const item of q.all()) {
  console.log({
    ...item,
    dateAdded: item.dateAdded.toString(),
    dateModified: item.dateModified.toString(),
    clientDateModified: item.clientDateModified.toString(),
    itemData: item.itemData.map((itemData) => ({
      vaule: itemData.itemDataValue?.value,
      ...itemData.fieldsCombined,
    })),
  });
}
