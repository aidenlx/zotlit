// Citations and the annotation insert for callers outside Effect: the Note Feature's views.
import { Effect } from "effect";
import type { Context } from "effect";

import type { EffectBridge } from "@/lib/effect-bridge";
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
import { prepareAnnotationInsert } from "./insert-annotation";
import type {
  AnnotationInsert,
  AnnotationInsertOptions,
  SingleExcerpt,
} from "./insert-annotation";

/** The services the citations and the annotation insert read. */
export type NoteCitationServices =
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
  /** @see prepareAnnotationInsert */
  prepareAnnotationInsert(
    options: AnnotationInsertOptions,
  ): Promise<AnnotationInsert | null>;
}

/**
 * The citation renders and the annotation insert over `context`, run through
 * `bridge`. A failure throws what the Template threw, as the Template's plain
 * callers saw it.
 */
export function bindNoteCitations(
  bridge: Pick<EffectBridge, "runSync" | "runPromise">,
  context: Context.Context<NoteCitationServices>,
  ports: { singleExcerpt: SingleExcerpt },
): NoteCitations {
  const provide = <A, E>(effect: Effect.Effect<A, E, NoteCitationServices>) =>
    effect.pipe(
      Effect.mapError((error) => plainTemplateError(error)),
      Effect.provideContext(context),
    );
  return {
    renderCitation: (items, variant) =>
      bridge.runSync(provide(renderCitation(items, variant))),
    renderAnnotationCitation: (annotationKey) =>
      bridge.runPromise(provide(renderAnnotationCitation(annotationKey))),
    prepareAnnotationInsert: (options) =>
      bridge.runPromise(
        provide(prepareAnnotationInsert(ports.singleExcerpt, options)),
      ),
  };
}
