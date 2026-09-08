import { configureSync, getConsoleSink } from "@logtape/logtape";
import type { LogRecord } from "@logtape/logtape";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { App, TFile } from "obsidian";
import { afterEach, beforeEach, expect, it } from "vitest";

import { createClient } from "@zotlit/db/client/node";
import annotationSchema from "@zotlit/db/contract/annotation.schema.json" with { type: "json" };
import noteSchema from "@zotlit/db/contract/note.schema.json" with { type: "json" };
import { createFixtureSchema } from "@zotlit/db/test-utils";
import { exportLiteratureNotePack } from "@zotlit/templates/literature-note-pack";
import type { LiteratureNoteTemplatePartial } from "@zotlit/templates/literature-note-pack";
import { LOCAL_BRIDGE_PATHS } from "@zotlit/workbench/bridge";
import { DEFAULT_PROFILE_SOURCE } from "@zotlit/workbench/render";

import * as m from "@/lib/i18n/generated/messages";
import { defaults } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";

import { createLocalBridgeApp } from "./app";
import { STABLE_DOCS_ORIGIN } from "./origins";
import { createLocalBridgeReads } from "./reads";
import type { BridgeProfileReader } from "./reads";
import { BridgeSessions } from "./sessions";

const INSTALLATION_ID = "install-1";
const VAULT_NAME = "Research";
/** A Profile id of the shape the registry mints: twelve alphanumerics. */
const BOOKS_PROFILE = "Bk7Qm2Xr9Tz4";
const ITEM = { key: "MAIN2345", title: "An exported paper" };

/** The one note this vault holds for the selected Item. */
const ITEM_NOTE_PATH = "literatures/An exported paper.md";
/** The imported note of the Item's child note. */
const CHILD_NOTE_PATH = "zotero_notes/Reading note.md";
/** The image of the first annotation, already imported beside the note. */
const IMAGE_PATH = "literatures/attachments/ANIM2345.png";

/** A Profile document the vault holds, calling one partial of its own. */
const BOOKS_SOURCE = `---
id: ${BOOKS_PROFILE}
name: Books
version: 1.0.0
contract: 7
filename: '{{ zt.title }}{% suffix %}'
language: liquid
---
# {{ zt.title }}

{% render 'cite' %}

--- zotlit:annotation ---
{{ zt.text }}
`;

const CITE_PARTIAL: LiteratureNoteTemplatePartial = {
  name: "cite",
  language: "liquid",
  source: "[@{{ zt.citationKey }}]",
};

const ETA_PARTIAL: LiteratureNoteTemplatePartial = {
  name: "footer",
  language: "eta",
  source: "<%= it.zt.title %>",
};

let captured: LogRecord[] = [];

beforeEach(() => {
  captured = [];
  configureSync({
    reset: true,
    sinks: {
      capture: (record: LogRecord) => {
        captured.push(record);
      },
    },
    loggers: [
      { category: ["zotlit"], sinks: ["capture"], lowestLevel: "debug" },
      { category: ["logtape", "meta"], sinks: [], lowestLevel: "error" },
    ],
  });
});

afterEach(() => {
  configureSync({
    reset: true,
    sinks: { console: getConsoleSink() },
    loggers: [
      { category: ["logtape", "meta"], sinks: [], lowestLevel: "error" },
    ],
  });
});

/** Every field every captured record carries, as one string to search. */
function loggedText(): string {
  return captured
    .map(
      (record) =>
        `${record.message.join(" ")} ${JSON.stringify(record.properties)}`,
    )
    .join("\n");
}

interface Harness extends AsyncDisposable {
  request(
    path: string,
    init?: { method?: string; body?: string },
  ): Promise<Response>;
  dataDir: string;
  vaultFiles: Set<string>;
}

