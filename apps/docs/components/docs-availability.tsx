import Link from "fumadocs-core/link";

import type { DocsAvailability as Availability } from "@/lib/docs-availability";

function Version({
  version,
  changelogUrl,
}: {
  version: string;
  changelogUrl?: string;
}) {
  if (!changelogUrl) return version;
  return (
    <Link
      className="underline decoration-fd-border underline-offset-4"
      href={changelogUrl}
    >
      {version}
    </Link>
  );
}

export function DocsAvailability({
  availability,
  changelogUrl,
}: {
  availability: Availability;
  changelogUrl?: string;
}) {
  const version = (
    <Version version={availability.introduced} changelogUrl={changelogUrl} />
  );

  return (
    <p className="my-0 flex flex-wrap items-baseline gap-x-2 font-mono text-[0.72rem] text-fd-muted-foreground">
      <span className="font-semibold tracking-widest text-fd-primary uppercase">
        Available since
      </span>
      <span>ZotLit {version}</span>
    </p>
  );
}
