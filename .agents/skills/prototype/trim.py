#!/usr/bin/env python3
"""Trim an assembled prototype HTML down to just the winning variant.

Usage:
    trim.py <assembled.html> <winning-key> [--out <path>]

Deletes every non-winning `// --- Variant X ---` … `END` region and the whole
`// --- Switcher ---` … `END` region (VARIANTS array, App component, bottom switcher
bar), then points the final render call directly at the winning component. Regions are
bounded by marker pairs, so no JavaScript structure is parsed. Default output overwrites
the input file in place; pass --out to write elsewhere and keep the original untouched.
"""
import argparse
import pathlib
import re
import sys


def cut_region(html: str, opener: str, closer: str) -> str:
    """Remove opener..closer inclusive (whole lines) plus trailing blank lines."""
    oi = html.index(opener)
    ci = html.index(closer, oi)
    start = html.rfind("\n", 0, oi) + 1
    end = html.find("\n", ci)
    end = len(html) if end == -1 else end + 1
    while end < len(html) and html[end] == "\n":
        end += 1
    return html[:start] + html[end:]


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("html", help="the assembled prototype HTML (post assemble.py)")
    p.add_argument("winner", help="winning variant key, e.g. C")
    p.add_argument("--out", help="write to a new path instead of overwriting the input")
    a = p.parse_args()

    key = a.winner.strip().upper()
    html_path = pathlib.Path(a.html)
    html = html_path.read_text()

    if f"// --- Variant {key} ---" not in html:
        sys.exit(f"no Variant {key} marker found in {html_path}")

    keys = re.findall(r"^[ \t]*// --- Variant ([A-Za-z0-9]+) ---[ \t]*$", html, re.M)
    for vkey in keys:
        if vkey == key:
            continue
        html = cut_region(html, f"// --- Variant {vkey} ---", f"// --- Variant {vkey} END ---")

    html = cut_region(html, "// --- Switcher ---", "// --- Switcher END ---")

    render_call = 'createRoot(document.getElementById("root")).render(<App />);'
    html = html.replace(render_call, f'createRoot(document.getElementById("root")).render(<Variant{key} />);')

    out_path = pathlib.Path(a.out) if a.out else html_path
    out_path.write_text(html)
    print(f"trimmed to Variant{key} -> {out_path.name}")


if __name__ == "__main__":
    main()
