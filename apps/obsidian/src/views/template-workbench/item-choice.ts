// The Item and annotation choosers of the Template Workbench, as Effects on
// the host's suggester: an interrupt closes the chooser, and a dismissal
// answers `null`.
import { Effect } from "effect";

import { isChildItemFields } from "@zotlit/db";
import { SAMPLE_ANNOTATIONS } from "@zotlit/workbench/render";
import type { AnnotationExample } from "@zotlit/workbench/render";
import { annotationOption } from "@zotlit/workbench/ui";
import type { WorkbenchHost, WorkbenchItemChoice } from "@zotlit/workbench/ui";

import * as m from "@/lib/i18n/generated/messages";
import * as workbenchM from "@/lib/i18n/generated/workbench-messages";
import { itemSummary } from "@/lib/item-summary";
import type { ItemLookupHandle } from "@/services/item-lookup/handle";
import type { ItemSearchDeps } from "@/services/item-lookup/search-modal";
import { DEFAULT_LIMIT } from "@/services/item-lookup/service";

import type { NativeWorkbenchSuggesterRequest } from "./host";
import {
  recentItemChoices,
  sampleTypeLabel,
  searchWorkbenchItem,
} from "./selection";
import { SAMPLE_ITEM_CHOICES } from "./selection-data";

type AnnotationChoice = Pick<AnnotationExample, "id" | "root">;

/**
 * Ask the reader for an Item: the Sample Items, the recently updated Items,
 * and a search of the Zotero library.
 *
 * @returns the chosen Item, or `null` when the reader dismisses the chooser.
 */
export const workbenchItemChoice = (
  host: Pick<WorkbenchHost, "suggester">,
  deps: ItemSearchDeps & {
    lookup: Pick<ItemLookupHandle, "search" | "openSession">;
  },
  selected?: WorkbenchItemChoice,
): Effect.Effect<WorkbenchItemChoice | null> =>
  Effect.gen(function* () {
    const recent = yield* Effect.promise(() => recentItemChoices(deps.lookup));
    const choices = [...SAMPLE_ITEM_CHOICES, ...recent];
    const retained =
      selected && !choices.some(({ id }) => id === selected.id)
        ? [selected]
        : [];
    const found = new Map<string, WorkbenchItemChoice>();
    // The chooser's typed searches; the recent Items above stay one-shot.
    const session = yield* Effect.acquireDisposable(
      Effect.sync(() => deps.lookup.openSession()),
    );
    const request: NativeWorkbenchSuggesterRequest = {
      title: m.workbench_choose_item(),
      selected: selected?.id,
      groups: [
        {
          label: "",
          options: [
            {
              id: "search-zotero",
              label: m.workbench_search_zotero(),
              icon: "choose-sample",
            },
          ],
        },
        ...retained.map((item) => ({
          label: m.workbench_selected_label(),
          options: [{ id: item.id, label: item.title ?? item.id }],
        })),
        {
          label: m.workbench_sample_examples(),
          options: SAMPLE_ITEM_CHOICES.map((item) => ({
            id: item.id,
            label: sampleTypeLabel(item.id),
            hint: item.title ?? undefined,
          })),
        },
        {
          label: m.workbench_recently_updated(),
          options: recent.map((item) => ({
            id: item.id,
            label: item.title ?? item.id,
          })),
        },
      ],
      searchItems: (query) =>
        Effect.tryPromise(() =>
          session.search(query, { limit: DEFAULT_LIMIT }),
        ).pipe(
          Effect.map((hits) =>
            hits.flatMap(({ item }) => {
              if (isChildItemFields(item.fields)) return [];
              const choice = {
                id: item.indexedKey,
                title: itemSummary(item, item.fields).formatted,
              };
              found.set(choice.id, choice);
              return [{ id: choice.id, label: choice.title }];
            }),
          ),
        ),
    };
    const id = yield* host.suggester(request);
    if (id === "search-zotero")
      return yield* Effect.promise(() => searchWorkbenchItem(deps));
    return (
      [...retained, ...choices].find((item) => item.id === id) ??
      (id ? found.get(id) : null) ??
      null
    );
  }).pipe(Effect.scoped);

/**
 * Ask the reader for the annotation a preview renders: the selected Item's
 * own annotations and the sample ones.
 *
 * @returns the chosen annotation's id, or `null` when the reader dismisses
 *   the chooser.
 */
export const workbenchAnnotationChoice = (
  host: Pick<WorkbenchHost, "suggester">,
  current: readonly AnnotationChoice[],
  selected: string | null,
): Effect.Effect<string | null> => {
  const options = (examples: readonly AnnotationChoice[]) =>
    examples.map((example) => {
      const option = annotationOption(workbenchM, example);
      return {
        id: option.value,
        label: option.label,
        hint: option.description,
      };
    });
  return host.suggester({
    title: m.workbench_choose_annotation(),
    selected: selected ?? undefined,
    groups: [
      {
        label: m.workbench_annotation_from_item(),
        options: options(current),
        empty: m.workbench_annotation_empty(),
      },
      {
        label: m.workbench_sample_examples(),
        options: options(SAMPLE_ANNOTATIONS),
      },
    ],
  });
};
