// What one render is asked for: the draft, the paper it is shown against, and
// whatever a connected host supplies for it.

import type {
  SelectedCitationStyleResponse,
  TemplateDependenciesResponse,
} from "#/bridge/contracts";
import type { ItemSnapshot } from "#/snapshot/index";

import type { CitationPreviewSelection } from "./citation-examples";
import type { AnnotationExample } from "./sample-annotations";

export interface RenderOptions {
  /** Update uses a synthesized note when the host has no existing note. */
  readonly mode?: "create" | "update";
  readonly annotation?: AnnotationExample;
  /** Present only on a Citation Template render, which produces one Citation. */
  readonly citation?: CitationPreviewSelection;
  readonly resources?: RenderResources;
}

export interface RenderRequest extends RenderOptions {
  readonly source: string;
  readonly snapshot: ItemSnapshot;
}

export interface RenderResources {
  readonly dependencies: TemplateDependenciesResponse;
  readonly citationStyle: SelectedCitationStyleResponse;
}
