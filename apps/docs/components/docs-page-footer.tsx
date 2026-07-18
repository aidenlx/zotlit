"use client";

import { type FooterProps } from "fumadocs-ui/layouts/docs/page/slots/footer";

import Comments from "@/components/comment";
import { Footer } from "@/layouts/docs/page/slots/footer";

export function DocsPageFooter(props: FooterProps) {
  return (
    <Footer {...props}>
      <Comments className="mt-6" />
    </Footer>
  );
}
