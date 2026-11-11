import { createFileRoute } from "@tanstack/react-router";

import { LandingPage } from "@/components/landing/landing-page";
import { RepoDatum, loadRepoStats } from "@/components/repo-datum";
import { SiteFooter } from "@/components/site-footer";
import { appDescription, HOME_OG_ALT, pageHead } from "@/lib/seo";
import {
  organizationSchema,
  softwareApplicationSchema,
  websiteSchema,
} from "@/lib/structured-data";
import { m } from "@/paraglide/messages.js";

export const Route = createFileRoute("/_home/")({
  component: Home,
  loader: () => loadRepoStats(),
  head: () =>
    pageHead({
      fullTitle: m.docs_home_document_title(),
      description: appDescription(),
      path: "/",
      card: { type: "home", alt: HOME_OG_ALT() },
      schemas: [websiteSchema, organizationSchema, softwareApplicationSchema],
    }),
});

function Home() {
  const stats = Route.useLoaderData();
  return (
    <LandingPage repo={<RepoDatum stats={stats} />} footer={<SiteFooter />} />
  );
}
