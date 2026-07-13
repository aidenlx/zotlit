import type * as v from "valibot";
import { describe, expect, it } from "vitest";

import { notifyEventSchema } from "./notify";
import { SOURCE_ID_HEADER } from "./source-id";
import {
  batchUpdateRequestSchema,
  exploreProtocolQuerySchema,
  importManyProtocolQuerySchema,
  importNotesRequestSchema,
  importProtocolQuerySchema,
  protocolActions,
  protocolQuerySchema,
} from "./url";
import { PROTOCOL_VERSION } from "./version";

type ObjectSchema = v.ObjectSchema<
  v.ObjectEntries,
  v.ErrorMessage<v.ObjectIssue> | undefined
>;
type VariantOption = ObjectSchema & {
  entries: {
    event: { literal: string };
  };
};
type PipedObjectSchema = {
  pipe: readonly [
    ObjectSchema & { entries: Record<string, unknown> },
    ...unknown[],
  ];
};

/** Extract sorted raw-entry keys from a `v.pipe(v.object(…), v.transform(…))` schema. */
function pipedObjectKeys(schema: unknown): string[] {
  return Object.keys((schema as PipedObjectSchema).pipe[0].entries).sort();
}

function notifyWireSurface(): unknown {
  return notifyEventSchema.options.map((option) => {
    const entries = (option as VariantOption).entries;
    return {
      event: entries.event.literal,
      fields: Object.keys(entries).sort(),
    };
  });
}

function protocolUrlWireSurface(): unknown {
  return {
    actions: protocolActions,
    params: pipedObjectKeys(protocolQuerySchema),
  };
}

function exploreUrlWireSurface(): unknown {
  return { params: pipedObjectKeys(exploreProtocolQuerySchema) };
}

function importNoteUrlWireSurface(): unknown {
  return { params: pipedObjectKeys(importProtocolQuerySchema) };
}

function importNotesUrlWireSurface(): unknown {
  return { params: pipedObjectKeys(importManyProtocolQuerySchema) };
}

function literatureNotesWireSurface(): unknown {
  const schema = batchUpdateRequestSchema as ObjectSchema;
  return {
    method: "PUT",
    sourceHeader: SOURCE_ID_HEADER,
    body: Object.keys(schema.entries).sort(),
  };
}

function zoteroNotesWireSurface(): unknown {
  const schema = importNotesRequestSchema as ObjectSchema;
  return {
    method: "PUT",
    sourceHeader: SOURCE_ID_HEADER,
    body: Object.keys(schema.entries).sort(),
  };
}

describe("wire format", () => {
  it("matches the protocol version snapshot", () => {
    expect({
      version: PROTOCOL_VERSION,
      notify: notifyWireSurface(),
      url: protocolUrlWireSurface(),
      exploreUrl: exploreUrlWireSurface(),
      importNoteUrl: importNoteUrlWireSurface(),
      importNotesUrl: importNotesUrlWireSurface(),
      literatureNotes: literatureNotesWireSurface(),
      zoteroNotes: zoteroNotesWireSurface(),
    }).toMatchInlineSnapshot(`
      {
        "exploreUrl": {
          "params": [
            "annotation",
            "item",
            "source-id",
          ],
        },
        "importNoteUrl": {
          "params": [
            "item",
            "mode",
            "source-id",
          ],
        },
        "importNotesUrl": {
          "params": [
            "items",
            "mode",
            "source-id",
          ],
        },
        "literatureNotes": {
          "body": [
            "items",
            "scope",
          ],
          "method": "PUT",
          "sourceHeader": "X-Zotlit-Source-Id",
        },
        "notify": [
          {
            "event": "item/update",
            "fields": [
              "add",
              "dataPath",
              "event",
              "modify",
              "profilePath",
              "trash",
            ],
          },
          {
            "event": "reader/annot-select",
            "fields": [
              "attachmentID",
              "dataPath",
              "event",
              "itemID",
              "profilePath",
              "selected",
            ],
          },
          {
            "event": "reader/active",
            "fields": [
              "attachmentID",
              "dataPath",
              "event",
              "itemID",
              "profilePath",
              "selected",
            ],
          },
        ],
        "url": {
          "actions": [
            "open",
            "update",
          ],
          "params": [
            "item",
            "scope",
            "source-id",
          ],
        },
        "version": 4,
        "zoteroNotes": {
          "body": [
            "items",
            "mode",
          ],
          "method": "PUT",
          "sourceHeader": "X-Zotlit-Source-Id",
        },
      }
    `);
  });
});
