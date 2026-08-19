// Man-page-style reference for the Fixture, built from the spec's data.

import { PINNED_ZOTERO_VERSION } from "./paired-zotero.ts";
import { PRISTINE_SCHEMA_VERSIONS } from "./pristine.ts";
import {
  COLLECTIONS,
  ITEMS,
  LIBRARIES,
  LIBRARY_SCOPE_SETTING_KEY,
  NOTES,
  PERSONAL_SELECTOR,
  SCOPE_CASES,
  UNAVAILABLE_GROUP_IDS,
} from "./spec.ts";
import type { FixtureItem, FixtureNote } from "./spec.ts";

function libraryName(libraryID: number): string {
  const library = LIBRARIES.find((l) => l.libraryID === libraryID);
  return library ? (library.name ?? "My Library") : `libraryID ${libraryID}`;
}

/** Groups entries by a key, keeping only groups with more than one member. */
function collisions<T>(
  entries: readonly T[],
  keyOf: (entry: T) => string,
): Map<string, T[]> {
  const grouped = Map.groupBy(entries, keyOf);
  for (const [key, group] of grouped) {
    if (group.length < 2) grouped.delete(key);
  }
  return grouped;
}

function librariesRow(members: readonly { libraryID: number }[]): string {
  return [...new Set(members.map((m) => libraryName(m.libraryID)))].join(", ");
}

const LIBRARIES_SECTION = `LIBRARIES

${LIBRARIES.map((library) => {
  const selector = library.groupID ?? PERSONAL_SELECTOR;
  const membership = library.editable ? "editable" : "read-only";
  return `  ${String(selector).padEnd(10)} libraryID ${library.libraryID}  ${membership}  ${library.name ?? "My Library"}`;
}).join("\n")}
  unavailable selectors: ${UNAVAILABLE_GROUP_IDS.join(", ")}

Local libraryID order deliberately disagrees with group ID order, so a
canonical-order check proves that stable selector order does not follow
database row order.`;

function collectionsSection(): string {
  const byKey = Map.groupBy(COLLECTIONS, (c) => c.key);
  const rows = [...byKey.entries()].map(([key, entries]) => {
    const flag =
      entries.length > 1
        ? ` — shared by ${librariesRow(entries)}`
        : ` — ${libraryName(entries[0]!.libraryID)}`;
    return `  ${key}${flag}`;
  });
  return `COLLECTIONS

${rows.join("\n")}`;
}

function itemsSection(): string {
  const byCitationKey = collisions(
    ITEMS.filter(
      (item): item is FixtureItem & { citationKey: string } =>
        item.citationKey !== null,
    ),
    (item) => item.citationKey,
  );
  const byZoteroKey = collisions(ITEMS, (item) => item.key);
  const byModified = collisions(ITEMS, (item) => item.dateModified);

  const citationKeyRows =
    [...byCitationKey.entries()]
      .map(
        ([key, items]) =>
          `  ${key} — ${items.length} items in ${librariesRow(items)}`,
      )
      .join("\n") || "  none";

  const zoteroKeyRows =
    [...byZoteroKey.entries()]
      .map(
        ([key, items]) =>
          `  ${key} — ${items.length} items in ${librariesRow(items)}`,
      )
      .join("\n") || "  none";

  const modifiedRows =
    [...byModified.entries()]
      .map(([time, items]) => {
        const libraryIDs = new Set(items.map((item) => item.libraryID));
        const spread =
          libraryIDs.size > 1 ? "cross-Library" : "within one Library";
        const keys = items.map((item) => item.key).join(", ");
        return `  ${time} — ${keys} (${spread}: ${librariesRow(items)})`;
      })
      .join("\n") || "  none";

  return `ITEMS

CITATION KEY COLLISIONS
${citationKeyRows}

ZOTERO KEY COLLISIONS
${zoteroKeyRows}

MODIFICATION TIME TIES
${modifiedRows}`;
}

function notesSection(): string {
  const librariesWithNotes = [
    ...new Set(NOTES.map((note) => libraryName(note.libraryID))),
  ];
  const childNotes = NOTES.filter((note) => note.parentItemID !== null);
  const standaloneNotes = NOTES.filter((note) => note.parentItemID === null);
  const byKey = collisions(NOTES, (note) => note.key);
  const keyRows =
    [...byKey.entries()]
      .map(
        ([key, notes]: [string, FixtureNote[]]) =>
          `  ${key} — ${notes.length} notes in ${librariesRow(notes)}`,
      )
      .join("\n") || "  none";

  return `NOTES

  Libraries holding notes: ${librariesWithNotes.join(", ")}
  Child notes: ${childNotes.length}
  Standalone notes: ${standaloneNotes.length}

NOTE KEY COLLISIONS
${keyRows}`;
}

