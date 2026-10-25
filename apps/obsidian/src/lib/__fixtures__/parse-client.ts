import { Cause, Effect, Exit } from "effect";
import type {
  ParseClient,
  ParseFailed,
  ParseReply,
  ParseRequest,
  ParseWorkerDied,
} from "@/services/citation-parse/client";
import type { PlainCitationParse } from "@/services/citation-parse/plain";

export const plainTestParseClient = (
  client: Pick<ParseClient, "parse">,
): Pick<PlainCitationParse, "parse"> => ({
  async parse(request, signal) {
    const exit = await Effect.runPromiseExit(client.parse(request), { signal });
    if (Exit.isSuccess(exit)) return exit.value;
    throw Cause.squash(exit.cause);
  },
});

export const effectTestParseClient = (
  parse: (request: ParseRequest, signal: AbortSignal) => Promise<ParseReply>,
): Pick<ParseClient, "parse"> => ({
  parse: (request) => effectTestParse(parse)(request),
});

export const effectTestParse =
  (
    parse: (request: ParseRequest, signal: AbortSignal) => Promise<ParseReply>,
  ) =>
  (request: ParseRequest): Effect.Effect<
    ParseReply,
    ParseWorkerDied | ParseFailed
  > =>
    Effect.tryPromise({
      try: (signal) => parse(request, signal),
      catch: (error) => error as ParseWorkerDied | ParseFailed,
    });