async function harness(
  options: {
    profileId?: string;
    /** Vault paths the note index and the vault answer for. */
    vaultFiles?: readonly string[];
    partials?: readonly LiteratureNoteTemplatePartial[];
  } = {},
): Promise<Harness> {
  await using stack = new AsyncDisposableStack();
  const dataDir = stack.adopt(
    await mkdtemp(join(tmpdir(), "zotlit-bridge-reads-")),
    (dir) => rm(dir, { recursive: true, force: true }),
  );
  await installStyles(dataDir);

  const sqlite = stack.adopt(createClient(":memory:"), (client) => {
    (client.$client as DatabaseSync).close();
  });
  seed(sqlite.$client as DatabaseSync);

  const vaultFiles = new Set(
    options.vaultFiles ?? [ITEM_NOTE_PATH, CHILD_NOTE_PATH, IMAGE_PATH],
  );
  const fileAt = (path: string): TFile | null =>
    vaultFiles.has(path) ? ({ path } as TFile) : null;
  const app = {
    vault: { getName: () => VAULT_NAME, getFileByPath: fileAt },
    fileManager: {
      getAvailablePathForAttachment: (name: string) =>
        Promise.resolve(`literatures/attachments/${name}`),
    },
  } as unknown as App;

  const settings = {
    loaded: Promise.resolve({ ...defaults, "attachment.import": true }),
  } as unknown as Pick<SettingsService, "loaded">;

  const partials = options.partials ?? [CITE_PARTIAL];
  const reads = createLocalBridgeReads({
    app,
    settings,
    db: {
      acquireRead: () =>
        Promise.resolve({
          client: sqlite,
          [Symbol.dispose]() {},
        }),
    } as never,
    noteIndex: {
      whenIndexed: () => Promise.resolve(),
      getNotesByItemKey: (indexedKey: string) =>
        indexedKey === ITEM.key ? [fileAt(ITEM_NOTE_PATH)].filter(Boolean) : [],
      getImportedNoteByNoteKey: (noteKey: string) =>
        noteKey === "NOTE2345" ? [fileAt(CHILD_NOTE_PATH)].filter(Boolean) : [],
    } as never,
    profile: profileReader(),
    template: {
      ready: Promise.resolve(),
      exportLiteratureNotePackSource: (
        source: string,
        exportOptions: Parameters<typeof exportLiteratureNotePack>[2],
      ) =>
        Promise.resolve(
          exportLiteratureNotePack(source, partials, exportOptions),
        ),
    } as never,
    zoteroPref: { ready: Promise.resolve(), dataDir },
    installationId: () => INSTALLATION_ID,
    vaultName: () => VAULT_NAME,
  });

  const sessions = new BridgeSessions(() => {});
  const app_ = createLocalBridgeApp({
    available: () => true,
    enabled: () => true,
    peerAddress: () => "127.0.0.1",
    allowedOrigins: [STABLE_DOCS_ORIGIN],
    sessions,
    reads,
    // The Save has its own suite; a read never reaches the write boundary.
    save: {
      saveSelectedProfile: () => Promise.reject(new Error("not used here")),
    },
    describeGrant: () => Promise.reject(new Error("not used here")),
  });
  const code = sessions.mintCode({
    origin: STABLE_DOCS_ORIGIN,
    profileId: options.profileId ?? BOOKS_PROFILE,
    item: ITEM,
  });
  const credential = sessions.exchange(code, STABLE_DOCS_ORIGIN)!.credential;

  const held = stack.move();
  return {
    dataDir,
    vaultFiles,
    request: async (path, init = {}) =>
      await app_.request(path, {
        ...init,
        headers: {
          Origin: STABLE_DOCS_ORIGIN,
          Authorization: `Bearer ${credential}`,
        },
      }),
    [Symbol.asyncDispose]: () => held[Symbol.asyncDispose](),
  };
}

/** The registry as the bridge reads it: two Profiles, one of them the built-in. */
function profileReader(): BridgeProfileReader {
  return {
    ready: Promise.resolve(),
    loaded: true,
    resolveProfile: (selector: string) => {
      if (selector === BOOKS_PROFILE) {
        return { label: "Books", document: "zotlit-profile.books.md" };
      }
      // Default is still built-in here: it has no document of its own.
      if (selector === "default")
        return { label: undefined, document: undefined };
      return undefined;
    },
    getSource: (selector: string) =>
      Promise.resolve(
        selector === "default" ? DEFAULT_PROFILE_SOURCE : BOOKS_SOURCE,
      ),
  } as unknown as BridgeProfileReader;
}

it("answers the generated Note, Annotation, and Filename schemas", async () => {
  await using bridge = await harness();

  const res = await bridge.request(LOCAL_BRIDGE_PATHS.templateSchema);

  expect(res.status).toBe(200);
  const schemas = (await res.json()) as Record<string, { $id?: string }>;
  expect(Object.keys(schemas).sort()).toEqual([
    "annotation",
    "filename",
    "note",
  ]);
  expect(schemas["note"]).toEqual(noteSchema);
  expect(schemas["annotation"]).toEqual(annotationSchema);
});

