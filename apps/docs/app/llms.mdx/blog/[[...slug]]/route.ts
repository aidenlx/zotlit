import { notFound } from "next/navigation";

import { blog, getBlogIndexLLMText, getBlogLLMText } from "@/lib/source";

export const revalidate = false;

const headers = { "Content-Type": "text/markdown" };

export async function GET(
  _req: Request,
  { params }: RouteContext<"/llms.mdx/blog/[[...slug]]">,
) {
  const { slug } = await params;
  // The trailing `content.md` segment is dropped; an empty rest is the index.
  const path = slug?.slice(0, -1);

  if (!path || path.length === 0) {
    return new Response(getBlogIndexLLMText(), { headers });
  }

  const page = blog.getPage(path);
  if (!page) notFound();

  return new Response(await getBlogLLMText(page), { headers });
}

export function generateStaticParams() {
  return [
    { slug: ["content.md"] },
    ...blog.getPages().map((page) => ({
      slug: [...page.slugs, "content.md"],
    })),
  ];
}
