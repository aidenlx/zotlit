// The research desk's objects, one flat drawing per research job, drawn in
// each object's own units. The landing places them on the desk (desk.tsx) and
// reuses each one as a small pictogram. Colours come from the desk tokens in
// src/styles.css; strokes are 1px and non-scaling, set on the sprite.
// @see apps/docs/DESIGN.md → The research desk

import type { CSSProperties, ComponentType } from "react";

import { LogoMark } from "@/components/logo";
import { m } from "@/paraglide/messages.js";

import type { JobId } from "./jobs";

export interface DeskObject {
  /** The object's box in its own units. */
  w: number;
  h: number;
  Art: ComponentType;
  /** Rectangles [x, y, w, h, rx] that cast the object's soft shadow. */
  shade: readonly (readonly [number, number, number, number, number])[];
  /** The view box that frames the object as a small icon. */
  vb: readonly [number, number, number, number];
}

function Bars({
  x,
  y,
  rows,
  step = 14,
  h = 6,
  fill = "var(--desk-text)",
}: {
  x: number;
  y: number;
  rows: readonly number[];
  step?: number;
  h?: number;
  fill?: string;
}) {
  return rows.map((w, i) =>
    w ? (
      <rect
        key={i}
        x={x}
        y={y + i * step}
        width={w}
        height={h}
        rx={h / 2}
        fill={fill}
      />
    ) : null,
  );
}

function ArtFileBox() {
  const tabs: ([string, number] | null)[] = [
    ["var(--z-yellow)", 36],
    null,
    ["var(--z-blue)", 168],
    null,
    ["var(--z-red)", 92],
    ["var(--z-green)", 200],
    null,
    ["var(--z-purple)", 58],
  ];
  return (
    <g>
      <rect
        width="290"
        height="210"
        rx="8"
        fill="var(--desk-steel)"
        stroke="var(--desk-edge)"
      />
      <rect
        x="16"
        y="16"
        width="258"
        height="150"
        rx="4"
        fill="var(--desk-steel-deep)"
      />
      {tabs.map((t, i) => {
        const y = 32 + i * 16;
        return (
          <g key={i}>
            {t && (
              <rect
                x={t[1]}
                y={y - 9}
                width="40"
                height="14"
                rx="3"
                fill={t[0]}
              />
            )}
            <rect
              x="24"
              y={y}
              width="242"
              height="9"
              rx="2"
              fill="var(--desk-paper)"
              stroke="var(--desk-edge)"
            />
          </g>
        );
      })}
      <rect
        x="95"
        y="177"
        width="100"
        height="22"
        rx="3"
        fill="var(--desk-paper)"
        stroke="var(--desk-edge)"
      />
      <text
        x="145"
        y="192"
        textAnchor="middle"
        fontSize="11.5"
        letterSpacing="1.4"
        fill="var(--desk-head)"
        style={{ fontFamily: "var(--font-mono)", textTransform: "uppercase" }}
      >
        {m.docs_home_desk_library_label()}
      </text>
    </g>
  );
}

function ArtBooks() {
  return (
    <g>
      <g transform="rotate(-8 128 118)">
        <rect
          x="22"
          y="46"
          width="212"
          height="150"
          rx="5"
          fill="var(--desk-book1)"
          stroke="var(--desk-edge)"
        />
        <rect
          x="22"
          y="46"
          width="18"
          height="150"
          rx="5"
          fill="var(--desk-shadow-deep)"
        />
      </g>
      <g transform="rotate(6 134 112)">
        <rect
          x="38"
          y="36"
          width="196"
          height="146"
          rx="5"
          fill="var(--desk-book2)"
          stroke="var(--desk-edge)"
        />
        <rect
          x="38"
          y="36"
          width="16"
          height="146"
          rx="5"
          fill="var(--desk-shadow-deep)"
        />
      </g>
      <g transform="rotate(-2 132 112)">
        <rect
          x="44"
          y="44"
          width="184"
          height="138"
          rx="5"
          fill="var(--desk-book3)"
          stroke="var(--desk-edge)"
        />
        <rect
          x="44"
          y="44"
          width="16"
          height="138"
          rx="5"
          fill="var(--desk-shadow-deep)"
        />
        <rect
          x="82"
          y="66"
          width="114"
          height="44"
          rx="3"
          fill="var(--desk-paper)"
        />
        <rect
          x="94"
          y="78"
          width="88"
          height="7"
          rx="3.5"
          fill="var(--desk-head)"
        />
        <rect
          x="94"
          y="92"
          width="58"
          height="5"
          rx="2.5"
          fill="var(--desk-text)"
        />
      </g>
      <g transform="translate(196 156)">
        <g transform="rotate(40)">
          <rect
            x="34"
            y="-7"
            width="62"
            height="14"
            rx="6"
            fill="var(--desk-head)"
          />
        </g>
        <circle r="38" fill="var(--desk-head)" />
        <circle r="30" fill="var(--desk-glass)" opacity="0.9" />
        <rect
          x="-21"
          y="-19"
          width="17"
          height="5"
          rx="2.5"
          fill="var(--desk-paper)"
          opacity="0.9"
          transform="rotate(-45 -12 -16)"
        />
      </g>
    </g>
  );
}

