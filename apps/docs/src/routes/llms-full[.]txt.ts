// `llms-full.txt`: every docs page's Markdown edition, concatenated.

import { createFileRoute } from "@tanstack/react-router";

import { getLlmsFullText, plainTextHeaders } from "@/lib/markdown-editions";

export const Route = createFileRoute("/llms-full.txt")({
  server: {
    handlers: {
      GET: async () =>
        new Response(await getLlmsFullText(), { headers: plainTextHeaders }),
    },
  },
});