it("exports the selected Item with the vault targets this vault can answer", async () => {
  await using bridge = await harness();

  const res = await bridge.request(LOCAL_BRIDGE_PATHS.selectedItem, {
    method: "POST",
    body: JSON.stringify({}),
  });

  expect(res.status).toBe(200);
  const body = await res.text();
  const snapshot = JSON.parse(body) as {
    item: { key: string };
    provenance: Record<string, unknown>;
    roots: { note: Record<string, unknown>; annotations: unknown[] };
    unavailable: { path: string; reason: string }[];
  };
  expect(snapshot.item).toMatchObject({
    key: ITEM.key,
    itemType: "journalArticle",
  });
  expect(snapshot.provenance).toEqual({
    kind: "connected",
    installationId: INSTALLATION_ID,
    vault: VAULT_NAME,
  });
  // The Item's own note and its child note's imported note are the two links
  // this vault can render, and both are vault-relative.
  expect(snapshot.roots.note["notePath"]).toBe(ITEM_NOTE_PATH);
  expect(JSON.stringify(snapshot.roots.note)).toContain(CHILD_NOTE_PATH);
  // The related Item has no note here, so no target is invented for it.
  expect(snapshot.roots.note["relatedItems"]).toMatchObject([
    { key: "RELA2345", notePath: null, noteLink: { value: null } },
  ]);
  // The attachment file and the personal-library web link never cross.
  expect(snapshot.unavailable.map(({ path }) => path)).toEqual(
    expect.arrayContaining([
      "zt.weblink",
      "zt.attachments[0].filePath",
      "zt.attachments[0].fileLink",
    ]),
  );
  // Nothing absolute, and no Zotero cache path, reaches the page.
  expect(body).not.toContain("/Users/");
  expect(body).not.toContain("PRIVATE CHILD NOTE BODY");
});

it("reports an annotation image the vault does not hold and links the one it does", async () => {
  await using bridge = await harness();

  const res = await bridge.request(LOCAL_BRIDGE_PATHS.selectedItem, {
    method: "POST",
    body: JSON.stringify({}),
  });
  const snapshot = (await res.json()) as {
    roots: { annotations: Record<string, unknown>[] };
    unavailable: { path: string; reason: string }[];
  };

  expect(JSON.stringify(snapshot.roots.annotations[0])).toContain(IMAGE_PATH);
  expect(snapshot.unavailable.map(({ path }) => path)).toContain(
    "annotations[1].zt.imgLink",
  );
});

it("answers the exact source of a Profile the vault holds", async () => {
  await using bridge = await harness();

  const res = await bridge.request(LOCAL_BRIDGE_PATHS.selectedProfile);

  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toEqual({
    profile: { id: BOOKS_PROFILE, name: "Books" },
    source: BOOKS_SOURCE,
    document: {
      state: "present",
      reference: BOOKS_PROFILE,
      // `shasum -a 256` over the same bytes, as an oracle independent of the
      // hash the read computes.
      revision:
        "0b198711d2e2994319d4d1f242dbe613e29783fc75907084628f7373d5033803",
    },
  });
});

it("answers built-in Default with the document an eject would write", async () => {
  await using bridge = await harness({ profileId: "default" });

  const res = await bridge.request(LOCAL_BRIDGE_PATHS.selectedProfile);

  await expect(res.json()).resolves.toEqual({
    profile: { id: "default", name: m.settings_profile_default_name() },
    source: DEFAULT_PROFILE_SOURCE,
    document: { state: "built-in-absent", reference: "default" },
  });
});

it("bundles the partials the submitted draft calls", async () => {
  await using bridge = await harness();

  const res = await bridge.request(LOCAL_BRIDGE_PATHS.templateDependencies, {
    method: "POST",
    body: JSON.stringify({ source: BOOKS_SOURCE }),
  });

  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toEqual({
    templates: [CITE_PARTIAL],
    diagnostics: [],
  });
});

