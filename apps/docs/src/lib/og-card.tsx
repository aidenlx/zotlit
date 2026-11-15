// Broadsheet OG card: the "Journal" social image shared by every
// page type. A takumi renderer (built once, its Google Fonts registered lazily)
// draws a 1200×630 card — mono-uppercase category, serif headline, sans deck,
// mark + wordmark footer. Styling is Tailwind via takumi's `tw` prop.
//
// Node-only: the native renderer runs during `vite build`, which emits every
// card into the client output, so the Worker never renders an image.
//
// @see docs/brand.md

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { render } from "takumi-js";
import { googleFonts, subsetFonts } from "takumi-js/helpers";
import type { FetchLike, FontSubset } from "takumi-js/helpers";
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

/**
 * The Simplified Chinese faces a Chinese card falls back to after each Latin
 * face, as the zh-CN site does: LXGW WenKai GB Screen under the Gelasio
 * title, Noto Sans SC under the sans and mono lines. Both are SIL OFL 1.1.
 */
const CJK_SERIF = "LXGW WenKai GB Screen";
const CJK_SANS = "Noto Sans SC";

/**
 * WenKai's unicode-range slices, read from the package stylesheet that the
 * site links, each loading its bytes from disk on demand. Google Fonts
 * carries no GB edition of WenKai.
 */
async function wenkaiSubsets(packageRoot: string): Promise<FontSubset[]> {
  const wenkaiCss = createRequire(resolve(packageRoot, "package.json")).resolve(
    "lxgw-wenkai-screen-web/lxgwwenkaigbscreen/result.css",
  );
  const css = await readFile(wenkaiCss, "utf8");
  return css
    .split("@font-face")
    .slice(1)
    .flatMap((face) => {
      const file = /url\(["']?\.\/([^"')]+)/.exec(face)?.[1];
      const range = /unicode-range:([^;}]+)/.exec(face)?.[1];
      if (!file || !range) return [];
      const ranges = range.split(",").map((part): [number, number] => {
        const [start = "", end = start] = part
          .trim()
          .replace(/^U\+/i, "")
          .split("-");
        return [Number.parseInt(start, 16), Number.parseInt(end, 16)];
      });
      const name = `${CJK_SERIF} ${file}`;
      return [
        {
          name,
          subsetOf: CJK_SERIF,
          key: `${name}:400:normal`,
          weight: 400,
          style: "normal",
          ranges,
          data: async () => {
            const bytes = await readFile(resolve(dirname(wenkaiCss), file));
            return bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            );
          },
        },
      ];
    });
}

/**
 * A CJK family is a hundred or more unicode-range subsets, so these load as a
 * list and each card reads only the subsets its own text needs.
 */
async function cjkSubsets(packageRoot: string): Promise<FontSubset[]> {
  const [serif, sans] = await Promise.all([
    wenkaiSubsets(packageRoot),
    googleFonts({
      families: [{ name: CJK_SANS, weight: [400, 500, 600] }],
      fetch: fetchFont,
      timeout: 30_000,
    }),
  ]);
  return [...serif, ...sans];
}

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

const cjkGlyph = /[\p{Script=Han}　-〿＀-￯]/u;

/** A string's width in Latin glyphs: a CJK glyph or full-width mark counts two. */
function textWidth(text: string): number {
  let width = 0;
  for (const glyph of text) width += cjkGlyph.test(glyph) ? 2 : 1;
  return width;
}

/**
 * The title's type size. A title past about 44 Latin glyphs of width wraps to
 * three lines at the standard size, which pushes a four-line description off
 * the card, so it steps down to keep two.
 */
function titleSize(title: string, hero?: boolean) {
  if (hero) return "text-[150px]";
  // A Chinese title sits on a taller line and over a longer description, so it
  // steps down sooner, and once more when it would still take three lines.
  const width = textWidth(title);
  if (cjkGlyph.test(title)) {
    if (width > 52) return "text-[64px]";
    return width > 36 ? "text-[72px]" : "text-[84px]";
  }
  return width > 44 ? "text-[72px]" : "text-[84px]";
}

