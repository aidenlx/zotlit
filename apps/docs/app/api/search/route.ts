import { createFromSource } from "fumadocs-core/search/server";

import { source } from "@/lib/source";

/** @see https://docs.orama.com/docs/orama-js/supported-languages */
export const { GET } = createFromSource(source, {
  language: "english",
});
