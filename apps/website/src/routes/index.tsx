import { createFileRoute } from "@tanstack/react-router";
import { useState, type ChangeEvent } from "react";

import { formatItemDate } from "@zotlit/db";

import {
  loadDatabaseFile,
  fetchLibraries,
  fetchItems,
  type Item,
  type Library,
} from "@/lib/zotero-db";

export const Route = createFileRoute("/")({ component: Home });

type Status =
  | { kind: "idle" }
  | { kind: "loading-file" }
  | {
      kind: "ready";
      libraries: Library[];
      libraryID: number | null;
      items: Item[];
      loadingItems: boolean;
    }
  | { kind: "error"; message: string };

function Home() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onPickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setStatus({ kind: "loading-file" });
    try {
      await loadDatabaseFile(file);
      const libraries = await fetchLibraries();
      const first = libraries[0];
      if (!first) {
        setStatus({
          kind: "ready",
          libraries,
          libraryID: null,
          items: [],
          loadingItems: false,
        });
        return;
      }
      const items = await fetchItems(first.libraryID);
      setStatus({
        kind: "ready",
        libraries,
        libraryID: first.libraryID,
        items,
        loadingItems: false,
      });
    } catch (err) {
      console.error(err);
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function onPickLibrary(event: ChangeEvent<HTMLSelectElement>) {
    if (status.kind !== "ready") return;
    const libraryID = Number(event.target.value);
    setStatus({ ...status, libraryID, loadingItems: true });
    try {
      const mod = await import("../lib/zotero-db");
      const items = await mod.fetchItems(libraryID);
      setStatus({
        kind: "ready",
        libraries: status.libraries,
        libraryID,
        items,
        loadingItems: false,
      });
    } catch (err) {
      console.error(err);
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">ZotLit · zotero.sqlite</h1>
        <p className="text-sm text-neutral-600">
          Pick a <code>zotero.sqlite</code> file, then choose a library. The 50
          most-recently-modified items are listed below.
        </p>
      </header>

      <label className="block">
        <span className="sr-only">Choose zotero.sqlite</span>
        <input
          type="file"
          accept=".sqlite,.sqlite3,.db,application/x-sqlite3"
          onChange={onPickFile}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-neutral-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-neutral-700"
        />
      </label>

      {status.kind === "loading-file" && (
        <p className="text-sm text-neutral-600">Loading…</p>
      )}
      {status.kind === "error" && (
        <p className="text-sm text-red-600">Error: {status.message}</p>
      )}
      {status.kind === "ready" && (
        <>
          <label className="block text-sm">
            <span className="mr-2 text-neutral-700">Library:</span>
            <select
              value={status.libraryID ?? ""}
              onChange={onPickLibrary}
              disabled={status.libraries.length === 0}
            >
              {status.libraries.map((lib) => (
                <option key={lib.libraryID} value={lib.libraryID}>
                  {libraryLabel(lib)}
                </option>
              ))}
            </select>
          </label>
          {status.loadingItems ? (
            <p className="text-sm text-neutral-600">Loading items…</p>
          ) : (
            <ItemTable rows={status.items} />
          )}
        </>
      )}
    </main>
  );
}

function libraryLabel(lib: Library): string {
  if (lib.type === "user") return "My Library";
  return lib.name ?? `Group ${lib.groupID ?? lib.libraryID}`;
}

function ItemTable({ rows }: { rows: Item[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-neutral-600">No items found.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-md border border-neutral-200">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-neutral-50 text-neutral-700">
          <tr>
            <th className="px-3 py-2 font-medium">Citekey</th>
            <th className="px-3 py-2 font-medium">Title</th>
            <th className="px-3 py-2 font-medium">Author</th>
            <th className="px-3 py-2 font-medium">Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.itemID} className="border-t border-neutral-100">
              <td className="px-3 py-2 text-neutral-700">
                {row.citekey ?? "—"}
              </td>
              <td className="px-3 py-2">{row.title ?? "—"}</td>
              <td className="px-3 py-2 text-neutral-700">
                {row.creators[0]?.lastName ?? "—"}
              </td>
              <td className="px-3 py-2 text-neutral-700">
                {formatItemDate(row.date) || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
