// The Annotation Repository at library scale: one batch read for many
// Attachments, and a published list kept only while a surface holds it.

import { Duration } from "effect";
import { TestClock } from "effect/testing";
import { expect, it, vi } from "vitest";

import { yieldToMain } from "@/lib/yield-to-main";
import {
  annotationPage,
  rootOk,
  ROUGIER_ANNOTATIONS,
} from "@/services/zotero-local-api/__fixtures__";

import {
  nextChange,
  REMEMBERED_KEY,
  setup,
  switchToLocalApi,
  batchReads,
  clearReads,
} from "./__fixtures__";
import type { RepositoryClient } from "./__fixtures__";
import { UNHELD_RETENTION } from "./service";

it("reads the Annotations of several Attachments in one batch read", async () => {
  await using stack = new AsyncDisposableStack();
  const reads = await setup(stack);
  const { repository } = reads;
  clearReads(reads);

  // A view reads each Attachment it shows in the same task.
  const [pdf, epub] = await Promise.all([
    repository.read("RGRPDF24"),
    repository.read("EPUBBKS2"),
  ]);

  expect(batchReads(reads)).toBe(1);
  expect(pdf?.annotations).toHaveLength(7);
  expect(epub?.annotations.map(({ key }) => key)).toEqual(["EPUBMRK2"]);
});

it("drops a list no surface holds, and reads it fresh for the next surface that holds it", async () => {
  await using stack = new AsyncDisposableStack();
  const reads = await setup(stack);
  const { repository } = reads;

  const view = repository.hold(["RGRPDF24"]);
  await repository.read("RGRPDF24");
  view[Symbol.dispose]();
  expect(repository.peek("RGRPDF24")).toBeNull();

  clearReads(reads);
  using _again = repository.hold(["RGRPDF24"]);
  const list = await repository.read("RGRPDF24");
  expect(batchReads(reads)).toBe(1);
  expect(list?.annotations).toHaveLength(7);
});

it("tells a reader with no hold that the list it showed was let go, so it reads it again", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await setup(stack);
  const reader = repository.hold(["RGRPDF24"]);
  await repository.read("RGRPDF24");

  // The sidebar reads the same Attachment the closing reader held, with no
  // hold of its own: the drop is announced, and its read publishes again.
  const announced = nextChange(repository);
  reader[Symbol.dispose]();
  expect(await announced).toEqual(["RGRPDF24"]);
  await repository.read("RGRPDF24");
  expect(repository.peek("RGRPDF24")?.value.annotations).toHaveLength(7);
});

it("tells the readers of a first read still running when its last hold ends", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await setup(stack);
  const reader = repository.hold(["RGRPDF24"]);
  const first = repository.read("RGRPDF24");

  const announced = nextChange(repository);
  reader[Symbol.dispose]();
  expect(await announced).toEqual(["RGRPDF24"]);
  await first;
  const again = await repository.read("RGRPDF24");
  expect(again?.annotations).toHaveLength(7);
});

/** Zotero's key alphabet, which an Indexed Key is spelled in. */
const ALPHABET = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";

/**
 * Seed `count` more PDF Attachments on the Fixture's Item, each with one
 * highlight, as a library holds them.
 *
 * @returns the Attachments' Indexed Keys.
 */
function seedAttachments(
  client: Awaited<ReturnType<typeof setup>>["client"],
  count: number,
): string[] {
  const keys: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const suffix = `${ALPHABET[Math.floor(i / ALPHABET.length)]}${ALPHABET[i % ALPHABET.length]}`;
    const attachment = { itemID: 1000 + i, key: `MANYAT${suffix}` };
    const annotation = { itemID: 2000 + i, key: `MANYAN${suffix}` };
    client.$client.exec(
      `insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
         values
           (${attachment.itemID}, 2, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, '${attachment.key}'),
           (${annotation.itemID}, 4, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, '${annotation.key}');
       insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
         values (${attachment.itemID}, 46, 2, 'application/pdf', 'attachments/many-${i}.pdf');
       insert into itemAnnotations
         (itemID, parentItemID, type, text, comment, color, pageLabel, sortIndex, position, isExternal)
         values (${annotation.itemID}, ${attachment.itemID}, 1, 'Highlight ${i}', null, '#ffd400', '1',
           '00000|000001|00001', '{"pageIndex":0,"rects":[[1,1,2,2]]}', 0);`,
    );
    keys.push(attachment.key);
  }
  return keys;
}

