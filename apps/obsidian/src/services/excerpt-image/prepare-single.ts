// A captured card's durable image helper, prepared before its one template render.
import type { App } from "obsidian";

import {
  annotationHasCacheImage,
  annotationOpenUri,
  parseIndexedKey,
} from "@zotlit/db";
import type { TemplateLink } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { syntheticFile } from "@/lib/markdown-link";
import type { AnnotationRecord } from "@/services/annotation-repository/service";
import type { Settings } from "@/services/settings/schema";

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
  let used = false;
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
  const render = (embed: boolean, alias?: string, subpath?: string) => {
    used = true;
    if (result.kind === "unavailable") {
      return `${result.reason === "disabled" ? m.excerpt_image_import_disabled() : m.excerpt_image_unavailable()} ${sourceLink}`.trim();
    }
    const link = options.app.fileManager.generateMarkdownLink(
      syntheticFile(result.path),
      options.notePath,
      subpath,
      alias,
    );
    return embed ? `!${link}` : link;
  };
  return {
    helper: image
      ? Object.assign(
          (alias?: string, subpath?: string) => render(false, alias, subpath),
          {
            renderEmbed: (alias?: string, subpath?: string) =>
              render(true, alias, subpath),
          },
        )
      : null,
    summary() {
      const summary = { zotero: 0, unchecked: 0, unavailable: 0 };
      if (!used) return summary;
      if (result.kind === "unavailable") summary.unavailable++;
      else if (result.kind === "saved") {
        if (result.outcome.provenance === "zotero") summary.zotero++;
        else if (result.outcome.freshness !== "checked") summary.unchecked++;
      }
      return summary;
    },
  };
}