/** Chinese lines need open leading and no negative tracking; Latin keeps the tight display setting. */
function titleSetting(title: string) {
  return cjkGlyph.test(title)
    ? "leading-[1.2] tracking-[0px]"
    : "leading-[1.05] tracking-[-1px]";
}

/** A Chinese description wraps to more lines at the Latin measure, so it runs wider and a size smaller. */
function descriptionSetting(description: string) {
  return cjkGlyph.test(description)
    ? "text-[32px] leading-[1.45] max-w-[1000px]"
    : "text-[35px] leading-[1.4] max-w-[820px]";
}

/** Spaced capitals suit Latin; a Chinese label keeps a light tracking. */
function kindTracking(kind: string) {
  return cjkGlyph.test(kind) ? "tracking-[1px]" : "tracking-[5px]";
}

function OGCard({ kind, title, description, meta, hero }: CardProps) {
  return (
    <div tw="flex flex-col w-full h-full bg-[#f7f5f0] px-[84px] py-[72px] font-['Inter','Noto_Sans_SC']">
      <div tw="flex flex-col self-start">
        <div
          tw={`font-['IBM_Plex_Mono','Noto_Sans_SC'] font-semibold text-[30px] ${kindTracking(kind)} text-[#b9461a]`}
        >
          {kind.toUpperCase()}
        </div>
        <div tw="flex w-full h-[6px] mt-[18px] bg-[#E8622C]" />
      </div>

      <div tw="flex flex-col flex-1 justify-center py-[10px]">
        <div
          tw={`font-['Gelasio','LXGW_WenKai_GB_Screen'] font-medium ${titleSize(title, hero)} ${titleSetting(title)} text-[#1b2029] max-w-[1000px] text-balance`}
        >
          {title}
        </div>
        {description ? (
          <div
            tw={`font-['Inter','Noto_Sans_SC'] ${descriptionSetting(description)} text-[#1b2029] mt-[26px]`}
          >
            {description}
          </div>
        ) : null}
      </div>

      <div tw="flex flex-row items-center justify-between border-t-[4px] border-[#1b2029] pt-[24px]">
        <div tw="flex flex-row items-center leading-none">
          <ZotLitMark />
          <div tw="flex flex-row font-['Archivo'] font-semibold text-[32px] tracking-[-0.32px] ml-[8px]">
            <span tw="text-[#1E3A5F]">Zot</span>
            <span tw="text-[#E8622C]">Lit</span>
          </div>
        </div>
        <div tw="font-['IBM_Plex_Mono','Noto_Sans_SC'] font-medium text-[24px] text-[#1b2029]">
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
  let cjk: Promise<FontSubset[]> | undefined;
  /** Each CJK subset registers once, however many cards need it at the same time. */
  const registered = new Map<string, Promise<unknown>>();

  return async (props) => {
    renderer ??= createRenderer(packageRoot);
    const ready = await renderer;
    const text = [
      props.kind.toUpperCase(),
      props.title,
      props.description,
      props.meta,
    ].join(" ");
    if (cjkGlyph.test(text)) {
      cjk ??= cjkSubsets(packageRoot);
      for (const subset of subsetFonts({ fonts: await cjk, source: text })) {
        if (!registered.has(subset.key))
          registered.set(
            subset.key,
            subset.data().then((data) =>
              ready.registerFont({
                name: subset.name,
                subsetOf: subset.subsetOf,
                weight: subset.weight,
                style: subset.style,
                data,
              }),
            ),
          );
      }
      await Promise.all(registered.values());
    }
    return render(<OGCard {...props} />, {
      renderer: ready,
      width: 1200,
      height: 630,
      format: "webp",
    });
  };
}