const PAPER_COLS = [
  [
    104, 104, 98, 104, 104, 64, 0, 104, 104, 92, 104, 104, 56, 0, 104, 104, 98,
    72,
  ],
  [
    104, 104, 100, 104, 58, 0, 104, 104, 104, 104, 96, 104, 70, 0, 104, 104,
    104, 82,
  ],
];
// The open paper: two columns of text, highlights in Zotero's colours, and the
// highlighter at rest beside the last stroke.
function ArtPaper() {
  const y = (i: number) => 96 + i * 14;
  return (
    <g>
      <rect
        width="280"
        height="370"
        rx="6"
        fill="var(--desk-paper)"
        stroke="var(--desk-edge)"
      />
      <rect
        x="28"
        y="30"
        width="196"
        height="12"
        rx="4"
        fill="var(--desk-head)"
      />
      <rect
        x="28"
        y="48"
        width="136"
        height="12"
        rx="4"
        fill="var(--desk-head)"
      />
      <rect
        x="28"
        y="70"
        width="116"
        height="6"
        rx="3"
        fill="var(--desk-text)"
      />
      <Bars x={28} y={96} rows={PAPER_COLS[0]!} />
      <Bars x={148} y={96} rows={PAPER_COLS[1]!} />
      {[1, 2, 3].map((i) => (
        <rect
          key={i}
          x="25"
          y={y(i) - 3}
          width={PAPER_COLS[0]![i]! + 6}
          height="12"
          rx="2"
          fill="var(--desk-hl-y)"
        />
      ))}
      {[9, 10].map((i) => (
        <rect
          key={i}
          x="25"
          y={y(i) - 3}
          width={PAPER_COLS[0]![i]! + 6}
          height="12"
          rx="2"
          fill="var(--desk-hl-p)"
        />
      ))}
      <rect
        x="145"
        y={y(7) - 3}
        width="110"
        height="12"
        rx="2"
        fill="var(--desk-hl-y)"
      />
      <rect
        x="148"
        y={y(2) + 8}
        width="100"
        height="2.5"
        rx="1.25"
        fill="var(--z-red)"
      />
      <g transform="translate(196 292)">
        <g transform="rotate(35)">
          <polygon
            points="0,-4 12,-8 12,8 0,4"
            fill="var(--z-yellow)"
            stroke="var(--desk-edge)"
            strokeLinejoin="round"
          />
          <rect
            x="11"
            y="-10"
            width="18"
            height="20"
            rx="2"
            fill="var(--desk-head)"
          />
          <rect
            x="28"
            y="-13"
            width="118"
            height="26"
            rx="6"
            fill="var(--z-yellow)"
            stroke="var(--desk-edge)"
          />
          <rect
            x="54"
            y="-3"
            width="56"
            height="6"
            rx="3"
            fill="var(--color-fd-card)"
            opacity="0.55"
          />
          <rect
            x="138"
            y="-13"
            width="16"
            height="26"
            rx="5"
            fill="var(--desk-head)"
          />
        </g>
      </g>
    </g>
  );
}

