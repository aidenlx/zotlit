// Real insertion flow over an in-memory Zotero database and a controllable Template.
import { Effect, Layer } from "effect";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { AnnotationRepository } from "@/services/annotation-repository/service";
import { ExcerptPreparation } from "@/services/excerpt-image/prepare";
import { NoteIndex } from "@/services/note-index/service";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import { Profile } from "@/services/profile/service";
import { defaults } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";
import { Template, templateFailure } from "@/services/template/service";
import { UseLedger } from "@/services/use-ledger/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";
import { layerRcRef } from "@/services/zotero-reads/connection";
import { layerZoteroReads } from "@/services/zotero-reads/service";
import { inProcessClient, memoryOpener } from "@/services/zotero-reads/test-utils";
import type { AnnotationInsertRequest } from "@/services/note-feature/insert-action";
import type { AnnotationInsert } from "@/services/note-feature/insert-annotation";
import { AnnotationNoteActions, layerAnnotationNoteActions } from "@/services/note-feature/view-actions";

const SEED = `
insert into version (schema, version) values ('userdata', 129);
insert into libraries (libraryID, type) values (1, 'user');
insert into settings (setting,key,value) values ('localAPI','serverID','SERVER000001');
insert into items (itemID,itemTypeID,dateAdded,dateModified,libraryID,key) values
  (1,1,'2025-01-01 00:00:00','2025-01-01 00:00:00',1,'RUGIER24'),
  (2,2,'2025-01-01 00:00:00','2025-01-01 00:00:00',1,'RGRPDF24');
insert into itemAttachments (itemID,parentItemID,linkMode,contentType,path)
values (2,1,0,'application/pdf','storage:paper.pdf');
`;

export function annotationAction(
  request: AnnotationInsertRequest,
  render: Effect.Effect<AnnotationInsert, unknown>,
  services: {
    repository?: AnnotationRepository["Service"];
    ledger?: UseLedger["Service"];
    serverID?: string;
  } = {},
) {
  let summary: AnnotationInsert["summary"] = { zotero: 0, unchecked: 0, unavailable: 0 };
  const dependencies = Layer.mergeAll(
    layerZoteroReads(inProcessClient(layerRcRef(memoryOpener(() => SEED.replace("SERVER000001", services.serverID ?? "SERVER000001")).open))),
    Layer.mock(ZoteroPref, { current: Effect.succeed(stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", { dataDir: "/zotero", baseAttachmentPath: null })) }),
    Layer.mock(PluginSettings, { current: Effect.succeed(defaults) }),
    Layer.mock(NoteIndex, { getNotesByItemKey: () => Effect.succeed([]) }),
    Layer.mock(Profile, { profileOf: (file) => Effect.sync(() => profileReader().profileOf(file)) }),
    Layer.mock(ExcerptPreparation, { forCard: () => Effect.succeed({ helper: null, summary: () => summary }) }),
    Layer.mock(Template, {
      renderProfileAnnotation: () => render.pipe(Effect.map((result) => { summary = result.summary; return result.text; }), Effect.mapError((error) => templateFailure(error))),
      renderCitation: () => Effect.succeed(""),
    }),
    services.repository ? Layer.succeed(AnnotationRepository, services.repository) : Layer.mock(AnnotationRepository, {}),
    services.ledger ? Layer.succeed(UseLedger, services.ledger) : Layer.mock(UseLedger, {}),
  );
  return Effect.flatMap(AnnotationNoteActions, (notes) => notes.insert(request)).pipe(
    Effect.provide(layerAnnotationNoteActions.pipe(Layer.provide(dependencies))),
  );
}
