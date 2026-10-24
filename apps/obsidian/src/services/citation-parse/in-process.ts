import { scanNote } from "@/services/citation-index/scan-note";

import type { ParseClient } from "./client";

export const inProcessParseClient: ParseClient = {
  parse: async ({ path, generation, text }, signal) => {
    signal.throwIfAborted();
    return { path, generation, record: scanNote(text) };
  },
};
