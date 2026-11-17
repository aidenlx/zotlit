import { SiteFooter } from "@/components/site-footer";
import { pageHead, HOME_OG_ALT } from "@/lib/seo";
import policies from "@/lib/service-policies.json";
import { formatReleaseDate, repoUrl } from "@/lib/shared";
import { m } from "@/paraglide/messages.js";
import { getLocale } from "@/paraglide/runtime.js";

type PolicyKind = "privacy" | "terms";

const effectiveDate = "2026-11-17";
const contact = "aiden.lx@outlook.com";

function getPolicy(kind: PolicyKind) {
  return policies[getLocale() === "zh-CN" ? "zh-CN" : "en"][kind];
}

export function servicePolicyHead(kind: PolicyKind) {
  const { title, description } = getPolicy(kind);
  return pageHead({
    fullTitle: title,
    description,
    path: `/${kind}`,
    card: { type: "home", alt: HOME_OG_ALT() },
  });
}

export function ServicePolicy({ kind }: { kind: PolicyKind }) {
  const { title, sections } = getPolicy(kind);
  const date = formatReleaseDate(effectiveDate, { locale: getLocale() });

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6">
      <article className="pt-12 pb-16">
        <h1 className="font-serif text-4xl font-medium text-balance">
          {title}
        </h1>
        <p className="mt-3 text-sm text-fd-muted-foreground">
          {m.docs_policy_effective_date()}{" "}
          <time dateTime={effectiveDate}>{date}</time>
        </p>
        {sections.map(({ heading, paragraphs }) => (
          <section key={heading} className="mt-8">
            <h2 className="font-serif text-2xl font-medium">{heading}</h2>
            {paragraphs.map((paragraph) => (
              <p
                key={paragraph}
                className="mt-3 leading-relaxed text-fd-muted-foreground"
              >
                {paragraph}
              </p>
            ))}
          </section>
        ))}
        <ul className="mt-8 space-y-2">
          <li>
            <a
              href={`mailto:${contact}`}
              className="underline underline-offset-4"
            >
              {contact}
            </a>
          </li>
          <li>
            {kind === "privacy" ? (
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                className="underline underline-offset-4"
              >
                {m.docs_google_user_data_policy()}
              </a>
            ) : (
              <a
                href={`${repoUrl}/blob/main/LICENSE`}
                className="underline underline-offset-4"
              >
                {m.docs_license()}
              </a>
            )}
          </li>
        </ul>
      </article>
      <SiteFooter />
    </main>
  );
}
