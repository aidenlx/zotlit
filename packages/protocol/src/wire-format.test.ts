import type * as v from "valibot";
import { describe, expect, it } from "vitest";

import { noteStatusResponseSchema } from "./note-status";
import { notifyEventSchema } from "./notify";
import { SOURCE_ID_HEADER } from "./source-id";
import {
  batchUpdateRequestSchema,
  buildBatchProtocolUrl,
  buildExploreProtocolUrl,
  buildImportAllNotesProtocolUrl,
  buildImportManyProtocolUrl,
  buildImportProtocolUrl,
  buildProtocolUrl,
  buildUpdateAllProtocolUrl,
  exploreProtocolQuerySchema,
  importAllNotesProtocolQuerySchema,
  importManyProtocolQuerySchema,
  importNotesRequestSchema,
  importProtocolQuerySchema,
  protocolActions,
  protocolBatchQuerySchema,
  protocolQuerySchema,
  updateAllProtocolQuerySchema,
} from "./url";
import { PROTOCOL_VERSION } from "./version";

const SOURCE = "a1b2c3d4";
const COLLECTION = "ABCD2345";

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
    examples: protocolActions.map((action) =>
      buildProtocolUrl(action, 42, { sourceId: SOURCE }),
    ),
    params: pipedObjectKeys(protocolQuerySchema),
  };
}

function updateManyUrlWireSurface(): unknown {
  return {
    example: buildBatchProtocolUrl([1, 2, 3], { sourceId: SOURCE }),
    params: pipedObjectKeys(protocolBatchQuerySchema),
  };
}

function exploreUrlWireSurface(): unknown {
  return {
    example: buildExploreProtocolUrl(42, { sourceId: SOURCE }),
    params: pipedObjectKeys(exploreProtocolQuerySchema),
  };
}

function importNoteUrlWireSurface(): unknown {
  return {
    example: buildImportProtocolUrl(42, {
      sourceId: SOURCE,
      mode: "note",
    }),
    params: pipedObjectKeys(importProtocolQuerySchema),
  };
}

function importNotesUrlWireSurface(): unknown {
  return {
    example: buildImportManyProtocolUrl([1, 2, 3], {
      sourceId: SOURCE,
      mode: "child",
    }),
    params: pipedObjectKeys(importManyProtocolQuerySchema),
  };
}

function updateAllUrlWireSurface(): unknown {
  return {
    example: buildUpdateAllProtocolUrl(SOURCE, 7, COLLECTION),
    params: pipedObjectKeys(updateAllProtocolQuerySchema),
  };
}

function importAllNotesUrlWireSurface(): unknown {
  return {
    example: buildImportAllNotesProtocolUrl(SOURCE, 7, COLLECTION),
    params: pipedObjectKeys(importAllNotesProtocolQuerySchema),
  };
}

function literatureNotesWireSurface(): unknown {
  const schema = batchUpdateRequestSchema as ObjectSchema;
  return {
    method: "PUT",
    sourceHeader: SOURCE_ID_HEADER,
    body: Object.keys(schema.entries).sort(),
  };
}

function noteStatusWireSurface(): unknown {
  const schema = noteStatusResponseSchema as ObjectSchema;
  return {
    method: "GET",
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
      updateAllUrl: updateAllUrlWireSurface(),
      importAllNotesUrl: importAllNotesUrlWireSurface(),
      importNoteUrl: importNoteUrlWireSurface(),
      importNotesUrl: importNotesUrlWireSurface(),
      literatureNotes: literatureNotesWireSurface(),
      noteStatus: noteStatusWireSurface(),
      zoteroNotes: zoteroNotesWireSurface(),
      updateManyUrl: updateManyUrlWireSurface(),
    }).toMatchInlineSnapshot(`
      {
        "exploreUrl": {
          "example": "obsidian://zotlit/explore?item=42&source-id=a1b2c3d4",
          "params": [
            "annotation",
            "item",
            "source-id",
          ],
        },
        "importAllNotesUrl": {
          "example": "obsidian://zotlit/import-all-notes?source-id=a1b2c3d4&library=7&collection=ABCD2345",
          "params": [
            "collection",
            "library",
            "source-id",
          ],
        },
        "importNoteUrl": {
          "example": "obsidian://zotlit/import-note?item=42&mode=note&source-id=a1b2c3d4",
          "params": [
            "item",
            "mode",
            "source-id",
          ],
        },
        "importNotesUrl": {
          "example": "obsidian://zotlit/import-notes?items=1%2C2%2C3&mode=child&source-id=a1b2c3d4",
          "params": [
            "items",
            "mode",
            "source-id",
          ],
        },
        "literatureNotes": {
          "body": [
            "items",
            "profile",
            "scope",
          ],
          "method": "PUT",
          "sourceHeader": "X-Zotlit-Source-Id",
        },
        "noteStatus": {
          "body": [
            "keys",
          ],
          "method": "GET",
          "sourceHeader": "X-Zotlit-Source-Id",
        },
        "notify": [
          {
            "event": "db/updated",
            "fields": [
              "dataPath",
              "event",
              "profilePath",
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
        "updateAllUrl": {
          "example": "obsidian://zotlit/update-all?source-id=a1b2c3d4&library=7&collection=ABCD2345",
          "params": [
            "collection",
            "library",
            "source-id",
          ],
        },
        "updateManyUrl": {
          "example": "obsidian://zotlit/update-many?items=1%2C2%2C3&source-id=a1b2c3d4",
          "params": [
            "items",
            "profile",
            "scope",
            "source-id",
          ],
        },
        "url": {
          "actions": [
            "open",
            "update",
          ],
          "examples": [
            "obsidian://zotlit/open?item=42&source-id=a1b2c3d4",
            "obsidian://zotlit/update?item=42&source-id=a1b2c3d4",
          ],
          "params": [
            "item",
            "profile",
            "scope",
            "source-id",
          ],
        },
        "version": 7,
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
