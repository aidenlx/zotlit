// `llms.txt`: the docs page tree as a Markdown index, at the current URL.

import { createFileRoute } from "@tanstack/react-router";

import { getLlmsIndex, plainTextHeaders } from "@/lib/markdown-editions.ts";

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: () => new Response(getLlmsIndex(), { headers: plainTextHeaders }),
    },
  },
});
