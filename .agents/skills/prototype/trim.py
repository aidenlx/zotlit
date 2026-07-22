#!/usr/bin/env python3
"""Trim an assembled prototype HTML down to just the winning variant.

Usage:
    trim.py <assembled.html> <winning-key> [--out <path>]

Removes every non-winning `// --- Variant X ---` block and the whole
`// --- Switcher ---` block (VARIANTS array, App component, bottom switcher bar),
then points the final render call directly at the winning component. Default
output overwrites the input file in place; pass --out to write elsewhere and
keep the multi-variant original untouched.
"""
import argparse
import pathlib
import re
import sys


def find_block(html: str, marker: str) -> tuple[int, int]:
    start = html.index(marker)
    brace_start = html.index("{", start)
    depth = 0
    i = brace_start
    while i < len(html):
        if html[i] == "{":
            depth += 1
        elif html[i] == "}":
            depth -= 1
            if depth == 0:
                return start, i + 1
        i += 1
    sys.exit(f"unbalanced braces while scanning block at {marker!r}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("html", help="the assembled prototype HTML (post assemble.py)")
    p.add_argument("winner", help="winning variant key, e.g. C")
    p.add_argument("--out", help="write to a new path instead of overwriting the input")
    a = p.parse_args()

    key = a.winner.strip().upper()
    html_path = pathlib.Path(a.html)
    html = html_path.read_text()

    if f"function Variant{key}(" not in html:
        sys.exit(f"no function Variant{key}() found in {html_path}")

    for m in list(re.finditer(r"// --- Variant ([A-Za-z0-9]+) ---", html)):
        vkey = m.group(1)
        if vkey == key:
            continue
        start, end = find_block(html, m.group(0))
        while end < len(html) and html[end] == "\n":
            end += 1
        html = html[:start] + html[end:]

    render_call = 'createRoot(document.getElementById("root")).render(<App />);'
    if "// --- Switcher ---" in html:
        start = html.index("// --- Switcher ---")
        end = html.index(render_call, start) if render_call in html else start
        html = html[:start] + html[end:]

    html = html.replace(render_call, f'createRoot(document.getElementById("root")).render(<Variant{key} />);')

    out_path = pathlib.Path(a.out) if a.out else html_path
    out_path.write_text(html)
    print(f"trimmed to Variant{key} -> {out_path.name}")


if __name__ == "__main__":
    main()