it("reports a partial no vault holds as a diagnostic", async () => {
  await using bridge = await harness({ partials: [] });

  const res = await bridge.request(LOCAL_BRIDGE_PATHS.templateDependencies, {
    method: "POST",
    body: JSON.stringify({ source: BOOKS_SOURCE }),
  });

  const bundle = (await res.json()) as {
    templates: unknown[];
    diagnostics: { code: string; message: string }[];
  };
  expect(bundle.templates).toEqual([]);
  expect(bundle.diagnostics).toEqual([
    { code: "missing-dependency", message: expect.stringContaining("cite") },
  ]);
});

it("bundles the cite partial a draft never calls", async () => {
  await using bridge = await harness();
  const source = BOOKS_SOURCE.replace("{% render 'cite' %}", "");

  const res = await bridge.request(LOCAL_BRIDGE_PATHS.templateDependencies, {
    method: "POST",
    body: JSON.stringify({ source }),
  });

  await expect(res.json()).resolves.toEqual({
    templates: [CITE_PARTIAL],
    diagnostics: [],
  });
});

it("keeps the partials that resolved when one call goes unanswered", async () => {
  await using bridge = await harness();
  const source = BOOKS_SOURCE.replace(
    "{% render 'cite' %}",
    "{% render 'cite' %}\n{% render 'header' %}",
  );

  const res = await bridge.request(LOCAL_BRIDGE_PATHS.templateDependencies, {
    method: "POST",
    body: JSON.stringify({ source }),
  });

  await expect(res.json()).resolves.toEqual({
    templates: [CITE_PARTIAL],
    diagnostics: [
      {
        code: "missing-dependency",
        message: "Template dependency 'header' is missing from this vault.",
      },
    ],
  });
});

it("reports a dependency the web Workbench cannot run as a diagnostic", async () => {
  await using bridge = await harness({ partials: [CITE_PARTIAL, ETA_PARTIAL] });
  const source = BOOKS_SOURCE.replace(
    "{% render 'cite' %}",
    "{% render 'cite' %}\n{% render 'footer' %}",
  );

  const res = await bridge.request(LOCAL_BRIDGE_PATHS.templateDependencies, {
    method: "POST",
    body: JSON.stringify({ source }),
  });

  const bundle = (await res.json()) as {
    templates: { name: string }[];
    diagnostics: { code: string }[];
  };
  expect(bundle.templates.map(({ name }) => name)).toEqual(["cite"]);
  expect(bundle.diagnostics).toEqual([
    {
      code: "unsupported-dependency",
      message: expect.stringContaining("footer"),
    },
  ]);
});

it("lists the installed citation styles and resolves the selected one", async () => {
  await using bridge = await harness();

  const listed = await bridge.request(LOCAL_BRIDGE_PATHS.citationStyles);
  await expect(listed.json()).resolves.toEqual([
    { id: "http://www.zotero.org/styles/apa", title: "APA" },
    // A style with no title falls back to its id, never to its file name.
    {
      id: "http://www.zotero.org/styles/untitled",
      title: "http://www.zotero.org/styles/untitled",
    },
  ]);

  const resolved = await bridge.request(
    LOCAL_BRIDGE_PATHS.selectedCitationStyle,
    {
      method: "POST",
      body: JSON.stringify({ styleId: "http://www.zotero.org/styles/apa" }),
    },
  );
  await expect(resolved.json()).resolves.toMatchObject({
    kind: "installed",
    styleId: "http://www.zotero.org/styles/apa",
    xml: expect.stringContaining("<style"),
  });
});

it("refuses a Profile this vault no longer holds", async () => {
  await using bridge = await harness({ profileId: "Zz9Qm2Xr9Tz4" });

  const res = await bridge.request(LOCAL_BRIDGE_PATHS.selectedProfile);

  expect(res.status).toBe(409);
  await expect(res.json()).resolves.toEqual({
    error: { code: "document-missing", message: expect.any(String) },
  });
});

it("logs the operation and never the source, the snapshot, or the credential", async () => {
  await using bridge = await harness();
  await bridge.request(LOCAL_BRIDGE_PATHS.selectedProfile);
  await bridge.request(LOCAL_BRIDGE_PATHS.selectedItem, {
    method: "POST",
    body: JSON.stringify({}),
  });

  const logged = loggedText();
  expect(logged).toContain("selected-profile");
  expect(logged).toContain("selected-item");
  expect(logged).not.toContain("Bearer");
  expect(logged).not.toContain("{% render 'cite' %}");
  expect(logged).not.toContain(ITEM.title);
  expect(logged).not.toContain(ITEM_NOTE_PATH);
});