function ArtNotebook() {
  const rules = Array.from({ length: 11 }, (_, i) => 38 + i * 17);
  const left = [84, 128, 112, 120, 70, 0, 124, 96, 116, 58];
  const right = [0, 0, 0, 0, 0, 120, 104, 126, 80, 0, 110];
  return (
    <g>
      <rect
        width="350"
        height="240"
        rx="8"
        fill="var(--desk-notebook)"
        stroke="var(--desk-edge)"
      />
      <rect
        x="10"
        y="8"
        width="330"
        height="224"
        rx="4"
        fill="var(--desk-paper)"
        stroke="var(--desk-edge)"
      />
      <rect
        x="168"
        y="9"
        width="14"
        height="222"
        fill="var(--desk-text)"
        opacity="0.55"
      />
      {rules.map((ry) => (
        <g key={ry}>
          <line x1="24" x2="156" y1={ry} y2={ry} stroke="var(--desk-rule)" />
          <line x1="194" x2="326" y1={ry} y2={ry} stroke="var(--desk-rule)" />
        </g>
      ))}
      {left.map((w, i) =>
        w ? (
          <rect
            key={i}
            x="26"
            y={rules[i]! - (i === 0 ? 9 : 7)}
            width={w}
            height={i === 0 ? 7 : 5}
            rx="2.5"
            fill="var(--desk-pen)"
          />
        ) : null,
      )}
      <rect
        x="196"
        y="28"
        width="5"
        height="54"
        rx="2.5"
        fill="var(--z-yellow)"
      />
      <Bars x={208} y={32} rows={[112, 106, 116, 60]} step={13} h={5} />
      {right.map((w, i) =>
        w ? (
          <rect
            key={i}
            x="196"
            y={rules[i]! - 7}
            width={w}
            height="5"
            rx="2.5"
            fill="var(--desk-pen)"
          />
        ) : null,
      )}
      {Array.from({ length: 12 }, (_, i) => (
        <rect
          key={i}
          x="165"
          y={14 + i * 18.4}
          width="20"
          height="7"
          rx="3.5"
          fill="none"
          stroke="var(--desk-head)"
        />
      ))}
      <rect x="298" y="8" width="9" height="244" fill="var(--color-fd-ring)" />
      <polygon
        points="298,251 307,251 307,264 302.5,259 298,264"
        fill="var(--color-fd-ring)"
      />
      <rect
        x="338"
        y="150"
        width="20"
        height="30"
        rx="2"
        fill="var(--z-yellow)"
        stroke="var(--desk-edge)"
      />
    </g>
  );
}

// Bar widths per line; a negative width is a citation mark in the cite colour.
const MS_ROWS = [
  [192],
  [118, -58],
  [192],
  [62, -70, 42],
  [160],
  [],
  [192],
  [98, -56],
  [148],
];
function ArtManuscript() {
  return (
    <g>
      <rect
        width="240"
        height="320"
        rx="6"
        fill="var(--desk-paper)"
        stroke="var(--desk-edge)"
        transform="rotate(5 120 160)"
      />
      <rect
        width="240"
        height="320"
        rx="6"
        fill="var(--desk-paper)"
        stroke="var(--desk-edge)"
        transform="rotate(2.4 120 160)"
      />
      <rect
        width="240"
        height="320"
        rx="6"
        fill="var(--desk-paper)"
        stroke="var(--desk-edge)"
      />
      <rect
        x="24"
        y="34"
        width="150"
        height="11"
        rx="4"
        fill="var(--desk-head)"
      />
      <rect
        x="24"
        y="54"
        width="96"
        height="7"
        rx="3.5"
        fill="var(--desk-head)"
        opacity="0.55"
      />
      {MS_ROWS.map((row, i) => {
        let x = 24;
        const ry = 78 + i * 14;
        return row.map((w, k) => {
          const cite = w < 0;
          const ww = Math.abs(w);
          const el = (
            <rect
              key={`${i}-${k}`}
              x={x}
              y={cite ? ry - 1 : ry}
              width={ww}
              height={cite ? 8 : 6}
              rx={cite ? 4 : 3}
              fill={cite ? "var(--zt-cite)" : "var(--desk-text)"}
            />
          );
          x += ww + 6;
          return el;
        });
      })}
      <rect
        x="24"
        y="216"
        width="72"
        height="7"
        rx="3.5"
        fill="var(--desk-head)"
      />
      {[234, 256, 278].map((ry) => (
        <g key={ry}>
          <rect
            x="24"
            y={ry}
            width="192"
            height="5"
            rx="2.5"
            fill="var(--desk-text)"
          />
          <rect
            x="36"
            y={ry + 9}
            width="148"
            height="5"
            rx="2.5"
            fill="var(--desk-text)"
          />
        </g>
      ))}
      <path
        d="M100 -6 L106 -34 L134 -34 L140 -6"
        fill="none"
        stroke="var(--desk-head)"
        strokeLinejoin="round"
      />
      <rect
        x="90"
        y="-10"
        width="60"
        height="26"
        rx="4"
        fill="var(--desk-head)"
      />
    </g>
  );
}

