// The Pandoc engine as a Managed Binary: the pinned `pandoc.wasm` inside the official release archive.

import { unzipSync } from "fflate";
import type { App } from "obsidian";

import {
  ManagedBinaryService,
  obsidianBinaryPorts,
} from "@/services/managed-binary/service";
import type {
  ManagedBinary,
  ManagedBinaryFailure,
  ManagedBinaryStatus,
} from "@/services/managed-binary/service";

import { createCitationEngine } from "./engine";
import type { CitationEngine } from "./engine";
import { PINNED_PANDOC_ENGINE } from "./pinned-engine";

/** Name the official WASM asset carries the binary under, inside its archive. */
const BINARY_ENTRY = "pandoc.wasm";

/** Why the engine is unusable, in the terms the fallback surface guides out of. */
export type PandocEngineFailure = ManagedBinaryFailure;

/** Where the Pandoc engine stands. */
export type PandocEngineStatus = ManagedBinaryStatus;

/** The Pandoc engine's declaration; its cache is `zotlit/pandoc-engine`. */
export const PANDOC_ENGINE: ManagedBinary<CitationEngine> = {
  id: "pandoc-engine",
  label: "Pandoc engine",
  logCategory: ["pandoc", "engine"],
  pin: PINNED_PANDOC_ENGINE,
  extract: extractBinary,
  createEngine: createCitationEngine,
};

export type PandocEngineService = ManagedBinaryService<CitationEngine>;

/** The service over Obsidian's own ports: `requestUrl` and the origin's OPFS. */
export function createPandocEngineService(app: App): PandocEngineService {
  return new ManagedBinaryService(PANDOC_ENGINE, obsidianBinaryPorts(app));
}

/** The official asset nests the binary under a release-named directory. */
function extractBinary(
  archive: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const entries = unzipSync(archive, {
    filter: (file) => file.name.split("/").at(-1) === BINARY_ENTRY,
  });
  const [binary] = Object.values(entries);
  if (!binary) {
    throw new Error(`The downloaded asset carries no ${BINARY_ENTRY} entry`);
  }
  return binary;
}
