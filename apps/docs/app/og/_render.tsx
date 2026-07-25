// Broadsheet OG card: the "Manuscript & Machine" social image shared by every
// page type. A takumi renderer (built once, its Google Fonts registered lazily)
// draws a 1200×630 card — mono-uppercase category, serif headline, sans deck,
// mark + wordmark footer. Styling is Tailwind via takumi's `tw` prop. See
// apps/docs/DESIGN.md and docs/brand.md.
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { type FetchLike, googleFonts } from "takumi-js/helpers";
import { Renderer } from "takumi-js/node";
import { ImageResponse } from "takumi-js/response";

import ZotLitMark from "@/public/logo/zotlit-mark.svg?svgr";

/**
 * `fonts.gstatic.com` drops connections and stalls during CI prerender, so a
 * single failed subset download would abort the whole build. Retry transient
 * network failures, but bail the moment takumi's own timeout signal fires.
 */
const fetchFont: FetchLike = async (input, init) => {
  const attempts = 4;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(input, init);
    } catch (error) {
      if (attempt >= attempts || init?.signal?.aborted) throw error;
      await delay(250 * attempt);
    }
  }
};

/** One renderer whose fonts (Google subsets + the vendored Archivo wordmark face) register once, then reuse. */
let rendererPromise: Promise<Renderer> | undefined;
function getRenderer(): Promise<Renderer> {
  return (rendererPromise ??= (async () => {
    const [subsets, archivo] = await Promise.all([
      googleFonts({
        families: [
          { name: "Gelasio", weight: 500 },
          { name: "Inter", weight: [400, 800] },
          { name: "IBM Plex Mono", weight: [500, 600] },
        ],
        fetch: fetchFont,
        timeout: 30_000,
      }),
      // Same Archivo SemiBold "ZotLit" subset the docs UI ships as --font-brand.
      readFile(
        new URL("../fonts/archivo-semibold-zotlit.woff2", import.meta.url),
      ),
    ]);
    const renderer = new Renderer();
    await Promise.all([
      renderer.registerFont({ name: "Archivo", data: archivo, weight: 600 }),
      ...subsets.map(async (subset) =>
        renderer.registerFont({
          name: subset.name,
          subsetOf: subset.subsetOf,
          weight: subset.weight,
          style: subset.style,
          data: await subset.data(),
        }),
      ),
    ]);
    return renderer;
  })());
}

export interface CardProps {
  /** Small-caps apparatus label — page type or tagline. */
  kind: string;
  title: string;
  description?: string;
  /** Mono footer line — domain, or author/version + date. */
  meta: string;
  /** Landing hero: enlarge the title to a single-word display size. */
  hero?: boolean;
}

function OGCard({ kind, title, description, meta, hero }: CardProps) {
  return (
    <div tw="flex flex-col w-full h-full bg-[#faf7ef] px-[84px] py-[72px] font-['Inter']">
      <div tw="flex flex-col self-start">
        <div tw="font-['IBM_Plex_Mono'] font-semibold text-[30px] tracking-[5px] text-[#E8622C]">
          {kind.toUpperCase()}
        </div>
        <div tw="flex w-full h-[6px] mt-[18px] bg-[#E8622C]" />
      </div>

      <div tw="flex flex-col flex-1 justify-center py-[10px]">
        <div
          tw={`font-['Gelasio'] font-medium ${
            hero ? "text-[150px]" : "text-[84px]"
          } leading-[1.05] tracking-[-1px] text-[#1E3A5F] max-w-[1000px] text-balance`}
        >
          {title}
        </div>
        {description ? (
          <div tw="font-['Inter'] text-[35px] leading-[1.4] text-[#22354d] max-w-[820px] mt-[26px]">
            {description}
          </div>
        ) : null}
      </div>

      <div tw="flex flex-row items-center justify-between border-t-[4px] border-[#1E3A5F] pt-[24px]">
        <div tw="flex flex-row items-center leading-none">
          <ZotLitMark width={28} height={28} />
          <div tw="flex flex-row font-['Archivo'] font-semibold text-[32px] tracking-[-0.32px] ml-[8px]">
            <span tw="text-[#1E3A5F]">Zot</span>
            <span tw="text-[#E8622C]">Lit</span>
          </div>
        </div>
        <div tw="font-['IBM_Plex_Mono'] font-medium text-[24px] text-[#22354d]">
          {meta}
        </div>
      </div>
    </div>
  );
}

export async function ogImage(props: CardProps): Promise<ImageResponse> {
  const renderer = await getRenderer();
  return new ImageResponse(<OGCard {...props} />, {
    width: 1200,
    height: 630,
    format: "webp",
    renderer,
  });
}