const PIN_CARDS = [
  {
    x: 34,
    y: 34,
    w: 100,
    h: 66,
    r: -4,
    fill: "var(--desk-paper)",
    px: 84,
    py: 44,
  },
  {
    x: 166,
    y: 28,
    w: 72,
    h: 72,
    r: 3,
    fill: "var(--z-yellow)",
    px: 202,
    py: 40,
  },
  {
    x: 284,
    y: 38,
    w: 104,
    h: 68,
    r: 5,
    fill: "var(--desk-paper)",
    px: 336,
    py: 48,
  },
  {
    x: 54,
    y: 140,
    w: 104,
    h: 68,
    r: 3,
    fill: "var(--desk-paper)",
    px: 106,
    py: 150,
  },
  {
    x: 196,
    y: 148,
    w: 74,
    h: 70,
    r: -5,
    fill: "var(--desk-sticky)",
    px: 233,
    py: 158,
  },
  {
    x: 316,
    y: 148,
    w: 88,
    h: 64,
    r: -3,
    fill: "var(--desk-paper)",
    px: 360,
    py: 158,
  },
];
const PIN_STRING = [
  [0, 1],
  [1, 2],
  [0, 3],
  [1, 4],
  [4, 5],
  [2, 5],
  [3, 4],
];
function ArtPinboard() {
  return (
    <g>
      <rect
        width="430"
        height="250"
        rx="8"
        fill="var(--desk-steel)"
        stroke="var(--desk-edge)"
      />
      <rect
        x="12"
        y="12"
        width="406"
        height="226"
        rx="4"
        fill="var(--desk-cork)"
      />
      {PIN_CARDS.map((c, i) => (
        <g
          key={i}
          transform={`rotate(${c.r} ${c.x + c.w / 2} ${c.y + c.h / 2})`}
        >
          <rect
            x={c.x}
            y={c.y}
            width={c.w}
            height={c.h}
            rx="3"
            fill={c.fill}
            stroke="var(--desk-edge)"
          />
          <rect
            x={c.x + 12}
            y={c.y + 22}
            width={c.w * 0.55}
            height="6"
            rx="3"
            fill="var(--desk-head)"
            opacity="0.75"
          />
          <rect
            x={c.x + 12}
            y={c.y + 36}
            width={c.w * 0.72}
            height="4"
            rx="2"
            fill="var(--desk-ink-soft)"
          />
          <rect
            x={c.x + 12}
            y={c.y + 46}
            width={c.w * 0.58}
            height="4"
            rx="2"
            fill="var(--desk-ink-soft)"
          />
        </g>
      ))}
      {PIN_STRING.map(([a, b], i) => (
        <line
          key={i}
          x1={PIN_CARDS[a!]!.px}
          y1={PIN_CARDS[a!]!.py}
          x2={PIN_CARDS[b!]!.px}
          y2={PIN_CARDS[b!]!.py}
          stroke="var(--z-red)"
        />
      ))}
      {PIN_CARDS.map((c, i) => (
        <g key={i}>
          <circle cx={c.px} cy={c.py} r="6.5" fill="var(--desk-head)" />
          <circle
            cx={c.px - 2}
            cy={c.py - 2}
            r="2"
            fill="var(--color-fd-card)"
            opacity="0.7"
          />
        </g>
      ))}
    </g>
  );
}

// A printer seen from above: fresh paper in the tray at the back, the lid, a small control
// panel, and a printed page with its reference list coming out of the front.
function ArtPrinter() {
  return (
    <g>
      <rect
        x="68"
        y="4"
        width="128"
        height="30"
        rx="3"
        fill="var(--desk-paper)"
        stroke="var(--desk-edge)"
      />
      <rect
        x="62"
        y="0"
        width="136"
        height="30"
        rx="3"
        fill="var(--desk-paper)"
        stroke="var(--desk-edge)"
      />
      <rect
        y="18"
        width="260"
        height="132"
        rx="10"
        fill="var(--desk-laptop)"
        stroke="var(--desk-edge)"
      />
      <rect
        x="14"
        y="30"
        width="232"
        height="68"
        rx="5"
        fill="var(--desk-key)"
      />
      <rect
        x="22"
        y="38"
        width="216"
        height="52"
        rx="3"
        fill="none"
        stroke="var(--desk-tool-seam)"
      />
      <circle
        cx="146"
        cy="115"
        r="7"
        fill="var(--desk-key)"
        stroke="var(--desk-edge)"
      />
      <rect
        x="166"
        y="106"
        width="50"
        height="18"
        rx="3"
        fill="var(--desk-screen)"
      />
      <rect
        x="172"
        y="113"
        width="26"
        height="4"
        rx="2"
        fill="#D8E2F0"
        opacity="0.6"
      />
      <circle cx="232" cy="115" r="5" fill="var(--z-green)" />
      <rect
        x="34"
        y="132"
        width="192"
        height="9"
        rx="4"
        fill="var(--desk-tray-deep)"
      />
      <rect
        x="54"
        y="135"
        width="152"
        height="65"
        rx="3"
        fill="var(--desk-paper)"
        stroke="var(--desk-edge)"
      />
      <rect
        x="68"
        y="146"
        width="58"
        height="6"
        rx="3"
        fill="var(--desk-head)"
      />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect
            x="68"
            y={160 + i * 12}
            width="24"
            height="5"
            rx="2.5"
            fill="var(--zt-cite)"
          />
          <rect
            x="96"
            y={160 + i * 12}
            width={[90, 72, 84][i]}
            height="5"
            rx="2.5"
            fill="var(--desk-text)"
          />
        </g>
      ))}
    </g>
  );
}

