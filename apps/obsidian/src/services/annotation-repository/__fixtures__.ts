// The Annotation Repository over a real query client and a real Zotero Local
// API client, with a fake transport under it: the seam every surface reads and
// writes through. The repository's own suite and the reader suites build on it,
// so a reader test sees the pending, failed and conflicted states the
// repository itself produces.

import { vi } from "vitest";

import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import type { DatabaseEvents } from "@/services/database/service";
import { QueryClientService } from "@/services/query-client/service";
import {
  annotationItem,
  annotationPage,
  createAccepted,
  createRefused,
  localApiClient,
  notFound,
  rootOk,
  ROUGIER_ANNOTATIONS,
  SERVER_ID,
  unreachable,
  writeAccepted,
} from "@/services/zotero-local-api/__fixtures__";
import type {
  ClientOptions,
  WireAnnotation,
  ZoteroAnswers,
  ZoteroRequest,
} from "@/services/zotero-local-api/__fixtures__";
import type { WireTag } from "@/services/zotero-local-api/wire";

import { AnnotationRepository } from "./service";
import type { AnnotationRepositoryDeps } from "./service";

export const NOW = Temporal.Instant.from("2026-09-16T15:52:21Z");

// The Fixture's own rows are the oracle: the same item ids, keys, types,
// colours, sort indexes and positions it builds on `rougier-2014.pdf`, which
// carries one Annotation of each of Zotero's six types. The two ink strokes
// keep the first three points of the Fixture's path — the repository moves a
// position through unchanged, so the rest of the stroke proves nothing. The
// EPUB attachment is not in the Fixture: it is seeded here so the content type
// the position is narrowed by is observable.
// @see packages/scripts/lib/fixture/spec.ts — `ANNOTATIONS`
export const FIXTURE_ROWS = `
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

/** A Remembered Write Authorization, so no gesture stands between a command and Zotero. */
export const REMEMBERED_KEY = "5ixBzUhQfLu8i8RIhU6OEzENW4pAITLf";

/**
 * The repository over a Zotero Local API session that already holds a Write
 * Authorization, with the Fixture's Annotations read into its partition — the
 * state a card is in when the user reaches for a verb.
 */
export async function writable(
  stack: AsyncDisposableStack,
  answers: ZoteroAnswers = {},
  options: {
    key?: string;
    writeToken?: () => string;
    repositoryNow?: () => Temporal.Instant;
  } = {},
) {
  const { writeToken, repositoryNow } = options;
  // Named as `undefined` means "no Remembered Authorization", which is not the
  // same as leaving it out.
  const key = "key" in options ? options.key : REMEMBERED_KEY;
  const harness = await setup(
    stack,
    {
      children: () => annotationPage(ROUGIER_ANNOTATIONS),
      item: () => annotationItem(afterWrite("PUPR5FG5", { color: "#ff6666" })),
      ...answers,
    },
    { key, writeToken, repositoryNow },
  );
  await switchToLocalApi(harness.repository);
  await harness.repository.read("RGRPDF24");
  return harness;
}

/** One Fixture Annotation as Zotero answers it once a write has landed. */
export function afterWrite(
  key: string,
  patch: Partial<WireAnnotation>,
): WireAnnotation {
  const record = ROUGIER_ANNOTATIONS.find((entry) => entry.key === key);
  if (!record) throw new Error(`No fixture annotation ${key}`);
  return { ...record, ...patch };
}

/** Read once so the Capability Probe runs, and wait for the source it finds. */
export async function switchToLocalApi(
  repository: AnnotationRepository,
): Promise<void> {
  const announced = nextChange(repository);
  await repository.read("RGRPDF24");
  await announced;
}

/**
 * The repository over a real query client and a real Zotero Local API client,
 * with a fake transport under it: the seam a surface reads through, driven by
 * the answers a Paired Run recorded.
 *
 * @param answers what Zotero answers. The default is a Zotero that is not
 *   running, so the Zotero DB is the source.
 */
export async function setup(
  stack: AsyncDisposableStack,
  answers: ZoteroAnswers = { root: unreachable },
  options: ClientOptions & {
    writeToken?: () => string;
    /** The repository's own clock, which the `dateAdded` window is read against. */
    repositoryNow?: () => Temporal.Instant;
    /** What this device's persisted Excerpt Images were made from, by Annotation. */
    persistedExcerpt?: AnnotationRepositoryDeps["persistedExcerpt"];
  } = {},
) {
  const { writeToken, repositoryNow, persistedExcerpt, ...clientOptions } =
    options;
  const client = createClient(":memory:");
  stack.defer(() => client.$client.close());
  createFixtureSchema(client.$client);
  client.$client.exec(FIXTURE_ROWS);
  client.$client.exec(
    `insert into version (schema, version) values ('userdata', 129), ('compatibility', 9);
     insert into libraries (libraryID, type, version, clientVersion) values (1, 'user', 0, 37);
     update items set version = 0, clientVersion = 29 where itemID = 48;
     insert into settings (setting, key, value) values ('localAPI', 'serverID', '${SERVER_ID}');`,
  );

  const dbEvents = createNanoEvents<DatabaseEvents>();
  const acquireRead = vi.fn(() =>
    Promise.resolve({ client, [Symbol.dispose]: () => undefined }),
  );
  const db = {
    acquireRead,
    refresh: vi.fn(() => Promise.resolve()),
    on: <K extends keyof DatabaseEvents>(event: K, cb: DatabaseEvents[K]) =>
      dbEvents.on(event, cb),
  };

  const {
    client: localApi,
    requests,
    serverEvents,
    prefEvents,
  } = localApiClient(answers, clientOptions);
  stack.use(localApi);
  await localApi.ready;

  const queryClient = new QueryClientService();
  stack.use(queryClient);
  const repository = new AnnotationRepository({
    db,
    queryClient,
    localApi,
    now: repositoryNow ?? (() => NOW),
    writeToken,
    persistedExcerpt,
  });
  stack.use(repository);
  await repository.ready;
  return {
    repository,
    client,
    db,
    dbEvents,
    acquireRead,
    queryClient,
    localApi,
    requests,
    serverEvents,
    prefEvents,
  };
}

/** The next `annotations-changed` the repository emits, as a completion signal. */
export function nextChange(
  repository: AnnotationRepository,
): Promise<readonly string[]> {
  return new Promise((resolve) => {
    const announced: string[] = [];
    const off = repository.on("annotations-changed", (key) => {
      announced.push(key);
      queueMicrotask(() => {
        off();
        resolve(announced);
      });
    });
  });
}

/**
 * A Zotero that keeps everything ZotLit writes to it — a patch of any field, an
 * erase, and a create it answers with a key of its own, as Zotero 10 does with
 * the client-supplied key it refuses. What the Local API holds is the oracle
 * every assertion reads through; nothing asks the repository what it thinks.
 *
 * @param seed the Annotations of `RGRPDF24` it starts with.
 */
export function zoteroLibrary(
  seed: readonly WireAnnotation[] = ROUGIER_ANNOTATIONS,
) {
  const held = new Map<string, WireAnnotation>(
    seed.map((entry) => [entry.key, { ...entry }]),
  );
  /** The keys this Zotero hands out, in order, for the creates it takes. */
  const generated = ["MADE2345", "MADE2346", "MADE2347", "MADE2348"];
  let made = 0;
  /** The answer the next write gets in place of the stored one. */
  let next: ((request: ZoteroRequest) => Promise<Response> | Response) | null =
    null;
  let hold: Promise<void> | null = null;
  let running = true;
  const keyOf = ({ url }: ZoteroRequest): string =>
    url.pathname.split("/").at(-1) ?? "";
  const create = (request: ZoteroRequest): Response => {
    const [body] = JSON.parse(request.body ?? "[]") as {
      annotationType: string;
      annotationText?: string;
      annotationComment: string;
      annotationColor: string;
      annotationPageLabel: string;
      annotationSortIndex: string;
      annotationPosition: string;
    }[];
    const key = generated[made++];
    if (!body || key === undefined) return createRefused();
    const record: WireAnnotation = {
      key,
      version: 60 + made,
      type: body.annotationType,
      ...(body.annotationText !== undefined && { text: body.annotationText }),
      comment: body.annotationComment,
      color: body.annotationColor,
      pageLabel: body.annotationPageLabel,
      sortIndex: body.annotationSortIndex,
      position: JSON.parse(body.annotationPosition),
    };
    held.set(key, record);
    return createAccepted(record);
  };
  const patch = (request: ZoteroRequest): Response => {
    const key = keyOf(request);
    const entry = held.get(key);
    const body = JSON.parse(request.body ?? "{}") as {
      annotationColor?: string;
      annotationComment?: string;
      annotationPosition?: string;
      annotationSortIndex?: string;
      annotationText?: string;
      tags?: Required<WireTag>[];
    };
    if (entry) {
      held.set(key, {
        ...entry,
        ...(body.annotationColor !== undefined && {
          color: body.annotationColor,
        }),
        ...(body.annotationComment !== undefined && {
          comment: body.annotationComment,
        }),
        ...(body.annotationPosition !== undefined && {
          position: JSON.parse(body.annotationPosition) as unknown,
        }),
        ...(body.annotationSortIndex !== undefined && {
          sortIndex: body.annotationSortIndex,
        }),
        ...(body.annotationText !== undefined && { text: body.annotationText }),
        // Zotero writes a type for an automatic tag only.
        ...(body.tags !== undefined && {
          tags: body.tags.map(({ tag, type }) =>
            type === 0 ? tag : { tag, type },
          ),
        }),
        version: entry.version + 1,
      });
    }
    return writeAccepted();
  };
  return {
    answers: {
      root: () => (running ? rootOk() : unreachable()),
      children: () => annotationPage([...held.values()]),
      item: (request) => {
        const entry = held.get(keyOf(request));
        return entry ? annotationItem(entry) : notFound();
      },
      write: async (request) => {
        if (hold) await hold;
        const answer = next;
        next = null;
        if (answer) return await answer(request);
        if (request.method === "POST") return create(request);
        if (request.method === "DELETE") {
          const key = keyOf(request);
          if (!held.has(key)) return notFound();
          held.delete(key);
          return writeAccepted();
        }
        return patch(request);
      },
    } satisfies ZoteroAnswers,
    /** What the Local API holds for one Annotation, or `null` once erased. */
    at(key: string): WireAnnotation | null {
      return held.get(key) ?? null;
    },
    /** An edit made in Zotero itself, beside ZotLit. */
    changeInZotero(key: string, patch: Partial<WireAnnotation>): void {
      const entry = held.get(key);
      if (entry)
        held.set(key, { ...entry, ...patch, version: entry.version + 1 });
    },
    /** An erase in Zotero itself. */
    eraseInZotero(key: string): void {
      held.delete(key);
    },
    /** Zotero quits, so its Local API stops answering. */
    quit(): void {
      running = false;
    },
    /** An Annotation put back in Zotero itself, out of its trash. */
    restoreInZotero(key: string): void {
      const entry = seed.find((candidate) => candidate.key === key);
      if (entry) held.set(key, { ...entry, version: entry.version + 1 });
    },
    /**
     * Answer the next write with `answer` in place of storing it: a refusal,
     * a lost reply, or a reply held open.
     */
    answerNextWrite(
      answer: (request: ZoteroRequest) => Promise<Response> | Response,
    ): void {
      next = answer;
    },
    /** Hold every write until the returned release is called. */
    holdWrites(): () => void {
      const { promise, resolve } = Promise.withResolvers<void>();
      hold = promise;
      return () => {
        hold = null;
        resolve();
      };
    },
  };
}