const SCOPE_CASES_SECTION = `SCOPE CASES

${SCOPE_CASES.map((c) => `  ${c.id.padEnd(12)} ${c.summary}`).join("\n")}

The persisted key and value shape live in LIBRARY_SCOPE_SETTING_KEY
("${LIBRARY_SCOPE_SETTING_KEY}") and PersistedLibraryScope in spec.ts. They
are the one place to update when the Library Scope setting changes shape.`;

const VAULT_SETUP_SECTION = `VAULT SETUP

1. Register the vault:
   packages/scripts/scripts/obsidian-vault.ts create tmp/acceptance-fixture/zt-fixture-vault

2. In that vault, open the ZotLit settings and set Zotero profile to
   tmp/acceptance-fixture/zotero-profile through "Choose folder…". ZotLit
   reads the data directory from that profile's prefs.js, so one override
   moves the whole install onto the Fixture.

The override is a Device Override in the vault's local storage, so it never
touches your real Zotero settings. From an Obsidian window on that vault, the
CLI sets it directly:

  obsidian-cli vault=zt-fixture-vault eval \\
    "code=app.saveLocalStorage('zotlit-zotero-paths',{profileDir:'<abs path>/tmp/acceptance-fixture/zotero-profile'})"`;

const CANCEL_TESTING_SECTION = `CANCEL TESTING

A batch update writes 32 items at once and the Fixture holds 12, so every item
starts immediately and no item ever waits in a queue. A cancel that arrives one
macrotask after the confirm click therefore finds the whole plan in flight, and
the run reports "Done.". Click Cancel in the same JavaScript turn as the
confirm button to reach the write-phase abort:

  obsidian-cli vault=zt-fixture-vault eval code='
  const modal = document.querySelector(".modal-container .modal");
  [...modal.querySelectorAll("button")].find((b) => b.classList.contains("mod-cta")).click();
  [...modal.querySelectorAll("button")].find((b) => /cancel/i.test(b.textContent)).click();
  '

The confirm click renders the progress phase before it returns, so the second
click aborts the run that phase already started. The modal reports
"Stopped. 0 created, 0 updated, 0 failed." and lists every row under Not run.
Delete one literature note before the run to prove the abort wrote nothing: the
aborted run leaves the note absent, and the same run without the cancel creates
it.`;

const PRISTINE_TEMPLATE_SECTION = `PRISTINE TEMPLATE

Every build copies packages/scripts/lib/fixture/pristine-zotero.sqlite.gz — a
Zotero ${PINNED_ZOTERO_VERSION} database, created by Zotero itself — and inserts the Spec's
rows into the copy, so the Paired Zotero opens a database of its own making.
The template declares userdata ${PRISTINE_SCHEMA_VERSIONS.userdata} / compatibility ${PRISTINE_SCHEMA_VERSIONS.compatibility}, and a build fails when it
declares anything else. See ADR 0022.

Regenerate it after a Zotero schema bump:

1. Raise PINNED_ZOTERO_VERSION in packages/scripts/lib/fixture/paired-zotero.ts
   to the Zotero release the Fixture should target.
2. Raise PRISTINE_SCHEMA_VERSIONS in packages/scripts/lib/fixture/pristine.ts to
   the userdata and compatibility versions that release writes, and widen
   SUPPORTED_SCHEMA_VERSIONS in packages/db/src/queries/schema-version.ts to
   cover them.
3. Run:

     pnpm fixture harvest

   It first-runs the managed Zotero on an empty data directory, waits for the
   database to initialize, quits Zotero, checkpoints and vacuums the result,
   and rewrites the committed template. It reports the versions it captured.
4. Rebuild and run the generator suite:

     pnpm fixture && turbo run test --filter=@zotlit/scripts

5. Commit the template with the version bumps.`;

const CHANGING_THE_FIXTURE_SECTION = `CHANGING THE FIXTURE

Edit packages/scripts/lib/fixture/spec.ts and rebuild.
packages/scripts/lib/fixture/build.test.ts guards the spec properties.`;

/**
 * Renders the Fixture reference: data-derived Library, Collection, Item, and
 * Note tables plus the vault-setup and cancel-testing procedures.
 */
export function renderGuide(): string {
  return [
    LIBRARIES_SECTION,
    collectionsSection(),
    itemsSection(),
    notesSection(),
    SCOPE_CASES_SECTION,
    VAULT_SETUP_SECTION,
    CANCEL_TESTING_SECTION,
    PRISTINE_TEMPLATE_SECTION,
    CHANGING_THE_FIXTURE_SECTION,
  ].join("\n\n");
}
