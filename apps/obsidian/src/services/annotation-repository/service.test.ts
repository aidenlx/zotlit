import { expect, it, vi } from "vitest";

import { createClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import type { DatabaseEvents } from "@/services/database/service";
import { QueryClientService } from "@/services/query-client/service";

import { AnnotationRepository } from "./service";
import type { AnnotationList } from "./service";

// The Fixture's own rows are the oracle: the same item ids, keys, types,
// colours, sort indexes and positions it builds on `rougier-2014.pdf`, which
// carries one Annotation of each of Zotero's six types. The two ink strokes
// keep the first three points of the Fixture's path — the repository moves a
// position through unchanged, so the rest of the stroke proves nothing. The
// EPUB attachment is not in the Fixture: it is seeded here so the content type
// the position is narrowed by is observable.
// @see packages/scripts/lib/fixture/spec.ts — `ANNOTATIONS`
const FIXTURE_ROWS = `
  insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
    values
      (46, 1, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RUGIER24'),
      (47, 2, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RGRPDF24'),
      (48, 4, '2026-08-23 16:17:50', '2026-08-23 16:17:50', 1, 'PUPR5FG5'),
      (49, 4, '2026-08-23 16:18:01', '2026-08-23 16:18:01', 1, 'FDRFQ7C2'),
      (50, 4, '2026-08-23 16:18:11', '2026-08-23 16:18:11', 1, 'K3JRFLFQ'),
      (51, 4, '2026-08-23 16:18:18', '2026-08-23 16:19:07', 1, 'HRK7BG32'),
      (52, 4, '2026-08-23 16:19:19', '2026-08-23 16:19:30', 1, 'C94NJNYG'),
      (55, 4, '2026-08-23 16:20:09', '2026-08-23 16:20:21', 1, 'TYY6Z6ZF'),
      (56, 4, '2026-08-23 16:20:12', '2026-08-23 16:20:18', 1, '4PE492KU'),
      (70, 2, '2025-02-19 12:00:00', '2025-02-19 12:00:00', 1, 'EPUBBKS2'),
      (71, 4, '2025-02-19 12:00:00', '2025-02-19 12:00:00', 1, 'EPUBMRK2');

  insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
    values
      (47, 46, 2, 'application/pdf', 'attachments/rougier-2014.pdf'),
      (70, null, 0, 'application/epub+zip', 'storage:reader.epub');

  insert into itemAnnotations
    (itemID, parentItemID, type, text, comment, color, pageLabel, sortIndex, position, isExternal)
    values
      (48, 47, 1, 'Identify Your Message', null, '#2ea8e5', '1',
        '00000|002041|00170',
        '{"pageIndex":0,"rects":[[265.833,611.202,374.503,620.019]]}', 0),
      (49, 47, 3, null, null, '#ffd400', '2',
        '00001|001860|00047',
        '{"pageIndex":1,"rects":[[48.75,395.509,570,743.723]]}', 0),
      (50, 47, 5,
        'Scientific visualization is classically defined as the process of graphically displaying scientific data.',
        null, '#ff6666', '1', '00000|000434|00180',
        '{"pageIndex":0,"rects":[[67.011,612.638,211.485,620.77],[58.054,601.98,211.489,610.112],[58.054,591.321,153.781,599.454]]}', 0),
      (51, 47, 6, null, 'Making figures is hard :(', '#a28ae5', '1',
        '00000|000191|00088',
        '{"pageIndex":0,"fontSize":14,"rotation":0,"rects":[[398.804,685.107,560.804,702.107]]}', 0),
      (52, 47, 2, null, 'some text comment', '#ffd400', '1',
        '00000|003354|00170',
        '{"pageIndex":0,"rects":[[566.901,598.393,588.901,620.393]]}', 0),
      (55, 47, 4, null, null, '#5fb236', '1', '00000|000040|00100',
        '{"pageIndex":0,"width":2,"paths":[[66.964,674.348,66.629,673.26,66.629,672.214]]}', 0),
      (56, 47, 4, null, null, '#f19837', '1', '00000|000067|00104',
        '{"pageIndex":0,"width":2,"paths":[[203.571,673.009,204.45,672.256,205.266,671.628]]}', 0),
      (71, 70, 1, 'A paragraph in a reflowable book', null, '#ffd400', null,
        '00000|000000|00000',
        '{"type":"FragmentSelector","value":"epubcfi(/6/4!/4/2)"}', 0);
`;

/** Every Annotation of `RGRPDF24`, in the reading order its sort indexes give. */
const READING_ORDER = [
  ["TYY6Z6ZF", "ink"],
  ["4PE492KU", "ink"],
  ["HRK7BG32", "text"],
  ["K3JRFLFQ", "underline"],
  ["PUPR5FG5", "highlight"],
  ["C94NJNYG", "note"],
  ["FDRFQ7C2", "image"],
];

it("reads every type the Fixture carries on one attachment, in Zotero's reading order", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await setup(stack);

  const list = await repository.read("RGRPDF24");

  expect(list?.source).toEqual({ kind: "zotero-db" });
  expect(list?.annotations.map(({ key, type }) => [key, type])).toEqual(
    READING_ORDER,
  );
  expect(list?.annotations.find(({ key }) => key === "HRK7BG32")).toEqual({
    key: "HRK7BG32",
    type: "text",
    color: "#a28ae5",
    comment: "Making figures is hard :(",
    text: null,
    position: {
      kind: "pdf-text",
      pageIndex: 0,
      fontSize: 14,
      rotation: 0,
      rects: [[398.804, 685.107, 560.804, 702.107]],
    },
  });
});

