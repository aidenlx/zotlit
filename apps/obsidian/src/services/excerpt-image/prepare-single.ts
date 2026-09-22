// A captured card's durable image helper, prepared before its one template render.
import type { App } from "obsidian";

import {
  annotationHasCacheImage,
  annotationOpenUri,
  parseIndexedKey,
} from "@zotlit/db";
import type { TemplateLink } from "@zotlit/db";

import { getLogger } from "@/lib/log";
import type { AnnotationRecord } from "@/services/annotation-repository/service";
import type { Settings } from "@/services/settings/schema";

import { createExcerptLink, summarizeExcerpts } from "./helper";
import { materializeExcerpt } from "./materialize";
import type { MaterializedExcerpt } from "./materialize";
import type { ExcerptSummary } from "./prepare";
import type { ExcerptImageService, ExcerptRequest } from "./service";

export async function prepareSingleExcerpt(options: {
  app: App;
  annotation: AnnotationRecord;
  request: ExcerptRequest | null;
  resolver: Pick<ExcerptImageService, "resolve">;
  settings: Readonly<Settings>;
  notePath: string;
  sourceLink: string | null;
  signal: AbortSignal;
  valid: () => boolean;
}): Promise<{ helper: TemplateLink | null; summary(): ExcerptSummary }> {
  const { annotation, request, signal, settings } = options;
  let result: MaterializedExcerpt = {
    kind: "unavailable",
    reason: settings["attachment.import"] ? "source" : "disabled",
  };
  const image = annotationHasCacheImage(annotation.type);
  if (image && request && settings["attachment.import"] && options.valid()) {
    try {
      const outcome = await options.resolver.resolve(request, signal);
      signal.throwIfAborted();
      if (options.valid())
        result = await materializeExcerpt({ ...options, request, outcome });
    } catch (error) {
      signal.throwIfAborted();
      getLogger("excerpt-prepare").debug(
        "Captured excerpt preparation failed",
        { annotationKey: annotation.key, error },
      );
    }
  }
  const key = parseIndexedKey(annotation.key);
  const parent = parseIndexedKey(annotation.parentKey);
  const sourceLink =
    options.sourceLink ??
    (key && parent
      ? `[Zotero](${annotationOpenUri({ attachmentKey: parent.key, annotationKey: key.key, groupID: key.groupID, pageLabel: annotation.pageLabel })})`
      : "");
  const state = { used: false, result, sourceLink };
  return {
    helper: image
      ? createExcerptLink(options.app, options.notePath, state)
      : null,
    summary() {
      return summarizeExcerpts([state]);
    },
  };
}