function ArtKit() {
  const keys: [number, number][] = [];
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 12; c++) keys.push([19 + c * 18, 168 + r * 15]);
  return (
    <g>
      <rect
        width="250"
        height="146"
        rx="8"
        fill="var(--desk-laptop)"
        stroke="var(--desk-edge)"
      />
      <rect
        x="10"
        y="10"
        width="230"
        height="126"
        rx="3"
        fill="var(--desk-screen)"
      />
      <rect
        x="10"
        y="10"
        width="48"
        height="126"
        rx="3"
        fill="var(--desk-screen-side)"
      />
      {/* The mark in its dark-ground inks, on the laptop's screen in both schemes. */}
      <g
        transform="translate(22 20)"
        style={
          {
            "--zotlit-ink": "#d8e2f0",
            "--zotlit-accent": "#f0793f",
          } as CSSProperties
        }
      >
        <LogoMark className="[height:24px] [width:24px]" />
      </g>
      {[56, 68, 80, 92].map((ry, i) => (
        <rect
          key={ry}
          x="20"
          y={ry}
          width={[28, 22, 26, 18][i]}
          height="5"
          rx="2.5"
          fill="#D8E2F0"
          opacity="0.35"
        />
      ))}
      <rect
        x="72"
        y="24"
        width="112"
        height="9"
        rx="4"
        fill="#D8E2F0"
        opacity="0.9"
      />
      <rect
        x="72"
        y="44"
        width="150"
        height="5"
        rx="2.5"
        fill="#D8E2F0"
        opacity="0.42"
      />
      <rect
        x="72"
        y="56"
        width="108"
        height="5"
        rx="2.5"
        fill="#D8E2F0"
        opacity="0.42"
      />
      <rect
        x="186"
        y="55.5"
        width="36"
        height="6"
        rx="3"
        fill="var(--zt-cite)"
      />
      <rect
        x="72"
        y="68"
        width="140"
        height="5"
        rx="2.5"
        fill="#D8E2F0"
        opacity="0.42"
      />
      <rect x="72" y="86" width="4" height="36" rx="2" fill="var(--z-yellow)" />
      <Bars
        x={84}
        y={88}
        rows={[120, 132, 96]}
        step={12}
        h={5}
        fill="#D8E2F0"
      />
      <rect x="6" y="146" width="238" height="8" fill="var(--desk-edge)" />
      <rect
        y="154"
        width="250"
        height="136"
        rx="8"
        fill="var(--desk-laptop)"
        stroke="var(--desk-edge)"
      />
      {keys.map(([kx, ky], i) => (
        <rect
          key={i}
          x={kx}
          y={ky}
          width="14"
          height="11"
          rx="2"
          fill="var(--desk-key)"
        />
      ))}
      <rect
        x="19"
        y="228"
        width="50"
        height="11"
        rx="2"
        fill="var(--desk-key)"
      />
      <rect
        x="75"
        y="228"
        width="100"
        height="11"
        rx="2"
        fill="var(--desk-key)"
      />
      <rect
        x="181"
        y="228"
        width="50"
        height="11"
        rx="2"
        fill="var(--desk-key)"
      />
      <rect
        x="88"
        y="248"
        width="74"
        height="34"
        rx="4"
        fill="var(--desk-key)"
      />
      <rect
        x="270"
        y="96"
        width="128"
        height="192"
        rx="8"
        fill="var(--color-fd-ring)"
        stroke="var(--desk-edge)"
      />
      <rect
        x="280"
        y="106"
        width="108"
        height="172"
        rx="4"
        fill="none"
        stroke="var(--desk-tool-seam)"
      />
      <rect
        x="318"
        y="114"
        width="32"
        height="12"
        rx="3"
        fill="var(--desk-head)"
      />
      <rect
        x="318"
        y="258"
        width="32"
        height="12"
        rx="3"
        fill="var(--desk-head)"
      />
      <rect
        x="326"
        y="122"
        width="16"
        height="140"
        rx="8"
        fill="var(--desk-head)"
      />
      {[150, 222].map((ly) => (
        <g key={ly}>
          <rect
            x="265"
            y={ly}
            width="9"
            height="22"
            rx="2"
            fill="var(--desk-paper)"
            stroke="var(--desk-edge)"
          />
          <rect
            x="394"
            y={ly}
            width="9"
            height="22"
            rx="2"
            fill="var(--desk-paper)"
            stroke="var(--desk-edge)"
          />
        </g>
      ))}
    </g>
  );
}

