// The parse worker holds no note state and returns one scanner result per request.
import { scanNote } from "@/services/citation-index/scan-note";

import type { ParseRequest, ParseReply } from "./client";

export interface WorkerRequest {
  id: number;
  request: ParseRequest;
}

export interface WorkerReply {
  id: number;
  reply: ParseReply;
}

self.addEventListener("message", ({ data }: MessageEvent<WorkerRequest>) => {
  const {
    id,
    request: { path, generation, text },
  } = data;
  self.postMessage({
    id,
    reply: { path, generation, record: scanNote(text) },
  } satisfies WorkerReply);
});
