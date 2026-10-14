// Which parts of an Annotation Card a host shows. The sidebar shows every
// part; a Query View's Annotations layout takes them from its view's options.
import { createContext } from "react";

export interface CardDisplay {
  /** The comment; an open comment editor or draft shows either way. */
  readonly comment: boolean;
  /** The tag row; an open tag editor or draft shows either way. */
  readonly tags: boolean;
  /** The page label in the page chip. */
  readonly page: boolean;
}

export const CardDisplayContext = createContext<CardDisplay>({
  comment: true,
  tags: true,
  page: true,
});
