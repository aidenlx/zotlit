// Hono app for the companion-facing HTTP listener: gates + routes, no server lifecycle.
import { vValidator } from "@hono/valibot-validator";
import type { Context, Next } from "hono";
import { Hono } from "hono/tiny";

import {
  batchUpdateRequestSchema,
  importNotesRequestSchema,
  notifyEventSchema,
  PROTOCOL_VERSION_HEADER,
  SOURCE_ID_HEADER,
} from "@zotlit/protocol";
import type {
  ImportMode,
  NotifyEvent,
  NoteStatusResponse,
  UpdateScope,
} from "@zotlit/protocol";

import { getLogger } from "@/lib/log";
import { yieldToMain } from "@/lib/yield-to-main";
import { rejectIncompatibleProtocol } from "@/services/protocol/compat";

const logger = getLogger("live-update");

/** Sender's raw profile/data dirs, present only when its debug logging is on. */
function senderDirs(event: NotifyEvent): Record<string, string> {
  const out: Record<string, string> = {};
  if (event.profilePath !== undefined) out.profilePath = event.profilePath;
  if (event.dataPath !== undefined) out.dataPath = event.dataPath;
  return out;
}

/** The slice of {@link NoteIndex} the note-status query route reads. */
export interface NoteStatusSource {
  whenIndexed(): Promise<void>;
  getIndexedItemKeys(): string[];
}

export interface LiveUpdateAppDeps {
  sourceId(): string | null;
  noteIndex: NoteStatusSource;
  onNotify(event: NotifyEvent): void;
  onUpdateMany(event: { items: number[]; scope: UpdateScope }): void;
  onImportNotes(event: { items: number[]; mode: ImportMode }): void;
}

export function createLiveUpdateApp(deps: LiveUpdateAppDeps): Hono {
  const app = new Hono();
  app
    /** Reject a request whose `X-Zotlit-Protocol-Version` header is incompatible. */
    .use(async (c: Context, next: Next): Promise<Response | void> => {
      if (
        rejectIncompatibleProtocol(
          c.req.header(PROTOCOL_VERSION_HEADER),
          logger,
          { transport: "http" },
        )
      ) {
        return c.body(null, 426);
      }
      await next();
    })
    /** Discard a request whose `X-Zotlit-Source-Id` isn't the configured install. */
    .use(async (c: Context, next: Next): Promise<Response | void> => {
      const expected = deps.sourceId();
      const received = c.req.header(SOURCE_ID_HEADER);
      if (expected === null || received !== expected) {
        logger.warn("Discarded request: source id mismatch", {
          expected,
          received,
        });
        return c.body(null, 204);
      }
      await next();
    })
    .post(
      "/notify",
      vValidator("json", notifyEventSchema, (result, c) => {
        if (result.success) return;
        logger.warn("Received notify event failed validation", {
          issues: result.issues,
        });
        return c.json(result, 400);
      }),
      (c) => {
        const event = c.req.valid("json");
        logger.debug("Received notify event", {
          event: event.event,
          ...senderDirs(event),
        });
        deps.onNotify(event);
        return c.body(null, 204);
      },
    )
    // Fire-and-forget: the batch modal is interactive and long-running, so ack
    // 204 immediately and let the subscriber drive it; never await the batch.
    .put(
      "/literature-notes",
      vValidator("json", batchUpdateRequestSchema, (result, c) => {
        if (result.success) return;
        logger.warn("Received literature-notes update failed validation", {
          issues: result.issues,
        });
        return c.json(result, 400);
      }),
      (c) => {
        const body = c.req.valid("json");
        logger.debug("Received literature-notes update", {
          items: body.items.length,
          scope: body.scope,
        });
        // Decouple from the event loop to avoid the handler from blocking
        // the main thread and let the response finish first.
        void yieldToMain().then(() => {
          deps.onUpdateMany({ items: body.items, scope: body.scope });
        });
        return c.body(null, 204);
      },
    )
    .put(
      "/zotero-notes",
      vValidator("json", importNotesRequestSchema, (result, c) => {
        if (result.success) return;
        logger.warn("Received zotero-notes import failed validation", {
          issues: result.issues,
        });
        return c.json(result, 400);
      }),
      (c) => {
        const body = c.req.valid("json");
        logger.debug("Received zotero-notes import", {
          items: body.items.length,
          mode: body.mode,
        });
        void yieldToMain().then(() => {
          deps.onImportNotes({ items: body.items, mode: body.mode });
        });
        return c.body(null, 204);
      },
    )
    /**
     * Answers the companion's note-status query from the live Note Index's
     * Literature-Note key set. Awaits the index's first full scan so a
     * startup-time query never reports an empty vault.
     */
    .get("/literature-notes", async (c) => {
      await deps.noteIndex.whenIndexed();
      const keys = deps.noteIndex.getIndexedItemKeys();
      logger.debug("Answered literature-notes status query", {
        keys: keys.length,
      });
      return c.json({ keys } satisfies NoteStatusResponse);
    });

  return app;
}
