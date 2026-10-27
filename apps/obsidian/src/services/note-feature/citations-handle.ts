// Citations for callers outside Effect: the Note Feature's views.
import { Effect } from "effect";
import type { Context } from "effect";

import type { EffectBridge } from "@/lib/effect-bridge";
import type { ExcerptPreparation } from "@/services/excerpt-image/prepare";
import type { NoteIndex } from "@/services/note-index/service";
import type { Profile } from "@/services/profile/service";
import type { PluginSettings } from "@/services/settings/service";
import { plainTemplateError } from "@/services/template/errors";
import type { Template } from "@/services/template/service";
import type { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroReads } from "@/services/zotero-reads/service";

import { renderAnnotationCitation } from "./annotation-citation";
import type { AnnotationCitation } from "./annotation-citation";
import { renderCitation } from "./citation";

/** The services the citations and the annotation insert read. */
export type NoteCitationServices =
  | ExcerptPreparation
  | Template
  | Profile
  | ZoteroReads
  | ZoteroPref
  | PluginSettings
  | NoteIndex;

export interface NoteCitations {
  /** @see renderCitation */
  renderCitation(...args: Parameters<typeof renderCitation>): string | null;
  /** @see renderAnnotationCitation */
  renderAnnotationCitation(annotationKey: string): Promise<AnnotationCitation>;
}

/** Citation renders over `context`, preserving the Template's original failures. */
export function bindNoteCitations(
  bridge: Pick<EffectBridge, "runSync" | "runPromise">,
  context: Context.Context<NoteCitationServices>,
): NoteCitations {
  const plain = <A, E>(effect: Effect.Effect<A, E, NoteCitationServices>) =>
    Effect.mapError(effect, (error) => plainTemplateError(error));
  const provide = <A, E>(effect: Effect.Effect<A, E, NoteCitationServices>) =>
    Effect.provideContext(plain(effect), context);
  return {
    renderCitation: (items, variant) =>
      bridge.runSync(provide(renderCitation(items, variant))),
    renderAnnotationCitation: (annotationKey) =>
      bridge.runPromise(provide(renderAnnotationCitation(annotationKey))),
  };
}