it("narrows each position by the content type of the attachment that holds it", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await setup(stack);

  const pdf = await repository.read("RGRPDF24");
  const epub = await repository.read("EPUBBKS2");

  expect(
    Object.fromEntries(
      (pdf?.annotations ?? []).map(({ key, position }) => [key, position.kind]),
    ),
  ).toEqual({
    TYY6Z6ZF: "pdf-ink",
    "4PE492KU": "pdf-ink",
    HRK7BG32: "pdf-text",
    K3JRFLFQ: "pdf-rects",
    PUPR5FG5: "pdf-rects",
    C94NJNYG: "pdf-rects",
    FDRFQ7C2: "pdf-rects",
  });
  // The Annotation row carries no content type of its own, so a repository that
  // skipped the join back to the attachment would read this as an unknown shape.
  expect(epub?.annotations.map(({ position }) => position)).toEqual([
    { kind: "epub-cfi", value: "epubcfi(/6/4!/4/2)" },
  ]);
});

it("serves one database read to every surface that asks for one attachment at once", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, acquireRead } = await setup(stack);

  const [overlay, view] = await Promise.all([
    repository.read("RGRPDF24"),
    repository.read("RGRPDF24"),
  ]);

  expect(acquireRead).toHaveBeenCalledOnce();
  expect(overlay).toBe(view);
  expect(repository.peek("RGRPDF24")?.value).toBe(overlay);
});

it("drops the whole Zotero database partition on a refresh and names every attachment it held", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, client, dbEvents } = await setup(stack);
  const changed: string[] = [];
  stack.defer(repository.on("annotations-changed", (key) => changed.push(key)));

  await repository.read("RGRPDF24");
  await repository.read("EPUBBKS2");
  client.$client.exec(
    "update itemAnnotations set color = '#5fb236' where itemID = 48;",
  );

  // A stale list stands until the database says it moved.
  const held = repository.peek("RGRPDF24");
  expect(held?.status).toBe("fresh");
  expect(colorOf(held?.value ?? null, "PUPR5FG5")).toBe("#2ea8e5");

  dbEvents.emit("changed");

  expect(changed.toSorted()).toEqual(["EPUBBKS2", "RGRPDF24"]);
  expect(colorOf(await repository.read("RGRPDF24"), "PUPR5FG5")).toBe(
    "#5fb236",
  );
});

it("answers an empty list for a key the database does not hold", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await setup(stack);

  expect(await repository.read("NOSUCH24")).toEqual({
    source: { kind: "zotero-db" },
    annotations: [],
  });
});

it("leaves the Zotero database exactly as it found it", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, client, dbEvents } = await setup(stack);
  const before = annotationRows(client);

  await repository.read("RGRPDF24");
  dbEvents.emit("changed");
  await repository.read("RGRPDF24");
  await repository.read("NOSUCH24");

  expect(annotationRows(client)).toEqual(before);
});

function colorOf(list: AnnotationList | null, key: string): string | null {
  return list?.annotations.find((record) => record.key === key)?.color ?? null;
}

/** Every stored Annotation row, as an oracle for "nothing was written". */
function annotationRows(client: NodeDatabaseClient): unknown[] {
  return client.$client
    .prepare("select * from itemAnnotations order by itemID")
    .all();
}

async function setup(stack: AsyncDisposableStack) {
  const client = createClient(":memory:");
  stack.defer(() => client.$client.close());
  createFixtureSchema(client.$client);
  client.$client.exec(FIXTURE_ROWS);

  const dbEvents = createNanoEvents<DatabaseEvents>();
  const acquireRead = vi.fn(() =>
    Promise.resolve({ client, [Symbol.dispose]: () => undefined }),
  );
  const db = {
    acquireRead,
    on: <K extends keyof DatabaseEvents>(event: K, cb: DatabaseEvents[K]) =>
      dbEvents.on(event, cb),
  };

  const queryClient = new QueryClientService();
  stack.use(queryClient);
  const repository = new AnnotationRepository({ db, queryClient });
  stack.use(repository);
  await repository.ready;
  return { repository, client, db, dbEvents, acquireRead, queryClient };
}
