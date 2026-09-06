// Annotation format editing, example selection, and access to the source section.

import type {
  WorkbenchDocumentController,
  WorkbenchSliceRange,
} from "@zotlit/workbench/document";
import { SAMPLE_ANNOTATIONS } from "@zotlit/workbench/render";
import type { AnnotationExample } from "@zotlit/workbench/render";

import { Button } from "@/components/ui/button";
import { m } from "@/paraglide/messages.js";

import { SampleSuggester } from "./sample-suggester";
import type { SampleOption } from "./sample-suggester";
import { SliceEditor } from "./slice-editor";
import type { SliceEditorProps } from "./slice-editor";

export function AnnotationSampleBar({
  id = "workbench-annotation-sample",
  current,
  example,
  onSelect,
}: {
  id?: string;
  current: readonly AnnotationExample[];
  example: AnnotationExample;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="mb-2 flex shrink-0 items-center gap-2">
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
        <p
          id="annotation-problem"
          role="status"
          className="mb-2 border-s-2 border-fd-primary bg-fd-accent/40 px-3 py-2 text-sm"
        >
          {problem}
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col rounded-md border border-fd-border bg-fd-card">
        <SliceEditor
          {...editor}
          controller={controller}
          slice="annotation"
          label={m.workbench_annotation_label()}
          invalid={problem !== null}
          describedBy={problem ? "annotation-problem" : undefined}
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
  return (
    <div className="mt-3 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-fd-border bg-fd-card px-3 py-2">
      <span className="text-sm font-medium">
        {m.workbench_annotation_label()}
      </span>
      <span className="text-sm text-fd-muted-foreground">
        {m.workbench_annotation_pointer()}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={onInsert}
        className="ms-auto"
      >
        {m.workbench_annotation_insert()}
      </Button>
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
  const section = controller.annotationSection;
  // A document mid-repair can hold the section ranges it had, so the refusal
  // the parser raises decides which of the two actions the bar offers.
  const missing = controller.problems.some(
    ({ code }) => code === "missing-annotation-section",
  );
  return (
    <div className="mb-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-fd-border bg-fd-card px-3 py-2">
      <span className="text-sm font-medium">
        {m.workbench_section_heading()}
      </span>
      {missing ? (
        <>
          <span className="text-sm text-fd-muted-foreground">
            {m.workbench_section_missing()}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => controller.repairAnnotationSection()}
            className="ml-auto"
          >
            {m.workbench_section_repair()}
          </Button>
        </>
      ) : (
        section && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onGo({ ...section.header })}
            className="ml-auto"
          >
            {m.workbench_section_go()}
          </Button>
        )
      )}
    </div>
  );
}