/** Two styles Zotero would install, one of them without a title. */
async function installStyles(dataDir: string): Promise<void> {
  const dir = join(dataDir, "styles");
  await mkdir(dir, { recursive: true });
  const style = (id: string, title?: string): string =>
    [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">',
      "  <info>",
      ...(title === undefined ? [] : [`    <title>${title}</title>`]),
      `    <id>${id}</id>`,
      "  </info>",
      `  <bibliography><layout><text value="${id}"/></layout></bibliography>`,
      "</style>",
    ].join("\n");
  await writeFile(
    join(dir, "apa.csl"),
    style("http://www.zotero.org/styles/apa", "APA"),
  );
  await writeFile(
    join(dir, "no-title.csl"),
    style("http://www.zotero.org/styles/untitled"),
  );
}

/**
 * One paper with an attachment carrying two image annotations, a child note,
 * and a related Item — the four link targets a Snapshot may name.
 */
function seed(sqlite: DatabaseSync): void {
  createFixtureSchema(sqlite);
  sqlite.exec(`
    insert into libraries (libraryID, type, editable, filesEditable)
      values (1, 'user', 1, 1);
    insert into settings (setting, key, value)
      values ('account', 'username', 'Ada Researcher');
    insert into itemTypes (itemTypeID, typeName)
      values (1, 'journalArticle'), (2, 'attachment'), (3, 'annotation'), (4, 'note');
    insert into fieldsCombined (fieldID, fieldName, custom)
      values (10, 'title', 0), (11, 'citationKey', 0);
    insert into itemDataValues (valueID, value)
      values (100, 'An exported paper'), (101, 'exported2026'), (102, 'A related paper');
    insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
      values
        (1, 1, '2026-01-01 00:00:00', '2026-01-02 00:00:00', 1, 'MAIN2345'),
        (2, 2, '2026-01-01 00:00:00', '2026-01-02 00:00:00', 1, 'ATCH2345'),
        (3, 3, '2026-01-01 00:00:00', '2026-01-02 00:00:00', 1, 'ANIM2345'),
        (4, 4, '2026-01-01 00:00:00', '2026-01-02 00:00:00', 1, 'NOTE2345'),
        (5, 1, '2026-01-01 00:00:00', '2026-01-02 00:00:00', 1, 'RELA2345'),
        (6, 3, '2026-01-01 00:00:00', '2026-01-02 00:00:00', 1, 'ANIB2345');
    insert into itemData (itemID, fieldID, valueID)
      values (1, 10, 100), (1, 11, 101), (5, 10, 102);
    insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
      values (2, 1, 2, 'application/pdf', '/Users/researcher/Zotero/storage/paper.pdf');
    insert into itemAnnotations (
      itemID, parentItemID, type, text, comment, color, pageLabel, sortIndex,
      position, isExternal
    ) values
      (3, 2, 3, null, 'First excerpt', '#ffd400', '7', '00000|000001|00000',
       '{"pageIndex":6,"rects":[]}', 0),
      (6, 2, 3, null, 'Second excerpt', '#ffd400', '8', '00000|000002|00000',
       '{"pageIndex":7,"rects":[]}', 0);
    insert into itemNotes (itemID, parentItemID, note, title)
      values (4, 1, '<p>PRIVATE CHILD NOTE BODY</p>', 'Reading note');
    insert into relationPredicates (predicateID, predicate)
      values (1, 'dc:relation');
    insert into itemRelations (itemID, predicateID, object)
      values (1, 1, 'http://zotero.org/users/12345/items/RELA2345');
  `);
}

it("keeps malformed draft excerpts out of operation failure logs", async () => {
  await using bridge = await harness();
  const marker = "PRIVATE-DRAFT-EXCERPT";
  const res = await bridge.request(LOCAL_BRIDGE_PATHS.templateDependencies, {
    method: "POST",
    body: JSON.stringify({ source: `---\nname: [${marker}\n---\n` }),
  });

  expect(res.status).toBe(500);
  await expect(res.json()).resolves.toMatchObject({
    error: { code: "operation-failed" },
  });
  const failures = captured.filter((record) => record.level === "error");
  expect(failures).toHaveLength(1);
  expect(failures[0]!.properties).toEqual({
    operation: LOCAL_BRIDGE_PATHS.templateDependencies,
    reason: "operation-failed",
  });
  expect(loggedText()).not.toContain(marker);
});
