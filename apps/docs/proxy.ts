import { isMarkdownPreferred, rewritePath } from "fumadocs-core/negotiation";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  blogContentRoute,
  blogRoute,
  changelogContentRoute,
  changelogRoute,
  docsContentRoute,
  docsRoute,
} from "@/lib/shared";

// Each section serves its Markdown from a parallel `/llms.mdx/<section>` route.
// `suffix` handles an explicit `.md` path; `accept` handles content negotiation
// when the client prefers Markdown over HTML. The bare section route rewrites
// too: `/docs` resolves to its index page, while `/changelog` and `/blog`
// resolve to a generated Markdown listing of their entries.
const sections = [
  { route: docsRoute, content: docsContentRoute },
  { route: changelogRoute, content: changelogContentRoute },
  { route: blogRoute, content: blogContentRoute },
].map(({ route, content }) => ({
  suffix: rewritePath(`${route}{/*path}.md`, `${content}{/*path}/content.md`),
  accept: rewritePath(`${route}{/*path}`, `${content}{/*path}/content.md`),
}));

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  for (const { suffix } of sections) {
    const result = suffix.rewrite(pathname);
    if (result) return NextResponse.rewrite(new URL(result, request.nextUrl));
  }

  if (isMarkdownPreferred(request)) {
    for (const { accept } of sections) {
      const result = accept.rewrite(pathname);
      if (result) return NextResponse.rewrite(new URL(result, request.nextUrl));
    }
  }

  return NextResponse.next();
}
