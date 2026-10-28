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
import { awaitItem } from "@/services/item-lookup/search-modal";
import type { ItemSearchDeps } from "@/services/item-lookup/search-modal";
import { DEFAULT_LIMIT, ItemLookup } from "@/services/item-lookup/service";
import type { SearchHit } from "@/services/item-lookup/service";

import type { NativeWorkbenchSuggesterRequest } from "./host";
import { sampleTypeLabel } from "./selection";
import { SAMPLE_ITEM_CHOICES } from "./selection-data";

type AnnotationChoice = Pick<AnnotationExample, "id" | "root">;

/** The parent Items among `hits`, as choices. */
const itemChoices = (hits: readonly SearchHit[]): WorkbenchItemChoice[] =>
  hits.flatMap(({ item }) =>
    isChildItemFields(item.fields)
      ? []
      : [
          {
            id: item.indexedKey,
            title: itemSummary(item, item.fields).formatted,
          },
        ],
  );

/** A read of the recent Items, with the services it needs provided. */
export type RecentItems = Effect.Effect<readonly WorkbenchItemChoice[]>;

/** The recently updated parent Items, at most three. */
export const recentItemChoices: Effect.Effect<
  readonly WorkbenchItemChoice[],
  never,
  ItemLookup
> = Effect.flatMap(ItemLookup, (lookup) =>
  lookup.search("", { limit: 3 }),
).pipe(Effect.map((hits) => itemChoices(hits)));

/**
 * Ask the reader for an Item: the Sample Items, the recently updated Items,
 * and a search of the Zotero library.
 *
 * @returns the chosen Item, or `null` when the reader dismisses the chooser.
 */
export const workbenchItemChoice = (
  host: Pick<WorkbenchHost, "suggester">,
  deps: ItemSearchDeps,
  selected?: WorkbenchItemChoice,
): Effect.Effect<WorkbenchItemChoice | null, never, ItemLookup> =>
  Effect.gen(function* () {
    const lookup = yield* ItemLookup;
    const recent = yield* recentItemChoices;
    const choices = [...SAMPLE_ITEM_CHOICES, ...recent];
    const retained =
      selected && !choices.some(({ id }) => id === selected.id)
        ? [selected]
        : [];
    const found = new Map<string, WorkbenchItemChoice>();
    // The chooser's typed searches; the recent Items above stay one-shot.
    const session = yield* lookup.openSession;
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
        session.search(query, { limit: DEFAULT_LIMIT }).pipe(
          Effect.map((hits) =>
            itemChoices(hits).map((choice) => {
              found.set(choice.id, choice);
              return { id: choice.id, label: choice.title ?? choice.id };
            }),
          ),
        ),
    };
    const id = yield* host.suggester(request);
    if (id === "search-zotero") return yield* workbenchItemSearch(deps);
    return (
      [...retained, ...choices].find((item) => item.id === id) ??
      (id ? found.get(id) : null) ??
      null
    );
  }).pipe(Effect.scoped);

/**
 * Ask the reader to search the Zotero library for an Item.
 *
 * @returns the chosen parent Item, or `null` when the reader dismisses the
 *   search or picks a child Item.
 */
export const workbenchItemSearch = (
  deps: ItemSearchDeps,
): Effect.Effect<WorkbenchItemChoice | null> =>
  awaitItem(deps, m.template_data_explorer_pick_placeholder()).pipe(
    Effect.map((hit) => (hit ? (itemChoices([hit])[0] ?? null) : null)),
  );

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
