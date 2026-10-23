// The parse worker holds no note state and returns one scanner result per request.
import { scanNote } from "@/services/citation-index/scan-note";

import type { ParseRequest, ParseReply } from "./client";

export interface WorkerRequest {
  id: number;
  request: ParseRequest;
}

export type WorkerReply =
  | { id: number; reply: ParseReply }
  | { id: number; error: string };

self.addEventListener("message", ({ data }: MessageEvent<WorkerRequest>) => {
  const {
    id,
    request: { path, generation, text },
  } = data;
  let result: WorkerReply;
  try {
    result = { id, reply: { path, generation, record: scanNote(text) } };
  } catch (error) {
    result = { id, error: String(error) };
  }
  self.postMessage(result);
});