export function Mug({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle cx="7" cy="9" r="44" fill="var(--desk-shadow)" />
      <rect
        x="30"
        y="-11"
        width="34"
        height="22"
        rx="9"
        fill="var(--desk-paper)"
        stroke="var(--desk-edge)"
      />
      <circle r="44" fill="var(--desk-paper)" stroke="var(--desk-edge)" />
      <circle r="35" fill="var(--desk-coffee)" />
      <ellipse
        cx="-12"
        cy="-15"
        rx="10"
        ry="4"
        fill="var(--color-fd-card)"
        opacity="0.28"
        transform="rotate(-32 -12 -15)"
      />
    </g>
  );
}

// Each job's object. w/h: the object's box in its own units. shade: rects for the flat
// shadow. vb: the view box that frames it as a small icon.
export const DESK_OBJECTS: Record<JobId, DeskObject> = {
  connect: {
    w: 290,
    h: 210,
    Art: ArtFileBox,
    shade: [[0, 0, 290, 210, 8]],
    vb: [-14, -14, 320, 246],
  },
  find: {
    w: 270,
    h: 230,
    Art: ArtBooks,
    shade: [[26, 40, 210, 156, 6]],
    vb: [-6, 2, 292, 240],
  },
  read: {
    w: 280,
    h: 370,
    Art: ArtPaper,
    shade: [[0, 0, 280, 370, 6]],
    vb: [-16, -12, 370, 410],
  },
  notes: {
    w: 350,
    h: 240,
    Art: ArtNotebook,
    shade: [[0, 0, 350, 240, 8]],
    vb: [-12, -16, 384, 292],
  },
  cite: {
    w: 240,
    h: 320,
    Art: ArtManuscript,
    shade: [[0, 0, 240, 320, 6]],
    vb: [-30, -46, 300, 386],
  },
  connections: {
    w: 430,
    h: 250,
    Art: ArtPinboard,
    shade: [[0, 0, 430, 250, 8]],
    vb: [-12, -12, 458, 280],
  },
  export: {
    w: 260,
    h: 200,
    Art: ArtPrinter,
    shade: [
      [62, 0, 136, 30, 3],
      [0, 18, 260, 132, 10],
      [54, 135, 152, 65, 3],
    ],
    vb: [-12, -12, 288, 230],
  },
  customise: {
    w: 400,
    h: 290,
    Art: ArtKit,
    shade: [
      [0, 0, 250, 290, 8],
      [270, 96, 128, 192, 8],
    ],
    vb: [-12, -12, 430, 318],
  },
};

/** Where each object lies on the desk (view box 1600 × 860), with its tilt in degrees. */
export const DESK_LAYOUT = {
  key: "wide",
  W: 1600,
  H: 860,
  blotter: { x: 96, y: 330, w: 1000, h: 484 },
  mug: [1300, 784],
  at: {
    connect: { x: 64, y: 58, r: -3 },
    find: { x: 416, y: 44, r: 2 },
    read: { x: 160, y: 382, r: -5, deep: true },
    notes: { x: 488, y: 440, r: 3, deep: true },
    cite: { x: 872, y: 404, r: 6, deep: true },
    connections: { x: 746, y: 40, r: -1.5 },
    export: { x: 1264, y: 72, r: 4 },
    customise: { x: 1152, y: 414, r: -3 },
  },
};
