import { seedWorksSql, worksSql } from "@/services/zotero-reads/test-utils";

export const annotationRows = `${seedWorksSql([
  { itemID: 1, key: "ABCD2345", citationKey: "doe2024" },
  { itemID: 2, key: "NCKEY234", title: "Study without a citation key" },
])}
insert into libraries (libraryID, type) values (4, 'group');
insert into groups (groupID, libraryID, name) values (7, 4, 'Shared group');
${worksSql([{ itemID: 3, libraryID: 4, key: "ZZZ99999", citationKey: "roe2025" }])}
insert into itemTypes (itemTypeID, typeName) values (100, 'annotation');
insert into items (itemID, itemTypeID, libraryID, key) values
  (10, 99, 1, 'PDF23456'), (11, 100, 1, 'ANN23456'),
  (20, 99, 1, 'PDFNCKEY'), (21, 100, 1, 'ANNNCKEY'),
  (30, 99, 4, 'PDF23456'), (31, 100, 4, 'ANN23456');
insert into itemAttachments (itemID, parentItemID, linkMode) values
  (10, 1, 0), (20, 2, 0), (30, 3, 0);
insert into itemAnnotations (itemID, parentItemID, type) values
  (11, 10, 1), (21, 20, 1), (31, 30, 1);
`;

export const annotationUri =
  "zotero://open/library/items/PDF23456?page=42&annotation=ANN23456";
