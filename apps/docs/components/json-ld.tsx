import type { Thing, WithContext } from "schema-dts";

import { serializeJsonLd } from "@/lib/structured-data";

/** Renders a JSON-LD script tag from a typed schema object. */
export function JsonLd({ schema }: { schema: WithContext<Thing> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(schema) }}
    />
  );
}
