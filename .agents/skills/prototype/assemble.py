#!/usr/bin/env python3
"""Splice variant components into a prototype HTML copied from template.html.

Usage:
    assemble.py <prototype.html> <variant-A.jsx> [<variant-B.jsx> ...] \
        [--name A="Sidebar nav"] [--name B="Single scroll"] ...

Each variant file must be named `variant-<KEY>.jsx` (KEY = A, B, C, ...) and hold
exactly one `function Variant<KEY>() { ... }` component. The HTML carries a
`// --- Variant <KEY> ---` / `// --- Variant <KEY> END ---` marker pair per variant;
the lines between them are replaced with the fragment, file to file, so the JSX never
has to pass through the orchestrator's context. Optional `--name KEY=Label` rewrites
that variant's label in the switcher bar. Prints only a one-line summary.
"""
import argparse
import pathlib
import re
import sys


def key_of(path: str) -> str:
    m = re.search(r"variant-([A-Za-z0-9]+)\.jsx$", path)
    if not m:
        sys.exit(f"cannot derive variant key from filename: {path}")
    return m.group(1).upper()


def main() -> None:
    p = argparse.ArgumentParser(description="Splice variant JSX files into a prototype HTML.")
    p.add_argument("html", help="the prototype HTML copied from template.html")
    p.add_argument("variants", nargs="+", help="variant-<KEY>.jsx files to splice in")
    p.add_argument("--name", action="append", default=[], metavar="KEY=Label",
                   help="rewrite a variant's switcher label")
    a = p.parse_args()

    html_path = pathlib.Path(a.html)
    html = html_path.read_text()

    for vpath in a.variants:
        key = key_of(vpath)
        body = pathlib.Path(vpath).read_text().strip("\n")
        # replace the lines between the marker pair, keeping the markers themselves
        pat = re.compile(
            r"^([ \t]*)// --- Variant " + re.escape(key) + r" ---[ \t]*\n"
            r".*?"
            r"^[ \t]*// --- Variant " + re.escape(key) + r" END ---[ \t]*$",
            re.M | re.S,
        )
        m = pat.search(html)
        if not m:
            sys.exit(f"marker pair for Variant{key} not found in {html_path}")
        indent = m.group(1)
        block = "\n".join((indent + ln if ln.strip() else ln) for ln in body.splitlines())
        replacement = (
            f"{indent}// --- Variant {key} ---\n"
            f"{block}\n"
            f"{indent}// --- Variant {key} END ---"
        )
        html = html[: m.start()] + replacement + html[m.end():]

    for spec in a.name:
        key, _, label = spec.partition("=")
        key = key.strip().upper()
        html, n = re.subn(
            r'(\{\s*key:\s*"' + re.escape(key) + r'",\s*name:\s*)"[^"]*"',
            lambda mm: mm.group(1) + '"' + label + '"',
            html,
        )
        if n == 0:
            sys.exit(f"could not set switcher name for variant {key}")

    html_path.write_text(html)
    print(f"spliced {len(a.variants)} variant(s) into {html_path.name}")


if __name__ == "__main__":
    main()
