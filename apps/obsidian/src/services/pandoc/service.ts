// The Pandoc engine as a Managed Binary: the pinned `pandoc.wasm` inside the official release archive.

import { unzipSync } from "fflate";
import type { App } from "obsidian";

import {
  ManagedBinaryService,
  obsidianBinaryPorts,
} from "@/services/managed-binary/service";
import type {
  BinaryStore,
  ManagedBinary,
  ManagedBinaryFailure,
  ManagedBinaryPorts,
  ManagedBinaryStatus,
} from "@/services/managed-binary/service";

import { createCitationEngine } from "./engine";
import type { CitationEngine } from "./engine";
import { PINNED_PANDOC_ENGINE } from "./pinned-engine";
import type { PinnedPandocEngine } from "./pinned-engine";

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

export interface PandocEnginePorts extends Omit<
  ManagedBinaryPorts,
  "openStore"
> {
  /** The device-wide binary cache. */
  store: BinaryStore;
  /** @default PINNED_PANDOC_ENGINE */
  pin?: PinnedPandocEngine;
  /** @default createCitationEngine */
  createEngine?: (binary: Blob) => Promise<CitationEngine>;
}

/** Owns the Pandoc engine binary and the engine instantiated from it. */
export class PandocEngineService extends ManagedBinaryService<CitationEngine> {
  constructor({
    store,
    download,
    consent,
    pin = PANDOC_ENGINE.pin,
    createEngine = PANDOC_ENGINE.createEngine,
  }: PandocEnginePorts) {
    super(
      { ...PANDOC_ENGINE, pin, createEngine },
      { openStore: () => store, download, consent },
    );
  }
}

/** The service over Obsidian's own ports: `requestUrl` and the origin's OPFS. */
export function createPandocEngineService(app: App): PandocEngineService {
  const { openStore, download, consent } = obsidianBinaryPorts(app);
  return new PandocEngineService({
    store: openStore(PANDOC_ENGINE.id),
    download,
    consent,
  });
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
