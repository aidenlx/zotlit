// The schema.org objects the pages publish as JSON-LD.

import type {
  Article,
  BlogPosting,
  BreadcrumbList,
  Organization,
  Person,
  SoftwareApplication,
  Thing,
  WebSite,
  WithContext,
} from "schema-dts";

import { appName, baseURL, gitConfig, repoUrl } from "./shared";

const logoUrl = `${baseURL}/logo/zotlit-logo-512.png`;
const obsidianDirectoryUrl = "https://community.obsidian.md/plugins/zotlit";

/** Absolutizes a fumadocs page url (e.g. `/blog/foo`) against `baseURL`. */
export function absoluteUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return path.startsWith("/") ? baseURL + path : `${baseURL}/${path}`;
}

const organization: Organization = {
  "@type": "Organization",
  name: appName,
  url: baseURL,
  logo: logoUrl,
  sameAs: [repoUrl, obsidianDirectoryUrl],
};

export const websiteSchema: WithContext<WebSite> = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: appName,
  url: baseURL,
};

export const organizationSchema: WithContext<Organization> = {
  "@context": "https://schema.org",
  ...organization,
};

export const softwareApplicationSchema: WithContext<SoftwareApplication> = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: appName,
  applicationCategory: "ReferenceApplication",
  operatingSystem: "Windows, macOS, Linux",
  offers: {
    "@type": "Offer",
    price: 0,
    priceCurrency: "USD",
  },
};

function personSchema(author: string): Person {
  return {
    "@type": "Person",
    name: author,
    // Only the maintainer's handle maps to a GitHub profile; other authors are display names.
    ...(author === gitConfig.user && {
      url: `https://github.com/${author}`,
    }),
  };
}

/**
 * @param date publication day in ISO form, as `source.config.ts` normalizes it.
 */
export function blogPostingSchema(input: {
  title: string;
  description?: string;
  author: string;
  date: string;
  url: string;
}): WithContext<BlogPosting> {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: input.title,
    ...(input.description !== undefined && {
      description: input.description,
    }),
    datePublished: input.date,
    author: personSchema(input.author),
    publisher: organization,
    url: absoluteUrl(input.url),
  };
}

/**
 * @param date publication day in ISO form, as `source.config.ts` normalizes it.
 */
export function changelogArticleSchema(input: {
  title?: string;
  version: string;
  date: string;
  url: string;
}): WithContext<Article> {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.title ?? `${appName} v${input.version}`,
    datePublished: input.date,
    publisher: organization,
    url: absoluteUrl(input.url),
  };
}

export interface Crumb {
  name: string;
  url: string;
}

export function breadcrumbListSchema(
  items: Crumb[],
): WithContext<BreadcrumbList> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.url),
    })),
  };
}

/** Serialize for a `<script type="application/ld+json">` body, neutralizing `<` so a `</script>` payload cannot break out of the tag. */
export function serializeJsonLd(schema: WithContext<Thing>): string {
  return JSON.stringify(schema).replaceAll("<", "\\u003c");
}
