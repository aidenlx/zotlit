// The Template Workbench View's one item row: above the panels, it names the
// data the Fields Panel, the editor and the Preview Panel all read, beside the
// one control that chooses other data.
import { useAtomValue } from "@effect/atom-react";

import { citationExampleLabel, ItemRow } from "@zotlit/workbench/ui";

import { Icon } from "@/components/obsidian/icon";
import * as m from "@/lib/i18n/generated/messages";

import { previewTarget } from "./preview-panel";
import { selectionName } from "./selection";
import { selectionBar } from "./theme";
import type { TemplateWorkbenchView } from "./view";

const { trigger } = selectionBar();

export function ViewItemRow({ view }: { view: TemplateWorkbenchView }) {
  const { workbench, model } = view;
  const kind = useAtomValue(workbench.document.kind);
  const root = useAtomValue(workbench.root);
  const item = useAtomValue(workbench.item);
  const title = useAtomValue(model.title);
  const { example } = useAtomValue(workbench.examples);
  const { citationExample } = useAtomValue(workbench.choices);
  // A partial reads the data its chosen caller reads.
  const { citationSet, annotationMode } = previewTarget(kind, root);
  const name = citationSet
    ? citationExample === null
      ? title
      : citationExampleLabel(m, citationExample)
    : selectionName({
        item: item && { id: item.id, title },
        annotation: example,
        annotationMode,
      });
  return (
    <ItemRow label={name}>
      <button
        type="button"
        className={trigger()}
        onClick={() =>
          annotationMode ? view.startAnnotationChoice() : view.startItemChoice()
        }
      >
        <Icon name="search" />
        <span>
          {annotationMode
            ? m.workbench_choose_annotation()
            : m.workbench_choose_item()}
        </span>
      </button>
    </ItemRow>
  );
}
