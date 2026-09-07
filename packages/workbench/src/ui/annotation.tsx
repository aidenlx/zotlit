// Annotation format editing, example selection, and access to the source section.

import type {
  WorkbenchDocumentController,
  WorkbenchSliceRange,
} from "#/document/index";
import type { AnnotationExample } from "#/render/index";
import { useId } from "react";

import { useDocumentRevision } from "./editor";
import { m } from "./paraglide/messages.js";
import { SampleSuggester } from "./sample-suggester";
import type { SampleOption } from "./sample-suggester";
import { SliceEditor } from "./slice-editor";
import type { SliceEditorProps } from "./slice-editor";
import { useParts } from "./theme";

import { SAMPLE_ANNOTATIONS } from "#/render/index";

export function AnnotationSampleBar({
  id,
  current,
  example,
  onSelect,
}: {
  id?: string;
  current: readonly AnnotationExample[];
  example: AnnotationExample;
  onSelect: (id: string) => void;
}) {
  const part = useParts("annotation");
  return (
    <div {...part("sample-bar")}>
      <SampleSuggester
        id={id}
        title={m.workbench_choose_annotation()}
        label={annotationOption(example).label}
        selected={example.id}
        groups={[
          {
            heading: m.workbench_annotation_from_item(),
            options: current.map(annotationOption),
            empty: m.workbench_annotation_empty(),
          },
          {
            heading: m.workbench_sample_examples(),
            options: SAMPLE_ANNOTATIONS.map(annotationOption),
          },
        ]}
        onSelect={onSelect}
      />
    </div>
  );
}

function annotationOption({ id, root }: AnnotationExample): SampleOption {
  const type = m.workbench_annotation_type({
    type: typeof root.type === "string" ? root.type : "unknown",
  });
  const content = root.text || root.comment;
  const parent = root.parentItem as Record<string, unknown> | null;
  const tags = root.tags as readonly { name: string }[];
  return {
    value: id,
    label:
      typeof content === "string" && content.length > 0
        ? `${type}: ${content}`
        : type,
    description: [
      parent?.title,
      typeof root.pageLabel === "string"
        ? m.workbench_annotation_page({ page: root.pageLabel })
        : null,
      root.text ? root.comment : null,
      ...tags.map(({ name }) => `#${name}`),
    ]
      .filter((value) => typeof value === "string" && value.length > 0)
      .join(" · "),
  };
}

export function AnnotationPane({
  controller,
  problem,
  ...editor
}: Pick<
  SliceEditorProps,
  "controller" | "reveal" | "suggest" | "onSelection"
> & {
  problem: string | null;
}) {
  const part = useParts("annotation");
  const problemId = useId();
  useDocumentRevision(controller);
  if (
    !controller.annotationSection ||
    controller.problems.some(
      ({ code }) => code === "missing-annotation-section",
    )
  ) {
    return <AnnotationSectionBar controller={controller} onGo={() => {}} />;
  }
  return (
    <>
      {problem && (
        <p id={problemId} role="status" {...part("problem")}>
          {problem}
        </p>
      )}
      <div {...part("pane")}>
        <SliceEditor
          {...editor}
          controller={controller}
          slice="annotation"
          label={m.workbench_annotation_label()}
          invalid={problem !== null}
          describedBy={problem ? problemId : undefined}
        />
      </div>
    </>
  );
}

/**
 * The format's place under a note that calls it nowhere: the host puts the
 * call and its loop where the reader left the caret.
 */
export function AnnotationPointer({ onInsert }: { onInsert: () => void }) {
  const part = useParts("annotation");
  return (
    <div {...part("pointer")}>
      <span {...part("heading")}>{m.workbench_annotation_label()}</span>
      <span {...part("hint")}>{m.workbench_annotation_pointer()}</span>
      <button type="button" {...part("primary-action")} onClick={onInsert}>
        {m.workbench_annotation_insert()}
      </button>
    </div>
  );
}

/**
 * Advanced's own bar over the whole file: the section it holds, or the repair
 * action for the document that has none.
 */
export function AnnotationSectionBar({
  controller,
  onGo,
}: {
  controller: WorkbenchDocumentController;
  onGo: (header: WorkbenchSliceRange) => void;
}) {
  const part = useParts("annotation");
  useDocumentRevision(controller);
  const section = controller.annotationSection;
  // A document mid-repair can hold the section ranges it had, so the refusal
  // the parser raises decides which of the two actions the bar offers.
  const missing = controller.problems.some(
    ({ code }) => code === "missing-annotation-section",
  );
  return (
    <div {...part("section-bar")}>
      <span {...part("heading")}>{m.workbench_section_heading()}</span>
      {missing ? (
        <>
          <span {...part("hint")}>{m.workbench_section_missing()}</span>
          <button
            type="button"
            {...part("primary-action")}
            onClick={() => controller.repairAnnotationSection()}
          >
            {m.workbench_section_repair()}
          </button>
        </>
      ) : (
        section && (
          <button
            type="button"
            {...part("section-go")}
            onClick={() => onGo({ ...section.header })}
          >
            {m.workbench_section_go()}
          </button>
        )
      )}
    </div>
  );
}
