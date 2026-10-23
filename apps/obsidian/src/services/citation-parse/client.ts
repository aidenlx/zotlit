// The stateless parse boundary shared by the worker and its in-process twin.
import type { NoteScanRecord } from "@/services/citation-index/scan-note";

export interface ParseRequest {
  path: string;
  generation: number;
  text: string;
}

export interface ParseReply {
  path: string;
  generation: number;
  record: NoteScanRecord;
}

export interface ParseClient {
  parse(request: ParseRequest, signal: AbortSignal): Promise<ParseReply>;
}