/** Lets every read a database change started run to its end. */
async function settled(): Promise<void> {
  for (let task = 0; task < 5; task += 1) await yieldToMain();
}

/** The Attachments of `keys` whose list the repository still publishes. */
function published(repository: RepositoryClient, keys: readonly string[]) {
  return keys.filter((key) => repository.peek(key) !== null);
}

it("lets the lists go as views over many Attachments close", async () => {
  await using stack = new AsyncDisposableStack();
  const reads = await setup(stack);
  const { repository, client, acquireRead, dbEvents } = reads;
  const keys = seedAttachments(client, 40);

  // Two views over overlapping sets of Attachments: one batch read each.
  const first = repository.hold(keys.slice(0, 25));
  const second = repository.hold(keys.slice(15));
  clearReads(reads);
  const lists = await Promise.all(keys.map((key) => repository.read(key)));
  expect(batchReads(reads)).toBe(1);
  expect(lists[39]?.annotations).toHaveLength(1);
  expect(published(repository, keys)).toHaveLength(40);

  // The lists both views showed stay while the second view is open.
  first[Symbol.dispose]();
  expect(published(repository, keys)).toEqual(keys.slice(15));
  second[Symbol.dispose]();
  expect(published(repository, keys)).toEqual([]);

  // A database change reads none of them again.
  acquireRead.mockClear();
  dbEvents.emit("changed");
  await settled();
  expect(acquireRead).not.toHaveBeenCalled();
});

it("reads again on a database change only the lists that surfaces hold", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, client, acquireRead, dbEvents } = await setup(stack);
  const [shown, closed] = seedAttachments(client, 2) as [string, string];
  using _view = repository.hold([shown]);
  const closing = repository.hold([closed]);
  await Promise.all([shown, closed].map((key) => repository.read(key)));
  closing[Symbol.dispose]();

  acquireRead.mockClear();
  const announced = nextChange(repository);
  dbEvents.emit("changed");
  expect(await announced).toEqual([shown]);
  await vi.waitFor(() => expect(acquireRead).toHaveBeenCalledTimes(1));
  expect(published(repository, [shown, closed])).toEqual([shown]);
});

it("lets go at a database change a list read with no hold and not asked for a while", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository, acquireRead, dbEvents, runtime } = await setup(stack);
  const retention = UNHELD_RETENTION;
  const tick = Duration.millis(1);

  await repository.read("RGRPDF24");
  // A reader that asks without a hold keeps its list while no change comes,
  // so a card it shows still finds its record however long it stood idle.
  await runtime.runPromise(
    TestClock.adjust(Duration.sum(retention, retention)),
  );
  expect(repository.peek("RGRPDF24")).not.toBeNull();

  // Asked again within the retention, a change reads it again; that read is
  // the repository's own and no ask.
  await repository.read("RGRPDF24");
  await runtime.runPromise(
    TestClock.adjust(Duration.subtract(retention, tick)),
  );
  acquireRead.mockClear();
  dbEvents.emit("changed");
  await settled();
  expect(acquireRead).toHaveBeenCalledTimes(1);
  expect(repository.peek("RGRPDF24")).not.toBeNull();

  // Unasked past the retention, the next change lets it go unread.
  await runtime.runPromise(TestClock.adjust(tick));
  acquireRead.mockClear();
  dbEvents.emit("changed");
  await settled();
  expect(acquireRead).not.toHaveBeenCalled();
  expect(repository.peek("RGRPDF24")).toBeNull();
});

it("keeps the list an Annotation Draft stands on after its surface lets it go", async () => {
  await using stack = new AsyncDisposableStack();
  const { repository } = await setup(
    stack,
    {
      root: rootOk,
      children: () => annotationPage(ROUGIER_ANNOTATIONS),
    },
    { key: REMEMBERED_KEY },
  );
  await switchToLocalApi(repository);
  const view = repository.hold(["RGRPDF24"]);
  await repository.read("RGRPDF24");
  repository.editTextField("comment", "PUPR5FG5", "Typed before closing");
  view[Symbol.dispose]();

  expect(repository.peek("RGRPDF24")).not.toBeNull();
  expect(repository.textDraftFor("comment", "PUPR5FG5")?.text).toBe(
    "Typed before closing",
  );
});
