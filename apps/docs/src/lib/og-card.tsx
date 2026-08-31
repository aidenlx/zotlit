// Broadsheet OG card: the "Manuscript & Machine" social image shared by every
// page type. A takumi renderer (built once, its Google Fonts registered lazily)
// draws a 1200×630 card — mono-uppercase category, serif headline, sans deck,
// mark + wordmark footer. Styling is Tailwind via takumi's `tw` prop.
//
// Node-only: the native renderer runs during `vite build`, which emits every
// card into the client output, so the Worker never renders an image.
//
// @see docs/brand.md

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { render } from "takumi-js";
import { googleFonts } from "takumi-js/helpers";
import type { FetchLike } from "takumi-js/helpers";
import { Renderer } from "takumi-js/node";

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
async function createRenderer(packageRoot: string): Promise<Renderer> {
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
    readFile(resolve(packageRoot, "src/fonts/archivo-semibold-zotlit.woff2")),
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

/** The brand mark, inlined so the card needs no SVG loader. @see assets/logo/ */
function ZotLitMark() {
  return (
    <svg viewBox="0 0 24 24" width={28} height={28}>
      <path
        d="M4.82 3.5 H17 V7 L9.81 16.5 H20.5 V20 H4.92 A0.92 0.92 0 0 1 4 19.08 V17.14 A1.9 1.9 0 0 1 4.38 15.99 L11.19 7 H4.25 A0.25 0.25 0 0 1 4 6.75 V4.32 A0.82 0.82 0 0 1 4.82 3.5 Z"
        fill="#1E3A5F"
      />
      <path d="M17 3.5 H20.5 V16.5 L18.75 14.75 L17 16.5 Z" fill="#E8622C" />
    </svg>
  );
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
          <ZotLitMark />
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

/** WebP bytes of the OG card, exactly as the `/og/…/image.webp` asset serves them. */
export type OgCardRenderer = (props: CardProps) => Promise<Uint8Array>;

/**
 * A renderer bound to one font set, reused across every card of a build.
 * @param packageRoot the app's own root, which `vite.config.ts` owns.
 */
export function createOgCardRenderer(packageRoot: string): OgCardRenderer {
  let renderer: Promise<Renderer> | undefined;

  return async (props) => {
    renderer ??= createRenderer(packageRoot);
    return render(<OGCard {...props} />, {
      renderer: await renderer,
      width: 1200,
      height: 630,
      format: "webp",
    });
  };
}
