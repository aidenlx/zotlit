// The Annotation Suggester's search: ZotLit Query over the Zotero database,
// so it answers with Zotero closed. The query text reads in the Library
// View's search grammar, with `color:` and `paper:` beside `tag:`.
import { getLogger } from "@/lib/log";
import type {
  QueryViewRow,
  QueryViewValue,
} from "@/services/item-query/query-view";
import type { QueryService } from "@/services/item-query/service";
import { visibleText } from "@/services/item-query/visible-text";
import { searchTokens } from "@/views/library/search";

const logger = getLogger(["views", "annotation-suggest"]);

/** The token names the Annotation Suggester reads beside its words. */
export const ANNOTATION_SEARCH_TOKENS = ["tag", "color", "paper"] as const;

/**
 * The most papers one search reads: the ones with the latest activity whose
 * annotations match. Each gives at most the suggester's limit.
 */
const PAPER_LIMIT = 20;

/** One annotation the search found, with what its suggestion shows. */
export interface AnnotationHit {
  /** Indexed Key of the annotation. */
  key: string;
  /** Indexed Key of the Attachment it hangs from. */
  attachmentKey: string;
  /** Indexed Key of the paper, the Attachment's parent Item. */
  itemKey: string;
  type: string | null;
  text: string | null;
  comment: string | null;
  color: string | null;
  pageLabel: string | null;
  /** The paper's title. */
  title: string | null;
  citationKey: string | null;
}

const FIELDS = {
  type: "type",
  text: "text",
  comment: "comment",
  color: "color",
  pageLabel: "pageLabel",
  title: "item.title",
  citationKey: "item.citationKey",
} as const;

const quote = (value: string) => JSON.stringify(value);

/**
 * The filter an annotation must pass, its fields read through `field`: on
 * the annotations dataset the field itself, inside an Item's
 * `annotations.filter(...)` the field of `value`. Every word must be in the
 * visible text of the text or the comment, in any case; every tag must be on it; one of the
 * colors, a palette name or a `#` hex, must be its color.
 */
function annotationConditions(
  terms: { words: string; tag: readonly string[]; color: readonly string[] },
  field: (name: string) => string,
): string[] {
  const conditions = terms.words
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map(
      (word) =>
        `(${visibleText(field("text"))}.lower().contains(${quote(word)}) || ${visibleText(field("comment"))}.lower().contains(${quote(word)}))`,
    );
  for (const tag of terms.tag)
    conditions.push(`${field("tags")}.contains(${quote(tag)})`);
  if (terms.color.length > 0)
    conditions.push(
      `(${terms.color
        .map((color) =>
          color.startsWith("#")
            ? `${field("color")}.lower() == ${quote(color.toLowerCase())}`
            : `${field("colorName")} == ${quote(color.toLowerCase())}`,
        )
        .join(" || ")})`,
    );
  return conditions;
}

const and = (conditions: readonly string[]) =>
  conditions.length === 0 ? undefined : conditions.join(" && ");

const text = (value: QueryViewValue | undefined): string | null =>
  typeof value === "string" ? value : null;

function toHit(row: QueryViewRow): AnnotationHit {
  const read = (name: keyof typeof FIELDS) => text(row.values[FIELDS[name]]);
  return {
    key: row.indexedKey,
    attachmentKey: row.attachmentIndexedKey!,
    itemKey: row.itemIndexedKey!,
    type: read("type"),
    text: read("text"),
    comment: read("comment"),
    color: read("color"),
    pageLabel: read("pageLabel"),
    title: read("title"),
    citationKey: read("citationKey"),
  };
}

/**
 * The annotations in Library Scope that `query` finds, the papers with the
 * latest activity first, as the Library View's Recent sorts them; a paper's
 * annotations in Zotero's reading order. At most `limit`.
 *
 * Two queries: the papers with a matching annotation, sorted by Last
 * Activity, which only Item Query offers; then their matching annotations.
 *
 * @returns `null` when the signal aborts it or ZotLit Query cannot answer.
 */
export async function searchAnnotations(
  service: Pick<QueryService, "run">,
  query: string,
  { signal, limit }: { signal: AbortSignal; limit: number },
): Promise<AnnotationHit[] | null> {
  if (signal.aborted) return null;
  const { words, tokens } = searchTokens(query, ANNOTATION_SEARCH_TOKENS);
  const terms = { words, ...tokens };
  const papers = await service.run(
    {
      from: "items",
      filter: and([
        `annotations.filter(${and(annotationConditions(terms, (name) => `value.${name}`)) ?? "true"}).length > 0`,
        ...tokens.paper.map((paper) => {
          const lower = quote(paper.toLowerCase());
          return `(title.lower().contains(${lower}) || citationKey.lower() == ${lower})`;
        }),
      ]),
      fields: [],
      sort: [{ field: "lastActivity", direction: "desc" }],
      limit: PAPER_LIMIT,
    },
    signal,
  );
  if (papers.kind !== "result") {
    if (papers.kind === "failed")
      logger.warn("Annotation search failed", {
        stage: "papers",
        diagnostic: papers.diagnostic,
      });
    return null;
  }
  const rank = new Map(
    (papers.result.rows ?? []).map((row, index) => [row.indexedKey, index]),
  );
  logger.trace("Annotation search papers", { papers: rank.size });
  if (rank.size === 0) return [];
  const annotations = await service.run(
    {
      from: "annotations",
      filter: and([
        `[${[...rank.keys()].map(quote).join(", ")}].contains(item.indexedKey)`,
        ...annotationConditions(terms, (name) => name),
      ]),
      fields: Object.values(FIELDS),
      sort: [
        { field: "attachment.indexedKey", direction: "asc" },
        { field: "sortIndex", direction: "asc" },
      ],
      group: "item.indexedKey",
      limit,
    },
    signal,
  );
  if (annotations.kind !== "result") {
    if (annotations.kind === "failed")
      logger.warn("Annotation search failed", {
        stage: "annotations",
        diagnostic: annotations.diagnostic,
      });
    return null;
  }
  return (annotations.result.groups ?? [])
    .toSorted(
      (a, b) =>
        (rank.get(String(a.value)) ?? rank.size) -
        (rank.get(String(b.value)) ?? rank.size),
    )
    .flatMap((group) => group.rows.map(toHit))
    .slice(0, limit);
}
