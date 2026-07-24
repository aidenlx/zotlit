import { notFound } from "next/navigation";

import {
  changelog,
  getChangelogIndexLLMText,
  getChangelogLLMText,
} from "@/lib/source";

export const revalidate = false;

const headers = { "Content-Type": "text/markdown" };

export async function GET(
  _req: Request,
  { params }: RouteContext<"/llms.mdx/changelog/[[...slug]]">,
) {
  const { slug } = await params;
  // The trailing `content.md` segment is dropped; an empty rest is the index.
  const path = slug?.slice(0, -1);

  if (!path || path.length === 0) {
    return new Response(getChangelogIndexLLMText(), { headers });
  }

  const page = changelog.getPage(path);
  if (!page) notFound();

  return new Response(await getChangelogLLMText(page), { headers });
}

export function generateStaticParams() {
  return [
    { slug: ["content.md"] },
    ...changelog.getPages().map((page) => ({
      slug: [...page.slugs, "content.md"],
    })),
  ];
}
